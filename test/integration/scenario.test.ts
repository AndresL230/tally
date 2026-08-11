// M1 GATE: the 10-entry hand-computed scenario (M1_CONTRACT.md).
//
// A two-person ledger (ALEX = person_a, JORDAN = person_b since
// "alex@..." < "jordan@..."), >= 10 entries posted through the REAL routes,
// mixing manual and percent expenses with two settlements, one SAME-DAY tie
// (e4/e5 both on 2026-07-10, ordered by created_at then id), and one
// void-as-reversal in the middle of the history.
//
// Every delta and running balance below is computed BY HAND. Canonical sign
// convention: positive = person_b (JORDAN) owes person_a (ALEX).
//   expense:    payer===person_a -> +other_share_cents, else -other_share_cents
//   settlement: from_email===person_a -> +amount_cents, else -amount_cents
//   order:      occurred_on, created_at, id
//
// Percent shares use odd-cent totals so the half-up rounding rule matters:
//   percentShare(4979, 50) = round(4979*50/100)  = round(2489.5)  = 2490
//   percentShare(3333, 33) = round(3333*33/100)  = round(1099.89) = 1100
//   percentShare(2501, 50) = round(2501*50/100)  = round(1250.5)  = 1251
//   percentShare(4979, 25) = round(4979*25/100)  = round(1244.75) = 1245
//
// #  id  date        entry                                   delta   running
// 1  e1  2026-07-01  percent, ALEX pays 4979, other 2490     +2490      2490
// 2  e2  2026-07-03  percent, JORDAN pays 3333, other 1100   -1100      1390   (2490-1100)
// 3  e3  2026-07-05  manual,  ALEX pays 1201, other 601       +601      1991   (1390+601)
// 4  s1  2026-07-08  settle,  JORDAN -> ALEX 1500            -1500       491   (1991-1500)
// 5  e4  2026-07-10  percent, ALEX pays 2501, other 1251     +1251      1742   (491+1251)
// 6  e5  2026-07-10  manual,  JORDAN pays 999, other 999      -999       743   (1742-999)  SAME-DAY TIE with e4
// 7  v1  2026-07-12  VOID of e3 (other_share -601, ALEX)      -601       142   (743-601)   mid-history reversal
// 8  e6  2026-07-15  percent, JORDAN pays 4979, other 1245   -1245     -1103   (142-1245)
// 9  s2  2026-07-20  settle,  ALEX -> JORDAN 1103            +1103         0   (-1103+1103) square mid-history
// 10 e7  2026-07-22  manual,  ALEX pays 777, other 389        +389       389   (0+389)
//
// Final canonical balance: +389 (JORDAN owes ALEX 389 cents).
// person_a (ALEX) sees +389; person_b (JORDAN) sees -389 — every delta and
// running value negates through viewerDelta.

import { describe, it, expect } from "vitest";
import { authedFetch } from "../helpers/auth";
import { ALEX, JORDAN, insertLedger } from "../helpers/fixtures";
import { percentShare } from "../../src/shared/money";
import { viewerDelta } from "../../src/shared/ledger";
import type { ApiEntry, LedgerDetail } from "../../src/shared/types";

interface EntryResponse {
  entry: ApiEntry;
}

async function post(path: string, email: string, body: unknown): Promise<ApiEntry> {
  const res = await authedFetch(path, email, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as EntryResponse).entry;
}

async function getDetail(ledgerId: string, email: string): Promise<LedgerDetail> {
  const res = await authedFetch(`/api/ledgers/${ledgerId}`, email);
  expect(res.status).toBe(200);
  return (await res.json()) as LedgerDetail;
}

/** created_at is server-assigned; sleep between posts so insertion order is
 *  strictly reflected in created_at, which is what breaks the same-day tie. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe("M1 gate — hand-computed 10-entry scenario with a same-day tie and a mid-history reversal", () => {
  it("every running balance matches the hand arithmetic, from both viewers", async () => {
    const ledgerId = await insertLedger(ALEX, JORDAN);
    const L = { person_a: ALEX, person_b: JORDAN };

    // The percent-method shares below are literals; pin them to the shared
    // money contract so the scenario numbers and the unit contract agree.
    expect(percentShare(4979, 50)).toBe(2490);
    expect(percentShare(3333, 33)).toBe(1100);
    expect(percentShare(2501, 50)).toBe(1251);
    expect(percentShare(4979, 25)).toBe(1245);

    const ids = {
      e1: crypto.randomUUID(),
      e2: crypto.randomUUID(),
      e3: crypto.randomUUID(),
      s1: crypto.randomUUID(),
      e4: crypto.randomUUID(),
      e5: crypto.randomUUID(),
      v1: crypto.randomUUID(),
      e6: crypto.randomUUID(),
      s2: crypto.randomUUID(),
      e7: crypto.randomUUID(),
    };

    const expensesPath = `/api/ledgers/${ledgerId}/expenses`;
    const settlementsPath = `/api/ledgers/${ledgerId}/settlements`;

    // 1. e1: percent, ALEX pays 4979, JORDAN's share percentShare(4979,50)=2490.
    //    delta +2490, running 2490.
    let entry = await post(expensesPath, ALEX, {
      id: ids.e1,
      occurred_on: "2026-07-01",
      merchant: "Trattoria",
      total_cents: 4979,
      payer: ALEX,
      method: "percent",
      other_share_cents: 2490,
    });
    expect(entry.delta_cents).toBe(2490);
    expect(entry.running_cents).toBe(2490);
    await tick();

    // 2. e2: percent, JORDAN pays 3333, ALEX's share percentShare(3333,33)=1100.
    //    delta -1100, running 2490-1100=1390.
    entry = await post(expensesPath, JORDAN, {
      id: ids.e2,
      occurred_on: "2026-07-03",
      merchant: "Grocer",
      total_cents: 3333,
      payer: JORDAN,
      method: "percent",
      other_share_cents: 1100,
    });
    expect(entry.delta_cents).toBe(-1100);
    expect(entry.running_cents).toBe(1390);
    await tick();

    // 3. e3: manual, ALEX pays 1201, JORDAN's share 601.
    //    delta +601, running 1390+601=1991.  (Voided later by v1.)
    entry = await post(expensesPath, ALEX, {
      id: ids.e3,
      occurred_on: "2026-07-05",
      merchant: "Pharmacy",
      total_cents: 1201,
      payer: ALEX,
      method: "manual",
      other_share_cents: 601,
      note: "Entered by hand.",
    });
    expect(entry.delta_cents).toBe(601);
    expect(entry.running_cents).toBe(1991);
    await tick();

    // 4. s1: settlement, JORDAN -> ALEX 1500.
    //    from_email===person_b -> delta -1500, running 1991-1500=491.
    entry = await post(settlementsPath, JORDAN, {
      id: ids.s1,
      occurred_on: "2026-07-08",
      from_email: JORDAN,
      to_email: ALEX,
      amount_cents: 1500,
    });
    expect(entry.delta_cents).toBe(-1500);
    expect(entry.running_cents).toBe(491);
    await tick();

    // 5. e4: percent, ALEX pays 2501, JORDAN's share percentShare(2501,50)=1251.
    //    delta +1251, running 491+1251=1742.
    entry = await post(expensesPath, ALEX, {
      id: ids.e4,
      occurred_on: "2026-07-10",
      merchant: "Brunch Spot",
      total_cents: 2501,
      payer: ALEX,
      method: "percent",
      other_share_cents: 1251,
    });
    expect(entry.delta_cents).toBe(1251);
    expect(entry.running_cents).toBe(1742);
    await tick();

    // 6. e5: manual, JORDAN pays 999, ALEX's share 999 (all of it).
    //    SAME occurred_on as e4 — tie broken by created_at (posted later).
    //    delta -999, running 1742-999=743.
    entry = await post(expensesPath, JORDAN, {
      id: ids.e5,
      occurred_on: "2026-07-10",
      merchant: "Taxi",
      total_cents: 999,
      payer: JORDAN,
      method: "manual",
      other_share_cents: 999,
    });
    expect(entry.delta_cents).toBe(-999);
    expect(entry.running_cents).toBe(743);
    await tick();

    // 7. v1: VOID e3 mid-history. Reversal copies merchant/method/total/payer,
    //    other_share -601, payer ALEX -> delta -601, running 743-601=142.
    entry = await post(`${expensesPath}/${ids.e3}/void`, ALEX, {
      id: ids.v1,
      occurred_on: "2026-07-12",
    });
    expect(entry.delta_cents).toBe(-601);
    expect(entry.running_cents).toBe(142);
    expect(entry.expense?.reverses_id).toBe(ids.e3);
    expect(entry.expense?.note).toBe("Void");
    await tick();

    // 8. e6: percent, JORDAN pays 4979, ALEX's share percentShare(4979,25)=1245.
    //    delta -1245, running 142-1245=-1103. Balance flips negative.
    entry = await post(expensesPath, JORDAN, {
      id: ids.e6,
      occurred_on: "2026-07-15",
      merchant: "Trattoria",
      total_cents: 4979,
      payer: JORDAN,
      method: "percent",
      other_share_cents: 1245,
    });
    expect(entry.delta_cents).toBe(-1245);
    expect(entry.running_cents).toBe(-1103);
    await tick();

    // 9. s2: settlement, ALEX -> JORDAN 1103 (ALEX settles the debt).
    //    from_email===person_a -> delta +1103, running -1103+1103=0. Square.
    entry = await post(settlementsPath, ALEX, {
      id: ids.s2,
      occurred_on: "2026-07-20",
      from_email: ALEX,
      to_email: JORDAN,
      amount_cents: 1103,
    });
    expect(entry.delta_cents).toBe(1103);
    expect(entry.running_cents).toBe(0);
    await tick();

    // 10. e7: manual, ALEX pays 777, JORDAN's share 389.
    //     delta +389, running 0+389=389. Final balance +389.
    entry = await post(expensesPath, ALEX, {
      id: ids.e7,
      occurred_on: "2026-07-22",
      merchant: "Coffee",
      total_cents: 777,
      payer: ALEX,
      method: "manual",
      other_share_cents: 389,
    });
    expect(entry.delta_cents).toBe(389);
    expect(entry.running_cents).toBe(389);

    // ---- The whole hand-computed history, in the view's order ----
    const expectedIds = [
      ids.e1, ids.e2, ids.e3, ids.s1, ids.e4,
      ids.e5, ids.v1, ids.e6, ids.s2, ids.e7,
    ];
    const expectedDeltas = [
      2490, -1100, 601, -1500, 1251,
      -999, -601, -1245, 1103, 389,
    ];
    // Running: 2490, 2490-1100=1390, +601=1991, -1500=491, +1251=1742,
    //          -999=743, -601=142, -1245=-1103, +1103=0, +389=389.
    const expectedRunning = [
      2490, 1390, 1991, 491, 1742,
      743, 142, -1103, 0, 389,
    ];

    // ---- person_a's GET: canonical numbers, canonical order ----
    const asAlex = await getDetail(ledgerId, ALEX);
    expect(asAlex.viewer).toBe(ALEX);
    expect(asAlex.entries).toHaveLength(10);
    expect(asAlex.entries.map((e) => e.id)).toEqual(expectedIds);
    expect(asAlex.entries.map((e) => e.delta_cents)).toEqual(expectedDeltas);
    expect(asAlex.entries.map((e) => e.running_cents)).toEqual(expectedRunning);

    // The same-day tie (e4 before e5 on 2026-07-10) is broken by created_at.
    const i4 = asAlex.entries.findIndex((e) => e.id === ids.e4);
    const i5 = asAlex.entries.findIndex((e) => e.id === ids.e5);
    expect(asAlex.entries[i4]!.occurred_on).toBe("2026-07-10");
    expect(asAlex.entries[i5]!.occurred_on).toBe("2026-07-10");
    expect(i4).toBeLessThan(i5);
    expect(asAlex.entries[i4]!.created_at).toBeLessThanOrEqual(
      asAlex.entries[i5]!.created_at,
    );

    // The reversal is wired both ways in the detail payload.
    const e3Entry = asAlex.entries.find((e) => e.id === ids.e3);
    const v1Entry = asAlex.entries.find((e) => e.id === ids.v1);
    expect(e3Entry?.expense?.reversed_by).toBe(ids.v1);
    expect(v1Entry?.expense?.reverses_id).toBe(ids.e3);
    expect(v1Entry?.expense?.other_share_cents).toBe(-601);

    // ---- person_b's GET: same CANONICAL numbers on the wire... ----
    const asJordan = await getDetail(ledgerId, JORDAN);
    expect(asJordan.viewer).toBe(JORDAN);
    expect(asJordan.entries.map((e) => e.id)).toEqual(expectedIds);
    expect(asJordan.entries.map((e) => e.delta_cents)).toEqual(expectedDeltas);
    expect(asJordan.entries.map((e) => e.running_cents)).toEqual(expectedRunning);

    // ...and through the contract's viewer translation, person_b sees every
    // delta and running value EXACTLY negated, person_a sees them unchanged.
    for (let i = 0; i < 10; i += 1) {
      const jordanEntry = asJordan.entries[i]!;
      expect(viewerDelta(jordanEntry.delta_cents, JORDAN, L)).toBe(-expectedDeltas[i]!);
      expect(viewerDelta(jordanEntry.running_cents, JORDAN, L)).toBe(
        -expectedRunning[i]!,
      );
      const alexEntry = asAlex.entries[i]!;
      expect(viewerDelta(alexEntry.delta_cents, ALEX, L)).toBe(expectedDeltas[i]!);
      expect(viewerDelta(alexEntry.running_cents, ALEX, L)).toBe(expectedRunning[i]!);
    }

    // Final balance: ALEX is owed 389; JORDAN owes 389.
    const finalCanonical = asAlex.entries[9]!.running_cents;
    expect(finalCanonical).toBe(389);
    expect(viewerDelta(finalCanonical, ALEX, L)).toBe(389);
    expect(viewerDelta(finalCanonical, JORDAN, L)).toBe(-389);
  });
});
