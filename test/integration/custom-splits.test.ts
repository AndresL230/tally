// Custom per-item splits through the real Worker. An item may carry
// share_cents: the member in assigned_to pays exactly that many cents of
// it and the other member pays the rest. The server validates it, stores
// it on receipt_items, folds it into other_share_cents, echoes it in the
// ledger detail and the receipt read, and recomputes from it on a payer
// swap. ALL MONEY IS INTEGER CENTS.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { authedFetch } from "../helpers/auth";
import { ALEX, JORDAN, insertLedger } from "../helpers/fixtures";
import type { ApiEntry, LedgerDetail } from "../../src/shared/types";

function post(path: string, email: string, body: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getDetail(ledgerId: string, email: string): Promise<LedgerDetail> {
  const res = await authedFetch(`/api/ledgers/${ledgerId}`, email);
  expect(res.status).toBe(200);
  return (await res.json()) as LedgerDetail;
}

// ALEX < JORDAN, so ALEX is person_a.
let ledgerId: string;
beforeEach(async () => {
  ledgerId = await insertLedger(ALEX, JORDAN);
});

async function insertReceipt(): Promise<string> {
  const receiptId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO receipts (id, ledger_id, sha256, status, created_at) VALUES (?1, ?2, ?3, 'needs_review', ?4)",
  )
    .bind(receiptId, ledgerId, crypto.randomUUID(), Date.now())
    .run();
  return receiptId;
}

function itemsBody(receiptId: string, items: unknown[], total: number): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    occurred_on: "2026-08-01",
    merchant: "Xian Famous Foods",
    total_cents: total,
    payer: ALEX,
    method: "items",
    receipt_id: receiptId,
    items,
  };
}

describe("items expense with share_cents", () => {
  it("stores the share, folds it into other_share_cents, and echoes it back", async () => {
    const receiptId = await insertReceipt();
    // JORDAN pays $3.00 of the $10.00 burger; ALEX (payer) the other $7.00.
    // JORDAN's whole $5.00 lamb. Subtotal $15.00, total $16.50: $1.50 extra
    // split 8.00/15.00 -> JORDAN's extra 80 -> JORDAN owes 880.
    const body = itemsBody(
      receiptId,
      [
        { label: "Burger", price_cents: 1000, assigned_to: JORDAN, share_cents: 300 },
        { label: "Lamb", price_cents: 500, assigned_to: JORDAN },
      ],
      1650,
    );
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: ApiEntry };
    expect(entry.expense?.other_share_cents).toBe(880);
    expect(entry.delta_cents).toBe(880);
    const items = entry.expense?.items ?? [];
    expect(items.map((i) => i.share_cents)).toEqual([300, null]);

    const row = await env.DB.prepare(
      "SELECT share_cents FROM receipt_items WHERE receipt_id = ?1 AND label = 'Burger'",
    )
      .bind(receiptId)
      .first<{ share_cents: number | null }>();
    expect(row?.share_cents).toBe(300);

    // The ledger detail carries it too, for either viewer.
    const detail = await getDetail(ledgerId, JORDAN);
    const found = detail.entries.find((e) => e.id === body["id"])!;
    expect(found.expense?.items?.find((i) => i.label === "Burger")?.share_cents).toBe(300);
  });

  it("anchored on the payer: the non-payer's share is the remainder", async () => {
    const receiptId = await insertReceipt();
    const body = itemsBody(
      receiptId,
      [{ label: "Burger", price_cents: 1000, assigned_to: ALEX, share_cents: 300 }],
      1000,
    );
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: ApiEntry };
    expect(entry.expense?.other_share_cents).toBe(700);
  });

  it("rejects share_cents on a 'half' item => 400, nothing written", async () => {
    const receiptId = await insertReceipt();
    const body = itemsBody(
      receiptId,
      [{ label: "Burger", price_cents: 1000, assigned_to: "half", share_cents: 300 }],
      1000,
    );
    const res = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
    expect(res.status).toBe(400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM expenses").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("rejects share_cents above the price, negative, or non-integer => 400", async () => {
    for (const share of [1001, -1, 2.5, "300"]) {
      const receiptId = await insertReceipt();
      const body = itemsBody(
        receiptId,
        [{ label: "Burger", price_cents: 1000, assigned_to: JORDAN, share_cents: share }],
        1000,
      );
      const res = await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body);
      expect(res.status, `share_cents ${String(share)}`).toBe(400);
    }
  });

  it("payer swap recomputes from the stored share", async () => {
    const receiptId = await insertReceipt();
    // Same receipt as the first test: JORDAN owes 880 with ALEX paying.
    const body = itemsBody(
      receiptId,
      [
        { label: "Burger", price_cents: 1000, assigned_to: JORDAN, share_cents: 300 },
        { label: "Lamb", price_cents: 500, assigned_to: JORDAN },
      ],
      1650,
    );
    expect((await post(`/api/ledgers/${ledgerId}/expenses`, ALEX, body)).status).toBe(201);
    const res = await post(`/api/ledgers/${ledgerId}/expenses/${body["id"]}/payer`, ALEX, { payer: JORDAN });
    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as { entry: ApiEntry };
    // ALEX's items: 700 of 1500 -> extra 150*700/1500 = 70 -> 770.
    expect(entry.expense?.other_share_cents).toBe(770);
    expect(entry.delta_cents).toBe(-770);
  });
});
