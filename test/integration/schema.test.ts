import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import type { LedgerDetail, LedgerSummary } from "../../src/shared/types";
import { authedFetch, authedJson } from "../helpers/auth";
import {
  ALEX,
  JORDAN,
  OUTSIDER,
  insertExpense,
  insertLedger,
  insertSettlement,
} from "../helpers/fixtures";

describe("migrations from zero", () => {
  it("creates every table and the entries view", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
    ).all<{ name: string; type: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["users", "ledgers", "expenses", "settlements", "receipts", "receipt_items"]) {
      expect(names).toContain(t);
    }
    expect(results.find((r) => r.name === "ledger_entries")?.type).toBe("view");
  });

  it("enforces the canonical member ordering and uniqueness", async () => {
    await insertLedger(ALEX, JORDAN, "L1");
    // person_a must be lexicographically smaller
    await expect(
      env.DB.prepare(
        "INSERT INTO ledgers (id, person_a, person_b, created_at) VALUES ('bad', ?1, ?2, 0)",
      )
        .bind(JORDAN, ALEX)
        .run(),
    ).rejects.toThrow();
    // duplicate pair rejected
    await expect(insertLedger(ALEX, JORDAN, "L1-dupe")).rejects.toThrow();
  });
});

describe("ledger endpoints", () => {
  it("computes canonical deltas and running balance through the view", async () => {
    const lid = await insertLedger(ALEX, JORDAN);
    // Alex pays, Jordan's share 4120 -> +4120 canonical
    await insertExpense({
      ledger_id: lid,
      occurred_on: "2026-06-28",
      merchant: "Trader Joe's",
      total_cents: 8240,
      payer: ALEX,
      other_share_cents: 4120,
      method: "percent",
      created_at: 1,
    });
    // Jordan pays Alex back 4120 -> from person_b -> -4120
    await insertSettlement({
      ledger_id: lid,
      occurred_on: "2026-07-02",
      from_email: JORDAN,
      to_email: ALEX,
      amount_cents: 4120,
      created_at: 2,
    });
    // Jordan pays a receipt, Alex's share 2367 -> -2367
    await insertExpense({
      ledger_id: lid,
      occurred_on: "2026-07-06",
      merchant: "Lardo",
      total_cents: 4680,
      payer: JORDAN,
      other_share_cents: 2367,
      method: "manual",
      created_at: 3,
    });

    const detail = await authedJson<LedgerDetail>(`/api/ledgers/${lid}`, ALEX);
    expect(detail.viewer).toBe(ALEX);
    expect(detail.entries.map((e) => e.delta_cents)).toEqual([4120, -4120, -2367]);
    expect(detail.entries.map((e) => e.running_cents)).toEqual([4120, 0, -2367]);
    expect(detail.entries[1]?.kind).toBe("settlement");

    const summaries = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", ALEX);
    expect(summaries.ledgers).toHaveLength(1);
    expect(summaries.ledgers[0]).toMatchObject({
      balance_cents: -2367,
      entry_count: 3,
      friend_email: JORDAN,
      last_entry_on: "2026-07-06",
    });
  });

  it("orders same-day entries by created_at then id", async () => {
    const lid = await insertLedger(ALEX, JORDAN);
    await insertExpense({
      id: "b-second",
      ledger_id: lid,
      occurred_on: "2026-08-01",
      total_cents: 1000,
      payer: ALEX,
      other_share_cents: 500,
      created_at: 10,
    });
    await insertExpense({
      id: "a-first",
      ledger_id: lid,
      occurred_on: "2026-08-01",
      total_cents: 2000,
      payer: ALEX,
      other_share_cents: 1000,
      created_at: 5,
    });
    const detail = await authedJson<LedgerDetail>(`/api/ledgers/${lid}`, ALEX);
    expect(detail.entries.map((e) => e.id)).toEqual(["a-first", "b-second"]);
    expect(detail.entries.map((e) => e.running_cents)).toEqual([1000, 1500]);
  });

  it("hides other people's ledgers from list and detail", async () => {
    const lid = await insertLedger(ALEX, JORDAN);
    const outsiderList = await authedJson<{ ledgers: LedgerSummary[] }>("/api/ledgers", OUTSIDER);
    expect(outsiderList.ledgers).toEqual([]);

    const res = await authedFetch(`/api/ledgers/${lid}`, OUTSIDER);
    expect(res.status).toBe(404);

    const memberRes = await authedFetch(`/api/ledgers/${lid}`, JORDAN);
    expect(memberRes.status).toBe(200);
  });
});
