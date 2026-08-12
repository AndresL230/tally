// Adversarial integration tests for M2, written against M2_CONTRACT.md (and
// M1_CONTRACT.md for the expense-route base contract) BEFORE the server
// implementation exists. Every expectation here is derived from the written
// contracts, never from src/worker/**.
//
// Routes under test (all behind Access middleware + ledger membership):
//   POST /api/ledgers/:id/receipts?id=<client-uuid>   (raw image bytes)
//   POST /api/receipts/:rid/extract                   (AI Gateway, mocked via global fetch patch)
//   POST /api/receipts/:rid/discard
//   POST /api/ledgers/:id/expenses                    (method 'items' now legal;
//                                                      percent/manual gain optional receipt_id)
//
// ALL MONEY IS INTEGER CENTS. Expected shares are computed with splitItems
// from src/shared/money (already property-tested) — never re-derived by hand
// in float arithmetic.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { authedFetch } from "../helpers/auth";
import { ALEX, JORDAN, SAM, OUTSIDER, insertLedger, insertExpense } from "../helpers/fixtures";
import { splitItems } from "../../src/shared/money";
import type { ApiEntry, ApiItem, ApiReceipt, LedgerDetail } from "../../src/shared/types";

import cleanFixture from "../fixtures/extraction/clean.json";
import noItemsFixture from "../fixtures/extraction/no-items.json";
import handwrittenTipFixture from "../fixtures/extraction/handwritten-tip.json";
import notAReceiptFixture from "../fixtures/extraction/not-a-receipt.json";
import malformedFixture from "../fixtures/extraction/malformed.json";
import negativePriceFixture from "../fixtures/extraction/negative-price.json";
import garbageDateFixture from "../fixtures/extraction/garbage-date.json";

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

interface ReceiptResponse {
  receipt: ApiReceipt;
  items: ApiItem[];
}
interface ErrorResponse {
  error: string;
}
interface EntryResponse {
  entry: ApiEntry;
}

interface ReceiptRow {
  id: string;
  ledger_id: string;
  r2_key: string | null;
  sha256: string;
  status: string;
  raw_json: string | null;
  merchant: string | null;
  purchased_on: string | null;
  total_cents: number | null;
  uploaded_by: string | null;
  created_at: number | null;
}

interface ReceiptItemRow {
  id: string;
  receipt_id: string;
  label: string | null;
  qty: string | null;
  price_cents: number | null;
  assigned_to: string | null;
}

// AI Gateway endpoint per the contract: the vitest bindings set
// AI_GATEWAY_ACCOUNT_ID=test-account and AI_GATEWAY_ID=test-gw.
const GATEWAY_ORIGIN = "https://gateway.ai.cloudflare.com";
const GATEWAY_PATH = "/v1/test-account/test-gw/anthropic/v1/messages";

// env.ANTHROPIC_API_KEY is deliberately NOT bound by the vitest config; the
// 503-when-absent path depends on that. We set/unset it per test by mutating
// the cloudflare:test env object (same object the SELF worker receives).
const mutableEnv = env as unknown as Record<string, unknown>;
function setApiKey(): void {
  mutableEnv["ANTHROPIC_API_KEY"] = "test-key";
}
function clearApiKey(): void {
  delete mutableEnv["ANTHROPIC_API_KEY"];
}

/** Deterministic, seed-distinct fake image bytes (JPEG magic prefix; the
 *  server only validates Content-Type, not codec). */
function fakeImage(seed: string, length = 256): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  for (let i = 4; i < length; i++) {
    bytes[i] = (seed.charCodeAt(i % seed.length) * (i + 7) + i) % 256;
  }
  return bytes;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface UploadOptions {
  id?: string | null; // null = omit the ?id query param entirely
  contentType?: string | null; // null = send no Content-Type header
}

function uploadReceipt(
  ledgerId: string,
  email: string,
  bytes: Uint8Array,
  opts: UploadOptions = {},
): Promise<Response> {
  const id = opts.id === null ? null : (opts.id ?? crypto.randomUUID());
  const path =
    id === null
      ? `/api/ledgers/${ledgerId}/receipts`
      : `/api/ledgers/${ledgerId}/receipts?id=${id}`;
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) {
    headers["Content-Type"] = opts.contentType ?? "image/jpeg";
  }
  return authedFetch(path, email, { method: "POST", headers, body: bytes });
}

/** Upload fresh random bytes and return the created receipt (status 'uploaded'). */
async function freshReceipt(ledgerId: string, email: string): Promise<ApiReceipt> {
  const res = await uploadReceipt(ledgerId, email, fakeImage(crypto.randomUUID()));
  expect(res.status).toBe(201);
  const json = (await res.json()) as ReceiptResponse;
  return json.receipt;
}

function extract(rid: string, email: string): Promise<Response> {
  return authedFetch(`/api/receipts/${rid}/extract`, email, { method: "POST" });
}

function discard(rid: string, email: string): Promise<Response> {
  return authedFetch(`/api/receipts/${rid}/discard`, email, { method: "POST" });
}

function postJson(path: string, email: string, body: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function receiptRow(rid: string): Promise<ReceiptRow | null> {
  return await env.DB.prepare("SELECT * FROM receipts WHERE id = ?1").bind(rid).first<ReceiptRow>();
}

async function receiptItemRows(rid: string): Promise<ReceiptItemRow[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM receipt_items WHERE receipt_id = ?1 ORDER BY label",
  )
    .bind(rid)
    .all<ReceiptItemRow>();
  return res.results;
}

async function countReceipts(ledgerId?: string): Promise<number> {
  const stmt = ledgerId
    ? env.DB.prepare("SELECT COUNT(*) AS n FROM receipts WHERE ledger_id = ?1").bind(ledgerId)
    : env.DB.prepare("SELECT COUNT(*) AS n FROM receipts");
  const row = await stmt.first<{ n: number }>();
  return row!.n;
}

async function countReceiptItems(rid: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM receipt_items WHERE receipt_id = ?1",
  )
    .bind(rid)
    .first<{ n: number }>();
  return row!.n;
}

async function countExpenses(ledgerId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM expenses WHERE ledger_id = ?1")
    .bind(ledgerId)
    .first<{ n: number }>();
  return row!.n;
}

/** Force a receipt's status directly (raw_json left NULL so the extract
 *  route's 409-on-posted/discarded check is exercised unambiguously,
 *  without tripping the raw_json cache-hit branch first). */
async function forceStatus(rid: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE receipts SET status = ?1 WHERE id = ?2").bind(status, rid).run();
}

// --- Gateway mock: global-fetch patch ---------------------------------------
// This pool version exposes no fetchMock, but SELF's worker runs in the SAME
// isolate as the tests (per cloudflare:test docs, global mocks apply to it),
// so patching globalThis.fetch intercepts the worker's outbound gateway call.
// Semantics preserved from the fetchMock version: one armed interceptor per
// expected call, any un-mocked outbound fetch throws (disableNetConnect),
// leftover interceptors fail the test (assertNoPendingInterceptors).

interface GatewayMock {
  status: number;
  data: unknown;
  expectHeaders?: Record<string, string>;
  onBody?: (body: string) => void;
  counter: { n: number };
}
const armedMocks: GatewayMock[] = [];
const realFetch = globalThis.fetch;

function installGatewayFetchPatch(): void {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = request.url;
    if (!url.startsWith(GATEWAY_ORIGIN)) {
      // disableNetConnect: nothing in the worker may reach the real network.
      throw new Error(`unmocked outbound fetch: ${url}`);
    }
    expect(new URL(url).pathname).toBe(GATEWAY_PATH);
    const mock = armedMocks.shift();
    if (!mock) {
      throw new Error("gateway called with no interceptor armed");
    }
    if (mock.expectHeaders) {
      for (const [name, value] of Object.entries(mock.expectHeaders)) {
        expect(request.headers.get(name)).toBe(value);
      }
    }
    const body = await request.text();
    mock.counter.n += 1;
    mock.onBody?.(body);
    const payload = typeof mock.data === "string" ? mock.data : JSON.stringify(mock.data);
    return new Response(payload, {
      status: mock.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** Arm one gateway interception. Returns a call counter. */
function interceptGateway(
  data: unknown,
  opts: {
    status?: number;
    onBody?: (body: string) => void;
    expectHeaders?: Record<string, string>;
  } = {},
): { calls: () => number } {
  const counter = { n: 0 };
  armedMocks.push({
    status: opts.status ?? 200,
    data,
    expectHeaders: opts.expectHeaders,
    onBody: opts.onBody,
    counter,
  });
  return { calls: () => counter.n };
}

// The mockup's Nong's Khao Man Gai confirm-screen assignment, canonical form.
// Viewer = ALEX (payer), friend = JORDAN. st codes translated at the boundary:
// 0 -> JORDAN, 1 -> ALEX, 2 -> 'half'.
const CONFIRMED_ITEMS = [
  { label: "Khao man gai", qty: "x2", price_cents: 2500, assigned_to: JORDAN },
  { label: "Fried chicken thigh", qty: null, price_cents: 650, assigned_to: ALEX },
  { label: "Papaya salad", qty: null, price_cents: 875, assigned_to: "half" },
  { label: "Thai iced tea", qty: "x2", price_cents: 900, assigned_to: JORDAN },
  { label: "Sticky rice", qty: null, price_cents: 425, assigned_to: "half" },
  { label: "Fresh spring rolls", qty: null, price_cents: 575, assigned_to: ALEX },
] as const;
const CLEAN_SUBTOTAL = 5925; // 2500+650+875+900+425+575
const EDITED_TOTAL = 7650; // user bumps the printed 7550 (rounds the tip up)

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  installGatewayFetchPatch();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  // assertNoPendingInterceptors: every armed mock must have been consumed.
  const leftover = armedMocks.length;
  armedMocks.length = 0;
  expect(leftover).toBe(0);
  clearApiKey();
});

// ALEX < JORDAN lexicographically, so ALEX is person_a.
let ledgerId: string;
beforeEach(async () => {
  ledgerId = await insertLedger(ALEX, JORDAN);
  setApiKey(); // present by default; the 503 test removes it explicitly
});

// ---------------------------------------------------------------------------
// Upload: POST /api/ledgers/:id/receipts
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/receipts — upload", () => {
  it("happy path: 201, echoed ApiReceipt shape, empty items, one DB row, bytes in R2 under the contract key", async () => {
    const clientId = crypto.randomUUID();
    const bytes = fakeImage("happy-path");
    const res = await uploadReceipt(ledgerId, ALEX, bytes, { id: clientId });
    expect(res.status).toBe(201);

    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.id).toBe(clientId); // client id IS the receipt PK
    expect(json.receipt.ledger_id).toBe(ledgerId);
    expect(json.receipt.status).toBe("uploaded");
    expect(json.receipt.merchant).toBeNull();
    expect(json.receipt.purchased_on).toBeNull();
    expect(json.receipt.total_cents).toBeNull();
    expect(json.receipt.uploaded_by).toBe(ALEX);
    expect(typeof json.receipt.created_at).toBe("number");
    expect(json.items).toEqual([]);

    expect(await countReceipts()).toBe(1);
    const row = await receiptRow(clientId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("uploaded");
    // sha256 is the hex digest of the exact bytes
    const expectedSha = toHex(await crypto.subtle.digest("SHA-256", bytes));
    expect(row!.sha256).toBe(expectedSha);
    // R2 key per contract: receipts/<ledger_id>/<receipt_id>.jpg
    expect(row!.r2_key).toBe(`receipts/${ledgerId}/${clientId}.jpg`);
    const head = await env.RECEIPTS.head(row!.r2_key!);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(bytes.length);
  });

  it("SAME BYTES TWICE (different client id) => 200, SAME receipt id, exactly one row, at most one R2 object", async () => {
    const bytes = fakeImage("dedupe-me");
    const firstId = crypto.randomUUID();
    const first = await uploadReceipt(ledgerId, ALEX, bytes, { id: firstId });
    expect(first.status).toBe(201);

    const second = await uploadReceipt(ledgerId, ALEX, bytes, { id: crypto.randomUUID() });
    expect(second.status).toBe(200); // dedupe path, not a create
    const json = (await second.json()) as ReceiptResponse;
    expect(json.receipt.id).toBe(firstId); // the ORIGINAL receipt comes back

    expect(await countReceipts()).toBe(1);
    // R2: exactly one object under this ledger's prefix (R2 storage is not
    // reset between tests, so scope by the per-test ledger id).
    const listed = await env.RECEIPTS.list({ prefix: `receipts/${ledgerId}/` });
    expect(listed.objects.length).toBe(1);
  });

  it("same client id + same bytes repeated => 200 dedupe (sha matches first), still one row", async () => {
    const bytes = fakeImage("repeat-me");
    const id = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id })).status).toBe(201);
    const repeat = await uploadReceipt(ledgerId, ALEX, bytes, { id });
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as ReceiptResponse).receipt.id).toBe(id);
    expect(await countReceipts()).toBe(1);
  });

  it("same client id + DIFFERENT bytes => 409, nothing overwritten", async () => {
    const id = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, fakeImage("original"), { id })).status).toBe(201);

    const res = await uploadReceipt(ledgerId, ALEX, fakeImage("different"), { id });
    expect(res.status).toBe(409);
    const err = (await res.json()) as ErrorResponse;
    expect(typeof err.error).toBe("string");

    expect(await countReceipts()).toBe(1);
    const row = await receiptRow(id);
    const originalSha = toHex(await crypto.subtle.digest("SHA-256", fakeImage("original")));
    expect(row!.sha256).toBe(originalSha); // original bytes still win
  });

  it("re-uploading a DISCARDED receipt's bytes RESURRECTS it (DEVIATIONS D8): same row, status back in play", async () => {
    // Amended after the M2 review: leaving the receipt discarded made the
    // photo a permanent dead end (every later commit 409s). Re-uploading
    // the same bytes is a clear signal the user wants it back.
    const bytes = fakeImage("discard-then-reupload");
    const firstId = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id: firstId })).status).toBe(201);
    expect((await discard(firstId, ALEX)).status).toBe(200);

    // No extraction ran (raw_json NULL) -> resurrects to 'uploaded'.
    const res = await uploadReceipt(ledgerId, JORDAN, bytes, { id: crypto.randomUUID() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.id).toBe(firstId);
    expect(json.receipt.status).toBe("uploaded");
    expect(await countReceipts()).toBe(1);
  });

  it("resurrecting a discarded receipt that WAS extracted returns to needs_review with its items intact", async () => {
    const bytes = fakeImage("discard-after-extract");
    const rid = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id: rid })).status).toBe(201);
    interceptGateway(cleanFixture);
    expect((await extract(rid, ALEX)).status).toBe(200);
    expect((await discard(rid, ALEX)).status).toBe(200);

    const res = await uploadReceipt(ledgerId, ALEX, bytes, { id: crypto.randomUUID() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.id).toBe(rid);
    expect(json.receipt.status).toBe("needs_review");
    expect(json.items).toHaveLength(6); // extracted items survived the round trip
    expect(await countReceipts()).toBe(1);
  });

  it("extract claim: a receipt mid-extraction is NOT re-extracted — current state returned, no second model call", async () => {
    // Two members scanning the same paper receipt seconds apart: the
    // second extract call must not reach the gateway while the first holds
    // the claim (status 'extracting', raw_json still NULL).
    const rid = (await freshReceipt(ledgerId, ALEX)).id;
    await forceStatus(rid, "extracting");

    // No interceptor armed: a gateway call here would throw and 500.
    const res = await extract(rid, JORDAN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("extracting");

    const row = await receiptRow(rid);
    expect(row!.raw_json).toBeNull(); // untouched; the claim holder will write it
  });

  it("dedupe is PER LEDGER: same bytes in a different ledger create a separate receipt", async () => {
    const otherLedger = await insertLedger(ALEX, SAM);
    const bytes = fakeImage("cross-ledger");
    const firstId = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id: firstId })).status).toBe(201);

    const secondId = crypto.randomUUID();
    const res = await uploadReceipt(otherLedger, ALEX, bytes, { id: secondId });
    expect(res.status).toBe(201); // NOT deduped across ledgers (UNIQUE is per ledger)
    expect(((await res.json()) as ReceiptResponse).receipt.id).toBe(secondId);

    expect(await countReceipts(ledgerId)).toBe(1);
    expect(await countReceipts(otherLedger)).toBe(1);
  });

  it("image/png and image/webp are accepted", async () => {
    expect(
      (await uploadReceipt(ledgerId, ALEX, fakeImage("png"), { contentType: "image/png" })).status,
    ).toBe(201);
    expect(
      (await uploadReceipt(ledgerId, ALEX, fakeImage("webp"), { contentType: "image/webp" }))
        .status,
    ).toBe(201);
  });

  const badContentTypes: Array<[string, string | null]> = [
    ["text/plain", "text/plain"],
    ["application/json", "application/json"],
    ["image/gif (not in the allowed trio)", "image/gif"],
    ["missing Content-Type header", null],
  ];
  for (const [name, ct] of badContentTypes) {
    it(`rejects ${name} => 400, no row written`, async () => {
      const res = await uploadReceipt(ledgerId, ALEX, fakeImage(`bad-ct-${name}`), {
        contentType: ct,
      });
      expect(res.status).toBe(400);
      expect(await countReceipts()).toBe(0);
    });
  }

  it("empty body => 400, no row written", async () => {
    const res = await uploadReceipt(ledgerId, ALEX, new Uint8Array(0));
    expect(res.status).toBe(400);
    expect(await countReceipts()).toBe(0);
  });

  it("missing ?id query param => 400", async () => {
    const res = await uploadReceipt(ledgerId, ALEX, fakeImage("no-id"), { id: null });
    expect(res.status).toBe(400);
    expect(await countReceipts()).toBe(0);
  });

  it("size limit: exactly 8_000_000 bytes is accepted, 8_000_001 => 413", async () => {
    // In-memory allocations; fast enough to run every time.
    const atLimit = new Uint8Array(8_000_000);
    atLimit[0] = 1; // distinct sha from the over-limit body
    const ok = await uploadReceipt(ledgerId, ALEX, atLimit);
    expect(ok.status).toBe(201);

    const overLimit = new Uint8Array(8_000_001);
    overLimit[0] = 2;
    const rejected = await uploadReceipt(ledgerId, ALEX, overLimit);
    expect(rejected.status).toBe(413);
    expect(await countReceipts()).toBe(1); // only the at-limit upload landed
  });
});

describe("upload — authorization", () => {
  it("non-member upload => 404 (same as a missing ledger, no existence oracle), nothing stored", async () => {
    expect((await uploadReceipt(ledgerId, OUTSIDER, fakeImage("mallory"))).status).toBe(404);
    expect((await uploadReceipt(ledgerId, SAM, fakeImage("sam"))).status).toBe(404);
    expect(
      (await uploadReceipt("no-such-ledger", SAM, fakeImage("sam2"))).status,
    ).toBe(404);
    expect(await countReceipts()).toBe(0);
    const listed = await env.RECEIPTS.list({ prefix: `receipts/${ledgerId}/` });
    expect(listed.objects.length).toBe(0);
  });

  it("unauthenticated upload => 401, nothing stored", async () => {
    const res = await SELF.fetch(
      `https://tally.test/api/ledgers/${ledgerId}/receipts?id=${crypto.randomUUID()}`,
      { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: fakeImage("anon") },
    );
    expect(res.status).toBe(401);
    expect(await countReceipts()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Extraction: POST /api/receipts/:rid/extract — the seven fixtures
// ---------------------------------------------------------------------------

describe("POST /api/receipts/:rid/extract — fixture outcome mapping", () => {
  it("clean.json: needs_review with merchant/date/total and 6 items, assigned_to NULL on every extracted item", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const mock = interceptGateway(cleanFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    expect(mock.calls()).toBe(1);

    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBe("Nong's Khao Man Gai");
    expect(json.receipt.purchased_on).toBe("2026-08-11");
    expect(json.receipt.total_cents).toBe(7550);
    expect(json.items).toHaveLength(6);
    for (const item of json.items) {
      expect(item.assigned_to).toBeNull(); // "other person's" is applied at confirm time, not stored
      expect(Number.isInteger(item.price_cents)).toBe(true);
    }
    const byLabel = new Map(json.items.map((i) => [i.label, i]));
    expect(byLabel.get("Khao man gai")?.price_cents).toBe(2500);
    expect(byLabel.get("Khao man gai")?.qty).toBe("x2");
    expect(byLabel.get("Fried chicken thigh")?.price_cents).toBe(650);
    expect(byLabel.get("Papaya salad")?.price_cents).toBe(875);
    expect(byLabel.get("Thai iced tea")?.price_cents).toBe(900);
    expect(byLabel.get("Thai iced tea")?.qty).toBe("x2");
    expect(byLabel.get("Sticky rice")?.price_cents).toBe(425);
    expect(byLabel.get("Fresh spring rolls")?.price_cents).toBe(575);
    const subtotal = json.items.reduce((acc, i) => acc + (i.price_cents ?? 0), 0);
    expect(subtotal).toBe(CLEAN_SUBTOTAL);

    // DB truth
    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("needs_review");
    expect(row!.raw_json).not.toBeNull(); // cached for next time
    expect(row!.total_cents).toBe(7550);
    expect(await countReceiptItems(receipt.id)).toBe(6);
    for (const r of await receiptItemRows(receipt.id)) {
      expect(r.assigned_to).toBeNull();
    }
  });

  it("no-items.json: needs_review with merchant/date/total and ZERO items (client falls to percent)", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(noItemsFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBe("Trader Joe's");
    expect(json.receipt.purchased_on).toBe("2026-08-02");
    expect(json.receipt.total_cents).toBe(4327);
    expect(json.items).toEqual([]);
    expect(await countReceiptItems(receipt.id)).toBe(0);
  });

  it("handwritten-tip.json: needs_review, items subtotal strictly below the total (the tip gap)", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(handwrittenTipFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBe("La Taqueria");
    expect(json.receipt.purchased_on).toBe("2026-08-09");
    expect(json.receipt.total_cents).toBe(3900);
    expect(json.items).toHaveLength(3);
    const subtotal = json.items.reduce((acc, i) => acc + (i.price_cents ?? 0), 0);
    expect(subtotal).toBe(3200);
    expect(subtotal).toBeLessThan(json.receipt.total_cents!); // extra > 0 at confirm time
    expect(await countReceiptItems(receipt.id)).toBe(3);
  });

  it("not-a-receipt.json: looks_like_receipt=false => needs_review with ALL fields blank, even though the tool input carried values", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(notAReceiptFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBeNull(); // fixture said "Golden Gate Bridge..." — must be blanked
    expect(json.receipt.purchased_on).toBeNull();
    expect(json.receipt.total_cents).toBeNull();
    expect(json.items).toEqual([]);
    expect(await countReceiptItems(receipt.id)).toBe(0);
    const row = await receiptRow(receipt.id);
    expect(row!.merchant).toBeNull();
    expect(row!.raw_json).not.toBeNull();
  });

  it("malformed.json (text-only, no tool_use): needs_review with all blank — NOT failed, NOT a crash; raw_json stores what came back", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(malformedFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBeNull();
    expect(json.receipt.purchased_on).toBeNull();
    expect(json.receipt.total_cents).toBeNull();
    expect(json.items).toEqual([]);
    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("needs_review");
    expect(row!.raw_json).not.toBeNull();
    expect(await countReceiptItems(receipt.id)).toBe(0);
  });

  it("negative-price.json: ENTIRE items list dropped, merchant/date/total salvaged", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(negativePriceFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBe("Corner Deli");
    expect(json.receipt.purchased_on).toBe("2026-08-05");
    expect(json.receipt.total_cents).toBe(2100);
    expect(json.items).toEqual([]); // one bad item poisons the whole list
    expect(await countReceiptItems(receipt.id)).toBe(0);
  });

  it("garbage-date.json: purchased_on null, merchant/total AND items salvaged", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway(garbageDateFixture);

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.receipt.merchant).toBe("Blue Star Donuts");
    expect(json.receipt.purchased_on).toBeNull(); // "AUG 32ND!!" -> null, never a crash
    expect(json.receipt.total_cents).toBe(1850);
    expect(json.items).toHaveLength(4);
    expect(await countReceiptItems(receipt.id)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Extraction: failure modes, caching, request shape, state conflicts
// ---------------------------------------------------------------------------

describe("POST /api/receipts/:rid/extract — gating, failures, cache", () => {
  it("ANTHROPIC_API_KEY absent => 503 'extraction not configured', receipt stays 'uploaded', NO model call", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    clearApiKey(); // the vitest config never binds it; make sure it's gone

    // Deliberately no interceptor: if the worker tried to call the gateway
    // anyway, disableNetConnect would throw and this could not be a 503.
    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(503);
    const err = (await res.json()) as ErrorResponse;
    expect(typeof err.error).toBe("string");

    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("uploaded"); // keeps status; live path is gated on the secret
    expect(row!.raw_json).toBeNull();
  });

  it("gateway HTTP 500 => receipt status 'failed', route 500 { error }, no crash", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    interceptGateway("upstream exploded", { status: 500 });

    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(500);
    const err = (await res.json()) as ErrorResponse;
    expect(typeof err.error).toBe("string");

    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("failed");
    expect(await countReceiptItems(receipt.id)).toBe(0);
  });

  it("network throw from the gateway fetch => receipt 'failed', route 500, never an unhandled exception", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    // No interceptor + disableNetConnect: the outbound fetch REJECTS.
    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(500);
    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("failed");
  });

  it("CACHE: extracting the same receipt twice makes exactly ONE model call; the second returns the cached state", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const mock = interceptGateway(cleanFixture); // consumable exactly once

    const first = await extract(receipt.id, ALEX);
    expect(first.status).toBe(200);
    expect(mock.calls()).toBe(1);

    // A second model call would either bump the counter or (interceptor
    // consumed + disableNetConnect) blow up into a non-200. Both are caught.
    const second = await extract(receipt.id, JORDAN); // any member
    expect(second.status).toBe(200);
    expect(mock.calls()).toBe(1);

    const json = (await second.json()) as ReceiptResponse;
    expect(json.receipt.status).toBe("needs_review");
    expect(json.items).toHaveLength(6);
    expect(await countReceiptItems(receipt.id)).toBe(6); // items not re-written/duplicated
  });

  it("an upload that dedupes onto an EXTRACTED receipt returns its items without any model call", async () => {
    const bytes = fakeImage("dedupe-onto-extracted");
    const firstId = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id: firstId })).status).toBe(201);
    const mock = interceptGateway(cleanFixture);
    expect((await extract(firstId, ALEX)).status).toBe(200);
    expect(mock.calls()).toBe(1);

    const res = await uploadReceipt(ledgerId, JORDAN, bytes, { id: crypto.randomUUID() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as ReceiptResponse;
    expect(json.receipt.id).toBe(firstId);
    expect(json.receipt.status).toBe("needs_review");
    expect(json.items).toHaveLength(6); // dedupe response carries the items
    expect(mock.calls()).toBe(1); // still exactly one model call for these bytes
  });

  it("request shape (rule 7): tool named record_receipt, forced tool_choice, base64 image block, gateway auth headers", async () => {
    const bytes = fakeImage("request-shape");
    const clientId = crypto.randomUUID();
    expect((await uploadReceipt(ledgerId, ALEX, bytes, { id: clientId })).status).toBe(201);

    let captured = "";
    interceptGateway(cleanFixture, {
      // Contract headers: x-api-key from the secret, anthropic-version pinned.
      expectHeaders: { "x-api-key": "test-key", "anthropic-version": "2023-06-01" },
      onBody: (body) => {
        captured = body;
      },
    });

    const res = await extract(clientId, ALEX);
    expect(res.status).toBe(200);
    expect(captured).not.toBe("");

    const body = JSON.parse(captured) as {
      tools?: Array<{ name?: string; input_schema?: unknown }>;
      tool_choice?: { type?: string; name?: string };
      messages?: Array<{ role?: string; content?: unknown }>;
    };

    // A tool definition named record_receipt…
    const tool = (body.tools ?? []).find((t) => t.name === "record_receipt");
    expect(tool).toBeDefined();
    expect(tool!.input_schema).toBeDefined();

    // …with tool_choice FORCING it…
    expect(body.tool_choice).toMatchObject({ type: "tool", name: "record_receipt" });

    // …and the uploaded bytes as a base64 image content block.
    const blocks: Array<Record<string, unknown>> = [];
    for (const msg of body.messages ?? []) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) blocks.push(block);
      }
    }
    const imageBlock = blocks.find((b) => b["type"] === "image");
    expect(imageBlock).toBeDefined();
    const source = imageBlock!["source"] as Record<string, unknown>;
    expect(source["type"]).toBe("base64");
    expect(source["data"]).toBe(toBase64(bytes));
  });

  it("extract on a POSTED receipt => 409, status unchanged", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    await forceStatus(receipt.id, "posted"); // raw_json stays NULL: no cache-hit shortcut
    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(409);
    expect((await receiptRow(receipt.id))!.status).toBe("posted");
  });

  it("extract on a DISCARDED receipt => 409", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect((await discard(receipt.id, ALEX)).status).toBe(200);
    const res = await extract(receipt.id, ALEX);
    expect(res.status).toBe(409);
    expect((await receiptRow(receipt.id))!.status).toBe("discarded");
  });
});

describe("extract & discard — authorization", () => {
  it("extract by a non-member => 404 (no model call), unauthenticated => 401, nonexistent receipt => 404", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);

    // No interceptor is registered: were the worker to call the model for a
    // non-member, the fetch would throw and the status could not be 404.
    expect((await extract(receipt.id, OUTSIDER)).status).toBe(404);
    expect((await extract(receipt.id, SAM)).status).toBe(404);
    expect((await extract(crypto.randomUUID(), ALEX)).status).toBe(404);

    const unauthed = await SELF.fetch(`https://tally.test/api/receipts/${receipt.id}/extract`, {
      method: "POST",
    });
    expect(unauthed.status).toBe(401);

    expect((await receiptRow(receipt.id))!.status).toBe("uploaded"); // untouched throughout
  });

  it("discard by a non-member => 404, unauthenticated => 401, status untouched", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect((await discard(receipt.id, OUTSIDER)).status).toBe(404);
    expect((await discard(receipt.id, SAM)).status).toBe(404);
    const unauthed = await SELF.fetch(`https://tally.test/api/receipts/${receipt.id}/discard`, {
      method: "POST",
    });
    expect(unauthed.status).toBe(401);
    expect((await receiptRow(receipt.id))!.status).toBe("uploaded");
  });
});

// ---------------------------------------------------------------------------
// Discard: POST /api/receipts/:rid/discard
// ---------------------------------------------------------------------------

describe("POST /api/receipts/:rid/discard", () => {
  it("member discard => 200 and status 'discarded'; either member may discard", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await discard(receipt.id, JORDAN);
    expect(res.status).toBe(200);
    expect((await receiptRow(receipt.id))!.status).toBe("discarded");
  });

  it("idempotent: discarding a discarded receipt is 200 again", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect((await discard(receipt.id, ALEX)).status).toBe(200);
    expect((await discard(receipt.id, ALEX)).status).toBe(200);
    expect((await receiptRow(receipt.id))!.status).toBe("discarded");
  });

  it("posted receipt => 409, stays posted (history is append-only)", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    await forceStatus(receipt.id, "posted");
    const res = await discard(receipt.id, ALEX);
    expect(res.status).toBe(409);
    expect((await receiptRow(receipt.id))!.status).toBe("posted");
  });

  it("nonexistent receipt => 404", async () => {
    expect((await discard(crypto.randomUUID(), ALEX)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// THE M2 GATE WALK: upload -> extract -> needs_review -> POST items -> posted
// ---------------------------------------------------------------------------

describe("M2 gate: upload -> extract (clean) -> confirm with edited total -> posted, balance checked from both members", () => {
  it("walks the whole gate", async () => {
    // Pre-existing history so the running balance is non-trivial:
    // manual expense, ALEX paid, other_share 1000 -> canonical delta +1000.
    await insertExpense({
      ledger_id: ledgerId,
      occurred_on: "2026-08-01",
      merchant: "Corner Cafe",
      total_cents: 2000,
      payer: ALEX,
      other_share_cents: 1000,
      created_at: 1_000_000,
    });

    // 1. Upload
    const receipt = await freshReceipt(ledgerId, ALEX);

    // 2. Extract via the mocked gateway -> needs_review with the demo items
    interceptGateway(cleanFixture);
    const extracted = await extract(receipt.id, ALEX);
    expect(extracted.status).toBe(200);
    expect(((await extracted.json()) as ReceiptResponse).receipt.status).toBe("needs_review");

    // 3. Confirm: six items, mixed canonical assignments, edited total 7650.
    //    Expected split (hand-checked, integer cents; ALEX pays, JORDAN owes):
    //      JORDAN full items: 2500 + 900             = 3400
    //      half items:        875 + 425              = 1300
    //      other_sub  = (2*3400 + 1300) / 2 units    = 8100/2 = 4050
    //      subtotal   = 5925;  extra = 7650 - 5925   = 1725
    //      other_extra = roundHalfUp(1725*4050/5925) = roundHalfUp(1179.11) = 1179
    //      other_share = 4050 + 1179                 = 5229
    const expected = splitItems(
      CONFIRMED_ITEMS.map((i) => ({ price_cents: i.price_cents, assigned_to: i.assigned_to })),
      ALEX,
      JORDAN,
      EDITED_TOTAL,
    );
    expect(expected.other_share_cents).toBe(5229); // guard the guard
    expect(expected.extra_cents).toBe(EDITED_TOTAL - CLEAN_SUBTOTAL);

    const expenseId = crypto.randomUUID();
    const body = {
      id: expenseId,
      occurred_on: "2026-08-11",
      merchant: "Nong's Khao Man Gai",
      total_cents: EDITED_TOTAL,
      payer: ALEX,
      method: "items",
      receipt_id: receipt.id,
      items: CONFIRMED_ITEMS.map((i) => ({
        label: i.label,
        qty: i.qty,
        price_cents: i.price_cents,
        assigned_to: i.assigned_to,
      })),
      // Client-supplied share is a lie the server must ignore and recompute.
      other_share_cents: 1,
    };
    const created = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(created.status).toBe(201);
    const entry = ((await created.json()) as EntryResponse).entry;
    expect(entry.id).toBe(expenseId);
    expect(entry.kind).toBe("expense");
    expect(entry.expense?.method).toBe("items");
    expect(entry.expense?.receipt_id).toBe(receipt.id);
    expect(entry.expense?.total_cents).toBe(EDITED_TOTAL);
    // Server recomputes with splitItems; client's other_share_cents: 1 ignored.
    expect(entry.expense?.other_share_cents).toBe(expected.other_share_cents);
    // extra_cents = total - items subtotal (server-computed display metadata).
    expect(entry.expense?.extra_cents).toBe(EDITED_TOTAL - CLEAN_SUBTOTAL);
    // payer === person_a -> canonical delta = +other_share
    expect(entry.delta_cents).toBe(expected.other_share_cents);
    expect(entry.running_cents).toBe(1000 + expected.other_share_cents);

    // 4. Receipt is now POSTED and carries the CONFIRMED values.
    const row = await receiptRow(receipt.id);
    expect(row!.status).toBe("posted");
    expect(row!.merchant).toBe("Nong's Khao Man Gai");
    expect(row!.purchased_on).toBe("2026-08-11");
    expect(row!.total_cents).toBe(EDITED_TOTAL); // edited total wins over the printed 7550

    // 5. receipt_items REPLACED with the posted assignments (still 6 rows,
    //    canonical assigned_to now set — extracted rows were all NULL).
    const itemRows = await receiptItemRows(receipt.id);
    expect(itemRows).toHaveLength(6);
    const sortedExpected = [...CONFIRMED_ITEMS].sort((a, b) => a.label.localeCompare(b.label));
    itemRows.forEach((r, idx) => {
      const want = sortedExpected[idx]!;
      expect(r.label).toBe(want.label);
      expect(r.price_cents).toBe(want.price_cents);
      expect(r.assigned_to).toBe(want.assigned_to);
      expect(r.qty ?? null).toBe(want.qty);
    });

    // 6. Ledger detail from BOTH members: canonical delta and running balance.
    for (const viewer of [ALEX, JORDAN]) {
      const detailRes = await authedFetch(`/api/ledgers/${ledgerId}`, viewer);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as LedgerDetail;
      expect(detail.entries).toHaveLength(2);
      const last = detail.entries[1]!;
      expect(last.id).toBe(expenseId);
      expect(last.delta_cents).toBe(expected.other_share_cents);
      expect(last.running_cents).toBe(1000 + expected.other_share_cents);
    }

    // 7. Idempotency: repeat the SAME POST -> 200 no-op, no duplicate rows.
    const repeat = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as EntryResponse).entry.id).toBe(expenseId);
    expect(await countExpenses(ledgerId)).toBe(2); // manual fixture + the items expense
    expect(await countReceiptItems(receipt.id)).toBe(6); // items NOT re-replaced/duplicated
  });
});

// ---------------------------------------------------------------------------
// method 'items' — validation
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/expenses method 'items' — validation", () => {
  // Minimal known-valid body: two items, total 1100.
  //   other_sub = 600 (Item A -> JORDAN); extra = 1100 - 1000 = 100
  //   other_extra = roundHalfUp(100*600/1000) = 60; other_share = 660
  const BASE_TOTAL = 1100;
  const BASE_OTHER_SHARE = 660;
  function baseBody(rid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: crypto.randomUUID(),
      occurred_on: "2026-08-10",
      merchant: "Validation Cafe",
      total_cents: BASE_TOTAL,
      payer: ALEX,
      method: "items",
      receipt_id: rid,
      other_share_cents: BASE_OTHER_SHARE,
      items: [
        { label: "Item A", qty: null, price_cents: 600, assigned_to: JORDAN },
        { label: "Item B", qty: null, price_cents: 400, assigned_to: ALEX },
      ],
      ...overrides,
    };
  }

  it("control: the base body is valid — 201, receipt posted, share/extra recomputed by the server", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, baseBody(receipt.id));
    expect(res.status).toBe(201);
    const entry = ((await res.json()) as EntryResponse).entry;
    expect(entry.expense?.other_share_cents).toBe(BASE_OTHER_SHARE);
    expect(entry.expense?.extra_cents).toBe(100);
    expect((await receiptRow(receipt.id))!.status).toBe("posted");
    expect(await countReceiptItems(receipt.id)).toBe(2);
  });

  it("method 'items' without receipt_id => 400, nothing written", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      baseBody(receipt.id, { receipt_id: undefined }),
    );
    expect(res.status).toBe(400);
    expect(await countExpenses(ledgerId)).toBe(0);
    expect((await receiptRow(receipt.id))!.status).toBe("uploaded");
  });

  it("receipt belonging to ANOTHER ledger => 400/404, nothing written, foreign receipt untouched", async () => {
    const otherLedger = await insertLedger(ALEX, SAM);
    const foreignReceipt = await freshReceipt(otherLedger, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      baseBody(foreignReceipt.id),
    );
    expect([400, 404]).toContain(res.status);
    expect(await countExpenses(ledgerId)).toBe(0);
    expect((await receiptRow(foreignReceipt.id))!.status).toBe("uploaded");
  });

  it("already-POSTED receipt => 409 (it already has its expense), no second expense", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect(
      (await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, baseBody(receipt.id))).status,
    ).toBe(201);

    const res = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, baseBody(receipt.id));
    expect(res.status).toBe(409);
    expect(await countExpenses(ledgerId)).toBe(1);
  });

  it("DISCARDED receipt => 409, nothing written", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect((await discard(receipt.id, ALEX)).status).toBe(200);
    const res = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, baseBody(receipt.id));
    expect(res.status).toBe(409);
    expect(await countExpenses(ledgerId)).toBe(0);
    expect((await receiptRow(receipt.id))!.status).toBe("discarded");
  });

  const rejections: Array<[string, Record<string, unknown>]> = [
    [
      "more than 100 items",
      {
        total_cents: 101,
        items: Array.from({ length: 101 }, (_, i) => ({
          label: `item ${i}`,
          price_cents: 1,
          assigned_to: JORDAN,
        })),
      },
    ],
    ["zero items (route requires 1..100)", { items: [] }],
    [
      "viewer-relative assigned_to 'mine' (a client bug, never canonical)",
      { items: [{ label: "Item A", price_cents: 600, assigned_to: "mine" }] },
    ],
    [
      "viewer-relative assigned_to 'theirs'",
      { items: [{ label: "Item A", price_cents: 600, assigned_to: "theirs" }] },
    ],
    [
      "assigned_to a non-member email",
      { items: [{ label: "Item A", price_cents: 600, assigned_to: OUTSIDER }] },
    ],
    [
      "negative item price",
      { items: [{ label: "Item A", price_cents: -600, assigned_to: JORDAN }] },
    ],
    [
      "float item price",
      { items: [{ label: "Item A", price_cents: 600.5, assigned_to: JORDAN }] },
    ],
    [
      "empty item label",
      { items: [{ label: "", price_cents: 600, assigned_to: JORDAN }] },
    ],
    [
      "item label over 200 chars",
      { items: [{ label: "x".repeat(201), price_cents: 600, assigned_to: JORDAN }] },
    ],
    [
      "qty longer than 10 chars",
      { items: [{ label: "Item A", qty: "x2345678901", price_cents: 600, assigned_to: JORDAN }] },
    ],
    [
      "item missing price_cents",
      { items: [{ label: "Item A", assigned_to: JORDAN }] },
    ],
  ];
  for (const [name, overrides] of rejections) {
    it(`rejects ${name} => 400, nothing written, receipt not posted`, async () => {
      const receipt = await freshReceipt(ledgerId, ALEX);
      const res = await postJson(
        `/api/ledgers/${ledgerId}/expenses`,
        ALEX,
        baseBody(receipt.id, overrides),
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as ErrorResponse;
      expect(typeof err.error).toBe("string");
      expect(await countExpenses(ledgerId)).toBe(0);
      expect((await receiptRow(receipt.id))!.status).toBe("uploaded");
      expect(await countReceiptItems(receipt.id)).toBe(0);
    });
  }

  it("client-supplied other_share_cents is IGNORED for method 'items' — server recomputes with splitItems", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      baseBody(receipt.id, { other_share_cents: 1 }), // wrong on purpose
    );
    expect(res.status).toBe(201);
    const entry = ((await res.json()) as EntryResponse).entry;
    expect(entry.expense?.other_share_cents).toBe(BASE_OTHER_SHARE); // recomputed, not 1
    expect(entry.delta_cents).toBe(BASE_OTHER_SHARE); // payer === person_a
  });

  it("client-supplied extra_cents is not accepted: either rejected (400) or ignored and recomputed", async () => {
    // Contract: "extra_cents: NOT accepted from the client — server computes
    // total_cents - items_subtotal". Both a 400 and a silent recompute honor
    // that; what is FORBIDDEN is storing the client's number.
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      baseBody(receipt.id, { extra_cents: 55_555 }),
    );
    if (res.status === 400) {
      expect(await countExpenses(ledgerId)).toBe(0);
      expect((await receiptRow(receipt.id))!.status).toBe("uploaded");
    } else {
      expect(res.status).toBe(201);
      const entry = ((await res.json()) as EntryResponse).entry;
      expect(entry.expense?.extra_cents).toBe(100); // server's number, never 55555
    }
  });

  it("negative extra is legal: an edited total BELOW the item subtotal posts with extra_cents < 0", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    // subtotal 1000, total 900 -> extra -100, distributed proportionally:
    // other_sub 600; other_extra = roundHalfUp(-100*600/1000) = -60; share 540.
    const expected = splitItems(
      [
        { price_cents: 600, assigned_to: JORDAN },
        { price_cents: 400, assigned_to: ALEX },
      ],
      ALEX,
      JORDAN,
      900,
    );
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      baseBody(receipt.id, { total_cents: 900, other_share_cents: expected.other_share_cents }),
    );
    expect(res.status).toBe(201);
    const entry = ((await res.json()) as EntryResponse).entry;
    expect(entry.expense?.extra_cents).toBe(-100);
    expect(entry.expense?.other_share_cents).toBe(expected.other_share_cents);
    expect(expected.other_share_cents + expected.payer_share_cents).toBe(900); // penny rule holds
  });
});

// ---------------------------------------------------------------------------
// percent / manual with an optional receipt_id
// ---------------------------------------------------------------------------

describe("percent/manual expenses with optional receipt_id", () => {
  function percentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: crypto.randomUUID(),
      occurred_on: "2026-08-02",
      merchant: "Trader Joe's",
      total_cents: 4327,
      payer: ALEX,
      method: "percent",
      other_share_cents: 2164,
      note: "Halved by percentage — no line items on the photo.",
      ...overrides,
    };
  }

  it("percent with a valid receipt_id => 201, receipt marked 'posted', expense linked", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      percentBody({ receipt_id: receipt.id }),
    );
    expect(res.status).toBe(201);
    const entry = ((await res.json()) as EntryResponse).entry;
    expect(entry.expense?.method).toBe("percent");
    expect(entry.expense?.receipt_id).toBe(receipt.id);
    expect(entry.expense?.other_share_cents).toBe(2164); // percent keeps the client's share
    expect((await receiptRow(receipt.id))!.status).toBe("posted");
  });

  it("manual with a valid receipt_id => 201 and the receipt is posted", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      percentBody({ method: "manual", note: "Entered by hand.", receipt_id: receipt.id }),
    );
    expect(res.status).toBe(201);
    expect((await receiptRow(receipt.id))!.status).toBe("posted");
  });

  it("wrong-ledger receipt_id => 400/404, nothing written, receipt untouched", async () => {
    const otherLedger = await insertLedger(ALEX, SAM);
    const foreignReceipt = await freshReceipt(otherLedger, ALEX);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      percentBody({ receipt_id: foreignReceipt.id }),
    );
    expect([400, 404]).toContain(res.status);
    expect(await countExpenses(ledgerId)).toBe(0);
    expect((await receiptRow(foreignReceipt.id))!.status).toBe("uploaded");
  });

  it("discarded receipt_id => rejected (400/409), nothing written", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect((await discard(receipt.id, ALEX)).status).toBe(200);
    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      percentBody({ receipt_id: receipt.id }),
    );
    expect([400, 409]).toContain(res.status);
    expect(await countExpenses(ledgerId)).toBe(0);
    expect((await receiptRow(receipt.id))!.status).toBe("discarded");
  });

  it("already-posted receipt_id => rejected (400/409), the receipt already has its expense", async () => {
    const receipt = await freshReceipt(ledgerId, ALEX);
    expect(
      (
        await postJson(
          `/api/ledgers/${ledgerId}/expenses`,
          ALEX,
          percentBody({ receipt_id: receipt.id }),
        )
      ).status,
    ).toBe(201);

    const res = await postJson(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      percentBody({ receipt_id: receipt.id }),
    );
    expect([400, 409]).toContain(res.status);
    expect(await countExpenses(ledgerId)).toBe(1);
  });

  it("percent/manual WITHOUT receipt_id still work exactly as in M1 (receipt_id null)", async () => {
    const res = await postJson(`/api/ledgers/${ledgerId}/expenses`, ALEX, percentBody());
    expect(res.status).toBe(201);
    const entry = ((await res.json()) as EntryResponse).entry;
    expect(entry.expense?.receipt_id).toBeNull();
    expect(entry.delta_cents).toBe(2164);
  });
});
