// Unit tests for src/shared/units.ts — expanding a quantity line item
// ("Boba Tea ×3" priced for the WHOLE LINE, per src/worker/extract.ts)
// into per-unit rows so each unit can be assigned separately on the
// confirm screen. Written BEFORE the implementation, against this contract:
//
//   parseQtyCount: reads the free-text qty display string extraction
//     copies off the receipt. Recognized forms — a bare integer ("3"),
//     a multiplier prefixed or suffixed integer ("×2", "x2", "X2", "2x",
//     "2×", "2X", "*2", "2*"), and "count @ unit price" ("2 @ $1.50",
//     "2@1.50"). Anything else (null, "", "abc", "1.5", "2 lb") -> null.
//     The parser reports what the string SAYS ("0" -> 0, "1" -> 1,
//     "999" -> 999); whether a count expands is the caller's decision.
//   splitPriceCents(line, n): n unit prices in integer cents that sum
//     back to line EXACTLY — base = trunc(line/n), and the leftover
//     (line - base*n) cents land one each on the FIRST units. Never
//     floats, never a lost or invented cent. Throws on invalid input.
//   expandQtyItems: ApiItem[] -> ApiItem[]. A row expands iff its qty
//     parses to n with 2 <= n <= MAX_UNITS_PER_LINE (20), its price is a
//     usable non-negative integer, and expanding keeps the WHOLE list
//     within MAX_EXPANDED_ITEMS (100 — the expenses POST cap in
//     mutations.ts), counting every not-yet-processed row as at least 1.
//     Expanded rows keep the label, DROP the qty suffix, copy
//     assigned_to, and get stable derived ids `${id}#1..#n`. Everything
//     else passes through unchanged, in order.
//
// ALL MONEY IS INTEGER CENTS. No floats appear in any expectation.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { ApiItem } from "../../src/shared/types";
import {
  MAX_EXPANDED_ITEMS,
  MAX_UNITS_PER_LINE,
  expandQtyItems,
  parseQtyCount,
  splitPriceCents,
} from "../../src/shared/units";

// ---------------------------------------------------------------------------
// parseQtyCount
// ---------------------------------------------------------------------------

describe("parseQtyCount — the qty display strings receipts actually print", () => {
  it("multiplication-sign prefix: '×2' -> 2, '×10' -> 10", () => {
    expect(parseQtyCount("×2")).toBe(2);
    expect(parseQtyCount("×10")).toBe(10);
  });

  it("letter-x prefix, either case: 'x2' / 'X2' -> 2", () => {
    expect(parseQtyCount("x2")).toBe(2);
    expect(parseQtyCount("X2")).toBe(2);
  });

  it("multiplier suffix: '2x' / '2×' / '2X' -> 2", () => {
    expect(parseQtyCount("2x")).toBe(2);
    expect(parseQtyCount("2×")).toBe(2);
    expect(parseQtyCount("2X")).toBe(2);
  });

  it("asterisk as multiplier, either side: '*2' / '2*' -> 2", () => {
    expect(parseQtyCount("*2")).toBe(2);
    expect(parseQtyCount("2*")).toBe(2);
  });

  it("bare integer: '3' -> 3, whitespace tolerated", () => {
    expect(parseQtyCount("3")).toBe(3);
    expect(parseQtyCount(" 3 ")).toBe(3);
  });

  it("count @ unit price: '2 @ $1.50' / '2 @ 1.50' / '2@1.50' -> 2", () => {
    expect(parseQtyCount("2 @ $1.50")).toBe(2);
    expect(parseQtyCount("2 @ 1.50")).toBe(2);
    expect(parseQtyCount("2@1.50")).toBe(2);
  });

  it("reports what the string says — '0' -> 0, '1' -> 1, '999' -> 999 (gating is the caller's job)", () => {
    expect(parseQtyCount("0")).toBe(0);
    expect(parseQtyCount("1")).toBe(1);
    expect(parseQtyCount("999")).toBe(999);
  });

  it("null and blank strings -> null", () => {
    expect(parseQtyCount(null)).toBe(null);
    expect(parseQtyCount("")).toBe(null);
    expect(parseQtyCount("   ")).toBe(null);
  });

  it("non-quantity text -> null: 'abc', a lone '×', '@ 1.50'", () => {
    expect(parseQtyCount("abc")).toBe(null);
    expect(parseQtyCount("×")).toBe(null);
    expect(parseQtyCount("@ 1.50")).toBe(null);
  });

  it("weights and decimals are NOT counts: '1.5', '2 lb', '0.68 kg' -> null", () => {
    expect(parseQtyCount("1.5")).toBe(null);
    expect(parseQtyCount("2 lb")).toBe(null);
    expect(parseQtyCount("0.68 kg")).toBe(null);
  });

  it("negative and ambiguous strings -> null: '-2', '2 x 2'", () => {
    expect(parseQtyCount("-2")).toBe(null);
    expect(parseQtyCount("2 x 2")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// splitPriceCents
// ---------------------------------------------------------------------------

describe("splitPriceCents — unit prices sum back to the line EXACTLY", () => {
  it("exact division: 1500/3 -> [500, 500, 500]", () => {
    expect(splitPriceCents(1500, 3)).toEqual([500, 500, 500]);
  });

  it("remainder cents land one each on the FIRST units: 1000/3 -> [334, 333, 333]", () => {
    expect(splitPriceCents(1000, 3)).toEqual([334, 333, 333]);
  });

  it("odd price halves without losing the cent: 101/2 -> [51, 50]", () => {
    expect(splitPriceCents(101, 2)).toEqual([51, 50]);
  });

  it("line smaller than the count: 2/3 -> [1, 1, 0]", () => {
    expect(splitPriceCents(2, 3)).toEqual([1, 1, 0]);
  });

  it("zero line: 0/4 -> [0, 0, 0, 0]", () => {
    expect(splitPriceCents(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it("n = 1 is the identity", () => {
    expect(splitPriceCents(1234, 1)).toEqual([1234]);
  });

  it("property: for any line and n, the units sum EXACTLY to the line, differ by at most one cent, extras first", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        (line, n) => {
          const units = splitPriceCents(line, n);
          expect(units).toHaveLength(n);
          // Sum preservation — the penny rule, never approximate.
          expect(units.reduce((a, u) => a + u, 0)).toBe(line);
          // Every unit is a non-negative safe integer.
          for (const u of units) {
            expect(Number.isSafeInteger(u)).toBe(true);
            expect(u).toBeGreaterThanOrEqual(0);
          }
          // base = trunc(line/n); the first (line - base*n) carry +1.
          const base = Math.min(...units);
          const remainder = units.filter((u) => u === base + 1).length;
          expect(units).toEqual(
            Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base)),
          );
          expect(base * n + remainder).toBe(line);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("throws on a negative or non-integer line", () => {
    expect(() => splitPriceCents(-1, 2)).toThrow();
    expect(() => splitPriceCents(100.5, 2)).toThrow();
    expect(() => splitPriceCents(Number.NaN, 2)).toThrow();
  });

  it("throws on n < 1 or non-integer n", () => {
    expect(() => splitPriceCents(100, 0)).toThrow();
    expect(() => splitPriceCents(100, -3)).toThrow();
    expect(() => splitPriceCents(100, 2.5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// expandQtyItems
// ---------------------------------------------------------------------------

function item(over: Partial<ApiItem> & { id: string }): ApiItem {
  return { label: "Item", qty: null, price_cents: 100, assigned_to: null, ...over };
}

describe("expandQtyItems — one row per unit, everything else untouched", () => {
  it("the headline case: 'Boba Tea ×3' at 1500 becomes three 500-cent rows with stable ids and NO qty suffix", () => {
    const src = item({ id: "a", label: "Boba Tea", qty: "×3", price_cents: 1500 });
    expect(expandQtyItems([src])).toEqual([
      { id: "a#1", label: "Boba Tea", qty: null, price_cents: 500, assigned_to: null },
      { id: "a#2", label: "Boba Tea", qty: null, price_cents: 500, assigned_to: null },
      { id: "a#3", label: "Boba Tea", qty: null, price_cents: 500, assigned_to: null },
    ]);
  });

  it("remainder cents ride the first units and the line total survives: 1000 ×3 -> 334/333/333", () => {
    const out = expandQtyItems([item({ id: "a", qty: "×3", price_cents: 1000 })]);
    expect(out.map((i) => i.price_cents)).toEqual([334, 333, 333]);
  });

  it("assigned_to is copied onto every unit", () => {
    const out = expandQtyItems([item({ id: "a", qty: "2x", price_cents: 590, assigned_to: "half" })]);
    expect(out.map((i) => i.assigned_to)).toEqual(["half", "half"]);
  });

  it("unparseable, absent, and sub-2 qtys pass through UNCHANGED (qty suffix intact)", () => {
    const src = [
      item({ id: "a", qty: null }),
      item({ id: "b", qty: "" }),
      item({ id: "c", qty: "abc" }),
      item({ id: "d", qty: "2 lb" }),
      item({ id: "e", qty: "1" }),
      item({ id: "f", qty: "0" }),
    ];
    expect(expandQtyItems(src)).toEqual(src);
  });

  it(`the per-line cap: ×${MAX_UNITS_PER_LINE} expands, ×${MAX_UNITS_PER_LINE + 1} passes through`, () => {
    const at = expandQtyItems([item({ id: "a", qty: `×${MAX_UNITS_PER_LINE}`, price_cents: 2000 })]);
    expect(at).toHaveLength(MAX_UNITS_PER_LINE);
    expect(at.reduce((s, i) => s + (i.price_cents ?? 0), 0)).toBe(2000);
    const over = [item({ id: "a", qty: `×${MAX_UNITS_PER_LINE + 1}`, price_cents: 2100 })];
    expect(expandQtyItems(over)).toEqual(over);
  });

  it("a null price cannot be split: the row passes through even with a parseable qty", () => {
    const src = [item({ id: "a", qty: "×2", price_cents: null })];
    expect(expandQtyItems(src)).toEqual(src);
  });

  it("a price that isn't a non-negative integer passes through (defensive; salvage should prevent it)", () => {
    const src = [item({ id: "a", qty: "×2", price_cents: 10.5 })];
    expect(expandQtyItems(src)).toEqual(src);
  });

  it("order is preserved: units replace their line in place", () => {
    const out = expandQtyItems([
      item({ id: "a", label: "Soup", qty: null, price_cents: 700 }),
      item({ id: "b", label: "Tea", qty: "×2", price_cents: 900 }),
      item({ id: "c", label: "Rice", qty: null, price_cents: 300 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "b#1", "b#2", "c"]);
    expect(out.map((i) => i.label)).toEqual(["Soup", "Tea", "Tea", "Rice"]);
  });

  it(`the ${MAX_EXPANDED_ITEMS}-item API cap: a line expands only when the WHOLE list still fits`, () => {
    // 98 plain items + one ×2 at the end: 98 + 2 = 100, exactly at the cap.
    const fits = Array.from({ length: 98 }, (_, i) => item({ id: `p${i}` })).concat([
      item({ id: "last", qty: "×2", price_cents: 300 }),
    ]);
    const fitsOut = expandQtyItems(fits);
    expect(fitsOut).toHaveLength(100);
    expect(fitsOut[98]!.id).toBe("last#1");
    expect(fitsOut[99]!.id).toBe("last#2");
    // 99 plain items + one ×2: expanding would make 101 — it passes through.
    const tight = Array.from({ length: 99 }, (_, i) => item({ id: `p${i}` })).concat([
      item({ id: "last", qty: "×2", price_cents: 300 }),
    ]);
    const tightOut = expandQtyItems(tight);
    expect(tightOut).toHaveLength(100);
    expect(tightOut[99]).toEqual(item({ id: "last", qty: "×2", price_cents: 300 }));
  });

  it("expands left to right as far as is safe, then stops: 50 lines of ×3 become 75 units + 25 untouched lines = 100", () => {
    // Walking left to right: expanding item k needs 3k + 3 + (49 - k) <= 100,
    // i.e. k <= 24 — the first 25 lines expand (75 rows), the rest pass
    // through with their qty intact (25 rows), landing exactly on the cap.
    const src = Array.from({ length: 50 }, (_, i) => item({ id: `l${i}`, qty: "×3", price_cents: 999 }));
    const out = expandQtyItems(src);
    expect(out).toHaveLength(100);
    expect(out.slice(0, 75).every((i) => i.qty === null)).toBe(true);
    expect(out.slice(75).every((i) => i.qty === "×3")).toBe(true);
    // Money is conserved through the partial expansion.
    expect(out.reduce((s, i) => s + (i.price_cents ?? 0), 0)).toBe(50 * 999);
  });

  it("property: for any list, the subtotal is conserved EXACTLY, the result stays within the cap, and ids stay unique", () => {
    const arbQty = fc.constantFrom<string | null>(
      null, "", "abc", "×2", "3x", "x4", "20", "×21", "1", "0", "999", "2 @ $1.50", "1.5 lb",
    );
    const arbItem = fc.record({
      id: fc.uuid(),
      label: fc.constant("Item"),
      qty: arbQty,
      price_cents: fc.integer({ min: 0, max: 100_000 }),
      assigned_to: fc.constantFrom<string | null>(null, "half"),
    });
    fc.assert(
      fc.property(fc.array(arbItem, { maxLength: 60 }), (src) => {
        const out = expandQtyItems(src);
        expect(out.reduce((s, i) => s + (i.price_cents ?? 0), 0)).toBe(
          src.reduce((s, i) => s + i.price_cents, 0),
        );
        expect(out.length).toBeGreaterThanOrEqual(src.length);
        expect(out.length).toBeLessThanOrEqual(MAX_EXPANDED_ITEMS);
        expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
      }),
      { numRuns: 200 },
    );
  });
});
