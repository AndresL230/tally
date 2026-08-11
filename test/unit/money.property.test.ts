// Property tests for src/shared/money.ts, written against M1_CONTRACT.md
// ONLY. Every expectation here is derived from the written contract; the
// oracles below are implemented independently with BigInt so a buggy
// implementation cannot agree with them by construction.
//
// ALL MONEY IS INTEGER CENTS. No floats appear in any expectation.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  divRoundHalfUp,
  percentShare,
  splitItems,
  type SplitItem,
} from "../../src/shared/money";

const PAYER = "payer@example.com";
const OTHER = "other@example.com";

// ---------------------------------------------------------------------------
// Independent BigInt oracles (contract: "round num/den to the nearest
// integer, halves toward +infinity" === floor(num/den + 1/2)
// === floor((2*num + den) / (2*den)) in exact integer arithmetic).
// ---------------------------------------------------------------------------

/** Floor division for BigInt, den > 0. BigInt `/` truncates toward zero. */
function floorDivBig(num: bigint, den: bigint): bigint {
  const q = num / den;
  return num % den !== 0n && num < 0n ? q - 1n : q;
}

/** Oracle: round(num/den), halves toward +infinity, exact integer math. */
function oracleRound(num: bigint, den: bigint): bigint {
  return floorDivBig(2n * num + den, 2n * den);
}

function oracleDivRoundHalfUp(num: number, den: number): number {
  return Number(oracleRound(BigInt(num), BigInt(den)));
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

type Who = "payer" | "other" | "half";
interface RawItem {
  price_cents: number;
  who: Who;
}

const arbWho = fc.constantFrom<Who>("payer", "other", "half");
const arbPrice = fc.integer({ min: 0, max: 1_000_000 });
const arbTotal = fc.integer({ min: 0, max: 10_000_000 });
const arbRawItems = fc.array(
  fc.record({ price_cents: arbPrice, who: arbWho }),
  { minLength: 0, maxLength: 60 },
);
// Non-empty items with strictly positive prices (so items_subtotal > 0).
const arbPositiveRawItems = fc.array(
  fc.record({ price_cents: fc.integer({ min: 1, max: 1_000_000 }), who: arbWho }),
  { minLength: 1, maxLength: 60 },
);

function toSplitItems(raw: readonly RawItem[]): SplitItem[] {
  return raw.map((r) => ({
    price_cents: r.price_cents,
    assigned_to: r.who === "payer" ? PAYER : r.who === "other" ? OTHER : "half",
  }));
}

function subtotalOf(raw: readonly RawItem[]): number {
  return raw.reduce((s, r) => s + r.price_cents, 0);
}

/** Contract halving rule oracle: other's subtotal accumulated in HALF-CENT
 *  UNITS (2*price for 'other' items, 1*price for 'half' items) and rounded
 *  ONCE at the end with divRoundHalfUp(units, 2). */
function oracleOtherSub(raw: readonly RawItem[]): number {
  let units = 0n;
  for (const r of raw) {
    if (r.who === "other") units += 2n * BigInt(r.price_cents);
    else if (r.who === "half") units += BigInt(r.price_cents);
  }
  return Number(oracleRound(units, 2n));
}

/** Contract extra rule oracle: other_extra = divRoundHalfUp(
 *  extra * other_sub, items_subtotal), or 0 when items_subtotal === 0. */
function oracleOtherExtra(extra: number, otherSub: number, subtotal: number): number {
  if (subtotal === 0) return 0;
  return Number(oracleRound(BigInt(extra) * BigInt(otherSub), BigInt(subtotal)));
}

// ---------------------------------------------------------------------------
// divRoundHalfUp
// ---------------------------------------------------------------------------

describe("divRoundHalfUp — nearest integer, halves toward +infinity, den > 0", () => {
  it("matches the exact table, including halves rounding toward +infinity", () => {
    // Exact quotients
    expect(divRoundHalfUp(0, 5)).toBe(0);
    expect(divRoundHalfUp(10, 5)).toBe(2);
    expect(divRoundHalfUp(-10, 5)).toBe(-2);
    expect(divRoundHalfUp(6, 2)).toBe(3);
    // Halves go toward +infinity in BOTH signs: 0.5 -> 1, -0.5 -> 0.
    expect(divRoundHalfUp(1, 2)).toBe(1); //  0.5 -> 1
    expect(divRoundHalfUp(-1, 2)).toBe(0); // -0.5 -> 0
    expect(divRoundHalfUp(3, 2)).toBe(2); //  1.5 -> 2
    expect(divRoundHalfUp(-3, 2)).toBe(-1); // -1.5 -> -1
    expect(divRoundHalfUp(5, 2)).toBe(3); //  2.5 -> 3
    expect(divRoundHalfUp(-5, 2)).toBe(-2); // -2.5 -> -2
    expect(divRoundHalfUp(-10, 4)).toBe(-2); // -2.5 -> -2
    // Non-half fractions round to nearest.
    expect(divRoundHalfUp(7, 3)).toBe(2); //  2.333 -> 2
    expect(divRoundHalfUp(8, 3)).toBe(3); //  2.667 -> 3
    expect(divRoundHalfUp(-7, 3)).toBe(-2); // -2.333 -> -2
    expect(divRoundHalfUp(-8, 3)).toBe(-3); // -2.667 -> -3
    expect(divRoundHalfUp(101, 2)).toBe(51); // 50.5 -> 51
  });

  it("agrees with an independent BigInt oracle for any integer num and den > 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (num, den) => {
          const got = divRoundHalfUp(num, den);
          expect(Number.isSafeInteger(got)).toBe(true);
          expect(got).toBe(oracleDivRoundHalfUp(num, den));
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// splitItems
// ---------------------------------------------------------------------------

describe("splitItems — identities hold EXACTLY for any total and any item list", () => {
  it("other+payer sums equal total / items_subtotal / extra exactly, and every output is a safe integer", () => {
    fc.assert(
      fc.property(arbTotal, arbRawItems, (total, raw) => {
        const r = splitItems(toSplitItems(raw), PAYER, OTHER, total);
        // All eight outputs are safe integers (integer cents, no floats).
        for (const v of [
          r.items_subtotal_cents,
          r.extra_cents,
          r.other_sub_cents,
          r.payer_sub_cents,
          r.other_extra_cents,
          r.payer_extra_cents,
          r.other_share_cents,
          r.payer_share_cents,
        ]) {
          expect(Number.isSafeInteger(v)).toBe(true);
        }
        // Contract identities — EXACT, never approximate.
        expect(r.items_subtotal_cents).toBe(subtotalOf(raw));
        expect(r.extra_cents).toBe(total - r.items_subtotal_cents);
        expect(r.other_share_cents + r.payer_share_cents).toBe(total);
        expect(r.other_sub_cents + r.payer_sub_cents).toBe(r.items_subtotal_cents);
        expect(r.other_extra_cents + r.payer_extra_cents).toBe(r.extra_cents);
        // Share composition.
        expect(r.other_share_cents).toBe(r.other_sub_cents + r.other_extra_cents);
      }),
      { numRuns: 300 },
    );
  });

  it("pins other_sub (half-cent units, rounded ONCE) and other_extra (proportional, rounded) to independent oracles", () => {
    fc.assert(
      fc.property(arbTotal, arbRawItems, (total, raw) => {
        const r = splitItems(toSplitItems(raw), PAYER, OTHER, total);
        const expectedOtherSub = oracleOtherSub(raw);
        expect(r.other_sub_cents).toBe(expectedOtherSub);
        expect(r.other_extra_cents).toBe(
          oracleOtherExtra(r.extra_cents, expectedOtherSub, r.items_subtotal_cents),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("all items assigned to other => other_share === total exactly (any total, including total < subtotal)", () => {
    fc.assert(
      fc.property(
        arbTotal,
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 60 }),
        (total, prices) => {
          const items: SplitItem[] = prices.map((p) => ({
            price_cents: p,
            assigned_to: OTHER,
          }));
          const r = splitItems(items, PAYER, OTHER, total);
          expect(r.other_share_cents).toBe(total);
          expect(r.payer_share_cents).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("all items assigned to payer => other_share === 0 and the whole extra goes to the payer", () => {
    fc.assert(
      fc.property(
        arbTotal,
        fc.array(arbPrice, { minLength: 1, maxLength: 60 }),
        (total, prices) => {
          const items: SplitItem[] = prices.map((p) => ({
            price_cents: p,
            assigned_to: PAYER,
          }));
          const r = splitItems(items, PAYER, OTHER, total);
          expect(r.other_sub_cents).toBe(0);
          expect(r.other_extra_cents).toBe(0);
          expect(r.other_share_cents).toBe(0);
          expect(r.payer_extra_cents).toBe(r.extra_cents);
          expect(r.payer_share_cents).toBe(total);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("empty item list => other_share === 0 and extra === total", () => {
    fc.assert(
      fc.property(arbTotal, (total) => {
        const r = splitItems([], PAYER, OTHER, total);
        expect(r.items_subtotal_cents).toBe(0);
        expect(r.extra_cents).toBe(total);
        expect(r.other_share_cents).toBe(0);
        expect(r.payer_share_cents).toBe(total);
      }),
      { numRuns: 100 },
    );
  });

  it("negative extra (total < items subtotal) still satisfies every identity", () => {
    fc.assert(
      fc.property(arbPositiveRawItems, fc.nat(10_000_000), (raw, seed) => {
        const subtotal = subtotalOf(raw); // >= 1 by construction
        const total = seed % subtotal; // 0 <= total < subtotal
        const r = splitItems(toSplitItems(raw), PAYER, OTHER, total);
        expect(r.extra_cents).toBe(total - subtotal);
        expect(r.extra_cents).toBeLessThan(0);
        expect(r.other_share_cents + r.payer_share_cents).toBe(total);
        expect(r.other_sub_cents + r.payer_sub_cents).toBe(subtotal);
        expect(r.other_extra_cents + r.payer_extra_cents).toBe(r.extra_cents);
        expect(r.other_sub_cents).toBe(oracleOtherSub(raw));
        expect(r.other_extra_cents).toBe(
          oracleOtherExtra(r.extra_cents, r.other_sub_cents, subtotal),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("hand-computed negative-extra case: [300 other, 301 half], total 400", () => {
    // units          = 2*300 + 301 = 901
    // other_sub      = round(901/2) = round(450.5) = 451   (half toward +inf)
    // items_subtotal = 601, extra = 400 - 601 = -201
    // other_extra    = round(-201*451/601) = round(-90651/601)
    //                = round(-150.8336...) = -151
    // payer_extra    = -201 - (-151) = -50
    // other_share    = 451 - 151 = 300; payer_share = 400 - 300 = 100
    const r = splitItems(
      [
        { price_cents: 300, assigned_to: OTHER },
        { price_cents: 301, assigned_to: "half" },
      ],
      PAYER,
      OTHER,
      400,
    );
    expect(r.items_subtotal_cents).toBe(601);
    expect(r.extra_cents).toBe(-201);
    expect(r.other_sub_cents).toBe(451);
    expect(r.payer_sub_cents).toBe(150);
    expect(r.other_extra_cents).toBe(-151);
    expect(r.payer_extra_cents).toBe(-50);
    expect(r.other_share_cents).toBe(300);
    expect(r.payer_share_cents).toBe(100);
  });
});

describe("splitItems — halving rule: accumulate half-cent units, round ONCE (never per item)", () => {
  it("two 'half' items at 101 each: units 202 -> other_sub 101, NOT 51+51=102", () => {
    const r = splitItems(
      [
        { price_cents: 101, assigned_to: "half" },
        { price_cents: 101, assigned_to: "half" },
      ],
      PAYER,
      OTHER,
      202,
    );
    expect(r.other_sub_cents).toBe(101); // per-item rounding would give 102
    expect(r.other_share_cents).toBe(101); // extra is 0
    expect(r.payer_share_cents).toBe(101);
  });

  it("one 'half' item at 101: units 101 -> other_sub 51 (50.5 rounds up)", () => {
    const r = splitItems(
      [{ price_cents: 101, assigned_to: "half" }],
      PAYER,
      OTHER,
      101,
    );
    expect(r.other_sub_cents).toBe(51);
    expect(r.payer_sub_cents).toBe(50);
    expect(r.other_share_cents).toBe(51);
    expect(r.payer_share_cents).toBe(50);
  });

  it("three 'half' items at 101: units 303 -> other_sub 152, NOT 51*3=153", () => {
    const r = splitItems(
      [
        { price_cents: 101, assigned_to: "half" },
        { price_cents: 101, assigned_to: "half" },
        { price_cents: 101, assigned_to: "half" },
      ],
      PAYER,
      OTHER,
      303,
    );
    expect(r.other_sub_cents).toBe(152); // round(151.5) toward +inf
    expect(r.payer_sub_cents).toBe(151);
    expect(r.other_share_cents + r.payer_share_cents).toBe(303);
  });

  it("mixed: 'half' at 99 plus 'other' at 50: units 2*50+99=199 -> other_sub 100", () => {
    const r = splitItems(
      [
        { price_cents: 99, assigned_to: "half" },
        { price_cents: 50, assigned_to: OTHER },
      ],
      PAYER,
      OTHER,
      149,
    );
    expect(r.other_sub_cents).toBe(100); // round(199/2)=round(99.5)=100
    expect(r.other_share_cents).toBe(100);
  });
});

describe("splitItems — throws on contract violations", () => {
  const ok: SplitItem[] = [{ price_cents: 100, assigned_to: OTHER }];

  it("throws on a negative price", () => {
    expect(() =>
      splitItems([{ price_cents: -1, assigned_to: OTHER }], PAYER, OTHER, 100),
    ).toThrow();
  });

  it("throws on a non-integer price", () => {
    expect(() =>
      splitItems([{ price_cents: 100.5, assigned_to: OTHER }], PAYER, OTHER, 200),
    ).toThrow();
  });

  it("throws on assigned_to that is neither member email nor 'half'", () => {
    expect(() =>
      splitItems(
        [{ price_cents: 100, assigned_to: "stranger@example.com" }],
        PAYER,
        OTHER,
        100,
      ),
    ).toThrow();
  });

  it("throws when payerEmail === otherEmail", () => {
    expect(() => splitItems(ok, PAYER, PAYER, 100)).toThrow();
  });

  it("throws on a non-integer total", () => {
    expect(() => splitItems(ok, PAYER, OTHER, 100.25)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// percentShare
// ---------------------------------------------------------------------------

describe("percentShare — other's share of total at pctOther percent", () => {
  it("pct 0 -> 0 and pct 100 -> total, for any total", () => {
    fc.assert(
      fc.property(arbTotal, (total) => {
        expect(percentShare(total, 0)).toBe(0);
        expect(percentShare(total, 100)).toBe(total);
      }),
      { numRuns: 200 },
    );
  });

  it("50% of an odd total rounds the half cent up", () => {
    expect(percentShare(4979, 50)).toBe(2490); // 2489.5 -> 2490
    expect(percentShare(101, 50)).toBe(51); // 50.5 -> 51
    expect(percentShare(1, 50)).toBe(1); // 0.5 -> 1
    expect(percentShare(3, 50)).toBe(2); // 1.5 -> 2
    expect(percentShare(2501, 50)).toBe(1251); // 1250.5 -> 1251
  });

  it("share + (total - share) === total, share stays in [0, total], and matches the BigInt oracle", () => {
    fc.assert(
      fc.property(arbTotal, fc.integer({ min: 0, max: 100 }), (total, pct) => {
        const share = percentShare(total, pct);
        expect(Number.isSafeInteger(share)).toBe(true);
        expect(share + (total - share)).toBe(total);
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(total);
        expect(share).toBe(
          Number(oracleRound(BigInt(total) * BigInt(pct), 100n)),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("throws on pct outside 0..100 and on non-integer pct", () => {
    expect(() => percentShare(1000, -1)).toThrow();
    expect(() => percentShare(1000, 101)).toThrow();
    expect(() => percentShare(1000, 50.5)).toThrow();
    expect(() => percentShare(1000, Number.NaN)).toThrow();
  });

  it("throws on negative or non-integer total", () => {
    expect(() => percentShare(-1, 50)).toThrow();
    expect(() => percentShare(12.5, 50)).toThrow();
  });
});
