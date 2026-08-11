// Integration tests for the M1 mutation routes, written against
// M1_CONTRACT.md ONLY, exercised through the real Worker (SELF.fetch) with
// forged-valid Access JWTs.
//
//   POST /api/ledgers/:id/expenses
//   POST /api/ledgers/:id/settlements
//   POST /api/ledgers/:id/expenses/:expenseId/void
//
// ALL MONEY IS INTEGER CENTS. delta_cents/running_cents in ApiEntry are
// CANONICAL (person_a perspective) regardless of who fetches.

import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { authedFetch } from "../helpers/auth";
import { ALEX, JORDAN, SAM, OUTSIDER, insertLedger } from "../helpers/fixtures";
import type { ApiEntry, LedgerDetail } from "../../src/shared/types";

interface EntryResponse {
  entry: ApiEntry;
}
interface ErrorResponse {
  error: string;
}

function post(path: string, email: string, body: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postUnauthed(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://tally.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function entryOf(res: Response): Promise<ApiEntry> {
  const json = (await res.json()) as EntryResponse;
  expect(json.entry).toBeDefined();
  return json.entry;
}

async function getDetail(ledgerId: string, email: string): Promise<LedgerDetail> {
  const res = await authedFetch(`/api/ledgers/${ledgerId}`, email);
  expect(res.status).toBe(200);
  return (await res.json()) as LedgerDetail;
}

async function balanceOf(ledgerId: string, email: string): Promise<number> {
  const detail = await getDetail(ledgerId, email);
  const last = detail.entries[detail.entries.length - 1];
  return last ? last.running_cents : 0;
}

async function countRows(table: "expenses" | "settlements"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  return row!.n;
}

// ALEX < JORDAN lexicographically, so ALEX is person_a in this ledger.
let ledgerId: string;
beforeEach(async () => {
  ledgerId = await insertLedger(ALEX, JORDAN);
});

function expenseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    occurred_on: "2026-08-01",
    merchant: "Corner Cafe",
    total_cents: 1000,
    payer: ALEX,
    method: "manual",
    other_share_cents: 700,
    ...overrides,
  };
}

function settlementBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    occurred_on: "2026-08-02",
    from_email: JORDAN,
    to_email: ALEX,
    amount_cents: 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Expenses — happy paths, canonical signs from both payers and both viewers
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/expenses — happy path", () => {
  it("payer === person_a: 201, canonical delta === +other_share_cents, and both members read the same canonical numbers", async () => {
    const body = expenseBody({ payer: ALEX, total_cents: 1000, other_share_cents: 700 });
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(res.status).toBe(201);
    const entry = await entryOf(res);
    expect(entry.id).toBe(body["id"]);
    expect(entry.kind).toBe("expense");
    expect(entry.occurred_on).toBe("2026-08-01");
    expect(entry.delta_cents).toBe(700); // payer===person_a -> +other_share
    expect(entry.running_cents).toBe(700); // first and only entry
    expect(entry.expense?.merchant).toBe("Corner Cafe");
    expect(entry.expense?.payer).toBe(ALEX);
    expect(entry.expense?.total_cents).toBe(1000);
    expect(entry.expense?.other_share_cents).toBe(700);
    expect(entry.expense?.method).toBe("manual");
    expect(entry.expense?.created_by).toBe(ALEX); // created_by = authenticated caller
    expect(entry.expense?.reverses_id).toBeNull();

    // Both viewers see the SAME canonical delta/running via GET (the API is
    // canonical; the UI negates for person_b).
    const asAlex = await getDetail(ledgerId, ALEX);
    const asJordan = await getDetail(ledgerId, JORDAN);
    expect(asAlex.entries).toHaveLength(1);
    expect(asJordan.entries).toHaveLength(1);
    expect(asAlex.entries[0]!.delta_cents).toBe(700);
    expect(asJordan.entries[0]!.delta_cents).toBe(700);
    expect(asAlex.entries[0]!.running_cents).toBe(700);
    expect(asJordan.entries[0]!.running_cents).toBe(700);
  });

  it("payer === person_b: 201, canonical delta === -other_share_cents for both viewers", async () => {
    const body = expenseBody({ payer: JORDAN, total_cents: 1000, other_share_cents: 300 });
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, JORDAN, body);
    expect(res.status).toBe(201);
    const entry = await entryOf(res);
    expect(entry.delta_cents).toBe(-300); // payer===person_b -> -other_share
    expect(entry.running_cents).toBe(-300);
    expect(entry.expense?.created_by).toBe(JORDAN);

    const asAlex = await getDetail(ledgerId, ALEX);
    const asJordan = await getDetail(ledgerId, JORDAN);
    expect(asAlex.entries[0]!.delta_cents).toBe(-300);
    expect(asJordan.entries[0]!.delta_cents).toBe(-300);
  });

  it("a member may record an expense paid by the OTHER member; created_by is the caller, sign follows the payer", async () => {
    // JORDAN records that ALEX paid.
    const body = expenseBody({ payer: ALEX, other_share_cents: 450 });
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, JORDAN, body);
    expect(res.status).toBe(201);
    const entry = await entryOf(res);
    expect(entry.delta_cents).toBe(450);
    expect(entry.expense?.payer).toBe(ALEX);
    expect(entry.expense?.created_by).toBe(JORDAN);
  });

  it("boundary shares are valid: other_share 0, other_share === total, and total 0", async () => {
    const zeroShare = await post(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      expenseBody({ other_share_cents: 0 }),
    );
    expect(zeroShare.status).toBe(201);
    expect((await entryOf(zeroShare)).delta_cents).toBe(0);

    const fullShare = await post(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      expenseBody({ other_share_cents: 1000, occurred_on: "2026-08-02" }),
    );
    expect(fullShare.status).toBe(201);
    expect((await entryOf(fullShare)).delta_cents).toBe(1000);

    const zeroTotal = await post(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      expenseBody({ total_cents: 0, other_share_cents: 0, occurred_on: "2026-08-03" }),
    );
    expect(zeroTotal.status).toBe(201);

    expect(await countRows("expenses")).toBe(3);
  });

  it("method 'percent' is accepted in M1", async () => {
    const res = await post(
      `/api/ledgers/${ledgerId}/expenses`,
      ALEX,
      expenseBody({ method: "percent", total_cents: 4979, other_share_cents: 2490 }),
    );
    expect(res.status).toBe(201);
    expect((await entryOf(res)).expense?.method).toBe("percent");
  });
});

// ---------------------------------------------------------------------------
// Expenses — validation failures => 400 { error }
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/expenses — validation => 400 with { error: string }, no row written", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["non-padded date '2026-2-3'", { occurred_on: "2026-2-3" }],
    ["impossible date '2026-13-40'", { occurred_on: "2026-13-40" }],
    ["non-calendar date '2026-02-30'", { occurred_on: "2026-02-30" }],
    ["float total_cents 12.5", { total_cents: 12.5, other_share_cents: 6 }],
    ["negative total_cents", { total_cents: -5, other_share_cents: 0 }],
    ["other_share_cents > total_cents", { total_cents: 1000, other_share_cents: 1100 }],
    ["negative other_share_cents", { other_share_cents: -1 }],
    ["float other_share_cents 700.5", { other_share_cents: 700.5 }],
    ["payer not a ledger member", { payer: OUTSIDER }],
    ["method 'items' rejected in M1", { method: "items" }],
    ["unknown method", { method: "vibes" }],
    ["missing id", { id: undefined }],
    ["missing occurred_on", { occurred_on: undefined }],
    ["missing merchant", { merchant: undefined }],
    ["merchant empty after trim", { merchant: "   " }],
    ["merchant longer than 200 chars after trim", { merchant: "m".repeat(201) }],
    ["missing total_cents", { total_cents: undefined }],
    ["missing payer", { payer: undefined }],
    ["missing other_share_cents", { other_share_cents: undefined }],
    ["note longer than 500 chars", { note: "n".repeat(501) }],
  ];

  for (const [name, overrides] of cases) {
    it(`rejects ${name}`, async () => {
      const res = await post(
        `/api/ledgers/${ledgerId}/expenses`,
        ALEX,
        expenseBody(overrides),
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as ErrorResponse;
      expect(typeof err.error).toBe("string");
      expect(await countRows("expenses")).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Settlements — happy paths & canonical signs
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/settlements — happy path", () => {
  it("from_email === person_a: 201, canonical delta === +amount_cents", async () => {
    const body = settlementBody({ from_email: ALEX, to_email: JORDAN, amount_cents: 1234 });
    const res = await post(`/api/ledgers/${ledgerId}/settlements`, ALEX, body);
    expect(res.status).toBe(201);
    const entry = await entryOf(res);
    expect(entry.kind).toBe("settlement");
    expect(entry.delta_cents).toBe(1234);
    expect(entry.running_cents).toBe(1234);
    expect(entry.settlement?.from_email).toBe(ALEX);
    expect(entry.settlement?.to_email).toBe(JORDAN);
    expect(entry.settlement?.amount_cents).toBe(1234);
  });

  it("from_email === person_b: 201, canonical delta === -amount_cents, same numbers for both viewers", async () => {
    const body = settlementBody({ from_email: JORDAN, to_email: ALEX, amount_cents: 999 });
    const res = await post(`/api/ledgers/${ledgerId}/settlements`, JORDAN, body);
    expect(res.status).toBe(201);
    const entry = await entryOf(res);
    expect(entry.delta_cents).toBe(-999);

    const asAlex = await getDetail(ledgerId, ALEX);
    const asJordan = await getDetail(ledgerId, JORDAN);
    expect(asAlex.entries[0]!.delta_cents).toBe(-999);
    expect(asJordan.entries[0]!.delta_cents).toBe(-999);
  });
});

describe("POST /api/ledgers/:id/settlements — validation => 400, no row written", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["amount_cents 0 (must be > 0)", { amount_cents: 0 }],
    ["negative amount_cents", { amount_cents: -500 }],
    ["float amount_cents 12.5", { amount_cents: 12.5 }],
    ["from_email === to_email", { from_email: ALEX, to_email: ALEX }],
    ["from_email not a member", { from_email: OUTSIDER, to_email: ALEX }],
    ["to_email not a member", { from_email: ALEX, to_email: OUTSIDER }],
    ["bad date '2026-2-3'", { occurred_on: "2026-2-3" }],
    ["impossible date '2026-13-40'", { occurred_on: "2026-13-40" }],
    ["missing id", { id: undefined }],
    ["missing amount_cents", { amount_cents: undefined }],
  ];

  for (const [name, overrides] of cases) {
    it(`rejects ${name}`, async () => {
      const res = await post(
        `/api/ledgers/${ledgerId}/settlements`,
        ALEX,
        settlementBody(overrides),
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as ErrorResponse;
      expect(typeof err.error).toBe("string");
      expect(await countRows("settlements")).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Authorization — every route: non-member 404 (no existence oracle),
// unauthenticated 401
// ---------------------------------------------------------------------------

describe("authorization on every mutation route", () => {
  it("non-member POST expenses => 404, no row written", async () => {
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, OUTSIDER, expenseBody());
    expect(res.status).toBe(404);
    expect(await countRows("expenses")).toBe(0);
  });

  it("non-member POST settlements => 404, no row written", async () => {
    const res = await post(
      `/api/ledgers/${ledgerId}/settlements`,
      OUTSIDER,
      settlementBody(),
    );
    expect(res.status).toBe(404);
    expect(await countRows("settlements")).toBe(0);
  });

  it("non-member POST void => 404 even for a real expense, no reversal written", async () => {
    const body = expenseBody();
    const created = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(created.status).toBe(201);
    const res = await post(
      `/api/ledgers/${ledgerId}/expenses/${body["id"]}/void`,
      OUTSIDER,
      { id: crypto.randomUUID(), occurred_on: "2026-08-05" },
    );
    expect(res.status).toBe(404);
    expect(await countRows("expenses")).toBe(1);
  });

  it("a valid user who is simply not a member (SAM) gets the same 404 as a missing ledger — no existence oracle", async () => {
    const asNonMember = await post(`/api/ledgers/${ledgerId}/expenses`, SAM, expenseBody());
    const asMissing = await post(`/api/ledgers/no-such-ledger/expenses`, SAM, expenseBody());
    expect(asNonMember.status).toBe(404);
    expect(asMissing.status).toBe(404);
  });

  it("member POST to a nonexistent ledger => 404 on all three routes", async () => {
    expect(
      (await post(`/api/ledgers/nope/expenses`, ALEX, expenseBody())).status,
    ).toBe(404);
    expect(
      (await post(`/api/ledgers/nope/settlements`, ALEX, settlementBody())).status,
    ).toBe(404);
    expect(
      (
        await post(`/api/ledgers/nope/expenses/whatever/void`, ALEX, {
          id: crypto.randomUUID(),
          occurred_on: "2026-08-05",
        })
      ).status,
    ).toBe(404);
  });

  it("unauthenticated (no JWT) => 401 on all three routes, no row written", async () => {
    expect(
      (await postUnauthed(`/api/ledgers/${ledgerId}/expenses`, expenseBody())).status,
    ).toBe(401);
    expect(
      (await postUnauthed(`/api/ledgers/${ledgerId}/settlements`, settlementBody()))
        .status,
    ).toBe(401);
    expect(
      (
        await postUnauthed(`/api/ledgers/${ledgerId}/expenses/some-id/void`, {
          id: crypto.randomUUID(),
          occurred_on: "2026-08-05",
        })
      ).status,
    ).toBe(401);
    expect(await countRows("expenses")).toBe(0);
    expect(await countRows("settlements")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — the client-generated id is the key on all three routes
// ---------------------------------------------------------------------------

describe("idempotency: repeat POST with the same id is a no-op", () => {
  it("expense: byte-identical repeat => 200, same entry, exactly one row, balance unchanged", async () => {
    const body = expenseBody({ other_share_cents: 700 });
    const first = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(first.status).toBe(201);

    const repeat = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(repeat.status).toBe(200);
    const entry = await entryOf(repeat);
    expect(entry.id).toBe(body["id"]);
    expect(entry.delta_cents).toBe(700);

    expect(await countRows("expenses")).toBe(1);
    const detail = await getDetail(ledgerId, ALEX);
    expect(detail.entries).toHaveLength(1);
    expect(await balanceOf(ledgerId, ALEX)).toBe(700);
  });

  it("expense: same id with a DIFFERENT payload => still a no-op returning the original, no second row", async () => {
    const id = crypto.randomUUID();
    const original = expenseBody({ id, merchant: "Original", total_cents: 1000, other_share_cents: 700 });
    const first = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, original);
    expect(first.status).toBe(201);

    const mutated = expenseBody({ id, merchant: "Sneaky Edit", total_cents: 9999, other_share_cents: 9999 });
    const repeat = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, mutated);
    expect(repeat.status).toBe(200);
    const entry = await entryOf(repeat);
    expect(entry.id).toBe(id);
    expect(entry.expense?.merchant).toBe("Original");
    expect(entry.expense?.total_cents).toBe(1000);
    expect(entry.expense?.other_share_cents).toBe(700);

    expect(await countRows("expenses")).toBe(1);
    expect(await balanceOf(ledgerId, ALEX)).toBe(700);
  });

  it("expense: same id posted to a DIFFERENT ledger => 409 without leaking the original; the second ledger stays empty", async () => {
    // Contract amendment (recorded in REVIEW-M1.md): a cross-ledger id
    // collision is not a "repeat" — echoing the original row from another
    // ledger's endpoint would leak data when the caller isn't a member of
    // the original's ledger. The API answers 409 and writes nothing.
    const otherLedger = await insertLedger(ALEX, SAM);
    const id = crypto.randomUUID();
    const original = expenseBody({ id, merchant: "Original" });
    const first = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, original);
    expect(first.status).toBe(201);

    const crossPost = await post(
      `/api/ledgers/${otherLedger}/expenses`,
      ALEX,
      expenseBody({ id, merchant: "Cross-ledger", payer: ALEX }),
    );
    expect(crossPost.status).toBe(409);
    const body = (await crossPost.json()) as { error?: string; entry?: unknown };
    expect(body.entry).toBeUndefined(); // nothing from the other ledger leaks
    expect(typeof body.error).toBe("string");

    expect(await countRows("expenses")).toBe(1);
    const otherDetail = await getDetail(otherLedger, ALEX);
    expect(otherDetail.entries).toHaveLength(0);
  });

  it("settlement: byte-identical repeat => 200, exactly one row, balance unchanged", async () => {
    const body = settlementBody({ from_email: JORDAN, to_email: ALEX, amount_cents: 500 });
    const first = await post(`/api/ledgers/${ledgerId}/settlements`, JORDAN, body);
    expect(first.status).toBe(201);

    const repeat = await post(`/api/ledgers/${ledgerId}/settlements`, JORDAN, body);
    expect(repeat.status).toBe(200);
    const entry = await entryOf(repeat);
    expect(entry.id).toBe(body["id"]);

    expect(await countRows("settlements")).toBe(1);
    expect(await balanceOf(ledgerId, ALEX)).toBe(-500);
  });

  it("settlement: same id different payload => no second row, balance unchanged", async () => {
    const id = crypto.randomUUID();
    const first = await post(
      `/api/ledgers/${ledgerId}/settlements`,
      JORDAN,
      settlementBody({ id, amount_cents: 500 }),
    );
    expect(first.status).toBe(201);

    const repeat = await post(
      `/api/ledgers/${ledgerId}/settlements`,
      JORDAN,
      settlementBody({ id, amount_cents: 77777 }),
    );
    expect(repeat.status).toBe(200);
    expect((await entryOf(repeat)).settlement?.amount_cents).toBe(500);

    expect(await countRows("settlements")).toBe(1);
    expect(await balanceOf(ledgerId, ALEX)).toBe(-500);
  });

  it("void: repeat POST with the same body id => 200 no-op returning the existing reversal, no second reversal", async () => {
    const expense = expenseBody({ other_share_cents: 700 });
    expect(
      (await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, expense)).status,
    ).toBe(201);

    const voidBody = { id: crypto.randomUUID(), occurred_on: "2026-08-05" };
    const first = await post(
      `/api/ledgers/${ledgerId}/expenses/${expense["id"]}/void`,
      ALEX,
      voidBody,
    );
    expect(first.status).toBe(201);
    const reversal = await entryOf(first);
    expect(reversal.id).toBe(voidBody.id);

    const repeat = await post(
      `/api/ledgers/${ledgerId}/expenses/${expense["id"]}/void`,
      ALEX,
      voidBody,
    );
    expect(repeat.status).toBe(200);
    expect((await entryOf(repeat)).id).toBe(voidBody.id);

    // original + exactly one reversal
    expect(await countRows("expenses")).toBe(2);
    expect(await balanceOf(ledgerId, ALEX)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Void semantics
// ---------------------------------------------------------------------------

describe("POST /api/ledgers/:id/expenses/:expenseId/void — reversal semantics", () => {
  it("creates a reversing expense that restores the prior balance exactly, with the contract's field copies", async () => {
    // e1: ALEX pays, other_share 700  -> delta +700, balance 700
    // e2: JORDAN pays, other_share 300 -> delta -300, balance 400
    const e1 = expenseBody({
      merchant: "Bagel Shop",
      method: "percent",
      total_cents: 1399,
      other_share_cents: 700,
      occurred_on: "2026-08-01",
    });
    const e2 = expenseBody({
      payer: JORDAN,
      other_share_cents: 300,
      occurred_on: "2026-08-02",
    });
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, e1)).status).toBe(201);
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, JORDAN, e2)).status).toBe(201);
    expect(await balanceOf(ledgerId, ALEX)).toBe(400);

    // Void e1: reversal has other_share = -700, payer ALEX -> delta -700.
    // Balance becomes 400 - 700 = -300, exactly the history without e1.
    const voidBody = { id: crypto.randomUUID(), occurred_on: "2026-08-03" };
    const res = await post(
      `/api/ledgers/${ledgerId}/expenses/${e1["id"]}/void`,
      JORDAN, // any member may void
      voidBody,
    );
    expect(res.status).toBe(201);
    const reversal = await entryOf(res);
    expect(reversal.kind).toBe("expense");
    expect(reversal.delta_cents).toBe(-700);
    expect(reversal.expense?.merchant).toBe("Bagel Shop"); // same merchant
    expect(reversal.expense?.method).toBe("percent"); // same method
    expect(reversal.expense?.total_cents).toBe(1399); // same total
    expect(reversal.expense?.payer).toBe(ALEX); // same payer
    expect(reversal.expense?.other_share_cents).toBe(-700); // negated share
    expect(reversal.expense?.reverses_id).toBe(e1["id"]);
    expect(reversal.expense?.note).toBe("Void");
    expect(reversal.expense?.receipt_id).toBeNull();
    expect(reversal.expense?.extra_cents).toBeNull();
    expect(reversal.expense?.created_by).toBe(JORDAN); // created_by = caller

    expect(await balanceOf(ledgerId, ALEX)).toBe(-300);

    // The original is marked as reversed in the ledger detail.
    const detail = await getDetail(ledgerId, ALEX);
    const original = detail.entries.find((e) => e.id === e1["id"]);
    expect(original?.expense?.reversed_by).toBe(voidBody.id);
  });

  it("double-void => 409 with error 'already voided', no third row", async () => {
    const e1 = expenseBody();
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, e1)).status).toBe(201);
    expect(
      (
        await post(`/api/ledgers/${ledgerId}/expenses/${e1["id"]}/void`, ALEX, {
          id: crypto.randomUUID(),
          occurred_on: "2026-08-03",
        })
      ).status,
    ).toBe(201);

    // Different reversal id, same target: NOT idempotent — the target is
    // already voided.
    const second = await post(`/api/ledgers/${ledgerId}/expenses/${e1["id"]}/void`, ALEX, {
      id: crypto.randomUUID(),
      occurred_on: "2026-08-04",
    });
    expect(second.status).toBe(409);
    const err = (await second.json()) as ErrorResponse;
    expect(err.error).toBe("already voided");
    expect(await countRows("expenses")).toBe(2);
  });

  it("voiding a reversal => 409 with error 'cannot void a void'", async () => {
    const e1 = expenseBody();
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, e1)).status).toBe(201);
    const voidBody = { id: crypto.randomUUID(), occurred_on: "2026-08-03" };
    expect(
      (
        await post(`/api/ledgers/${ledgerId}/expenses/${e1["id"]}/void`, ALEX, voidBody)
      ).status,
    ).toBe(201);

    const res = await post(
      `/api/ledgers/${ledgerId}/expenses/${voidBody.id}/void`,
      ALEX,
      { id: crypto.randomUUID(), occurred_on: "2026-08-04" },
    );
    expect(res.status).toBe(409);
    const err = (await res.json()) as ErrorResponse;
    expect(err.error).toBe("cannot void a void");
    expect(await countRows("expenses")).toBe(2);
  });

  it("voiding an expense that lives in ANOTHER ledger => 404, even for a member of both", async () => {
    const otherLedger = await insertLedger(ALEX, SAM);
    const foreign = expenseBody({ payer: ALEX, other_share_cents: 100 });
    expect(
      (await post(`/api/ledgers/${otherLedger}/expenses`, ALEX, foreign)).status,
    ).toBe(201);

    // ALEX is a member of BOTH ledgers, but the expense is not in ledgerId.
    const res = await post(
      `/api/ledgers/${ledgerId}/expenses/${foreign["id"]}/void`,
      ALEX,
      { id: crypto.randomUUID(), occurred_on: "2026-08-05" },
    );
    expect(res.status).toBe(404);
    expect(await countRows("expenses")).toBe(1);
  });

  it("voiding a nonexistent expense => 404", async () => {
    const res = await post(
      `/api/ledgers/${ledgerId}/expenses/${crypto.randomUUID()}/void`,
      ALEX,
      { id: crypto.randomUUID(), occurred_on: "2026-08-05" },
    );
    expect(res.status).toBe(404);
  });

  it("void body validation: malformed occurred_on => 400, no reversal written", async () => {
    const e1 = expenseBody();
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, e1)).status).toBe(201);
    const res = await post(`/api/ledgers/${ledgerId}/expenses/${e1["id"]}/void`, ALEX, {
      id: crypto.randomUUID(),
      occurred_on: "2026-2-3",
    });
    expect(res.status).toBe(400);
    expect(await countRows("expenses")).toBe(1);
  });
});
