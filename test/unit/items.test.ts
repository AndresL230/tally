// Unit tests for src/shared/items.ts — the confirm screen's editable item
// list: what the subtotal is, how the total and the "extra (tax and tip)"
// line derive from each other, and removing a scanned row with one undo.
// Written BEFORE the implementation, against this contract:
//
//   subtotalOf(items): the sum of the item prices. Empty list -> 0.
//   totalFromExtra(subtotal, extra): the receipt total when the EXTRA is
//     the held quantity — total = subtotal + extra, clamped at 0 so a
//     discount bigger than what is left after deletions can never hand
//     splitItems a negative total (it throws on one). extra may be
//     negative; both arguments must be safe integers.
//   extraFromTotal(total, subtotal): the inverse, used when the user types
//     over the Total field and pins it. Negative when the total sits below
//     the items (a discount).
//   toggleExcluded(list, key): the list with that row crossed out, or put
//     back if it already was. A crossed-out row keeps its place in the
//     list — it is still on the receipt, just not on the split. An unknown
//     key changes nothing.
//   includedItems(list): the rows that still count, in order. Everything
//     that reaches the split, the subtotal, or the ledger goes through
//     this first.
//
// ALL MONEY IS INTEGER CENTS. No floats appear in any expectation.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extraFromTotal,
  includedItems,
  subtotalOf,
  toggleExcluded,
  totalFromExtra,
} from "../../src/shared/items";

interface Row {
  key: string;
  label: string;
  price_cents: number;
  excluded: boolean;
}

const rows: Row[] = [
  { key: "a", label: "Burger", price_cents: 1800, excluded: false },
  { key: "b", label: "Salad", price_cents: 1200, excluded: false },
  { key: "c", label: "Iced Tea", price_cents: 400, excluded: false },
];

// ---------------------------------------------------------------------------
// subtotalOf
// ---------------------------------------------------------------------------

describe("subtotalOf — what the items add up to", () => {
  it("sums the item prices in cents", () => {
    expect(subtotalOf(rows)).toBe(3400);
  });

  it("an empty list subtotals to zero", () => {
    expect(subtotalOf([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// totalFromExtra / extraFromTotal
// ---------------------------------------------------------------------------

describe("totalFromExtra — the total follows the items, holding the extra", () => {
  it("adds the held extra to the items subtotal", () => {
    expect(totalFromExtra(3400, 540)).toBe(3940);
  });

  it("crossing an item out drops the total by its price, extra untouched", () => {
    const left = includedItems(toggleExcluded(rows, "b"));
    expect(totalFromExtra(subtotalOf(left), 540)).toBe(2740);
  });

  it("a discount is a negative extra and subtracts", () => {
    expect(totalFromExtra(3400, -500)).toBe(2900);
  });

  it("a discount bigger than what is left clamps the total at zero", () => {
    expect(totalFromExtra(300, -500)).toBe(0);
  });

  it("rejects a non-integer subtotal or extra", () => {
    expect(() => totalFromExtra(3400.5, 0)).toThrow();
    expect(() => totalFromExtra(3400, 5.5)).toThrow();
  });
});

describe("extraFromTotal — typing over the total pins it", () => {
  it("is what the total carries above the items", () => {
    expect(extraFromTotal(3940, 3400)).toBe(540);
  });

  it("goes negative when the total sits below the items", () => {
    expect(extraFromTotal(2900, 3400)).toBe(-500);
  });

  it("property: pinning a total and re-deriving it is a round trip", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (total, subtotal) => {
          expect(totalFromExtra(subtotal, extraFromTotal(total, subtotal))).toBe(total);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// toggleExcluded / includedItems
// ---------------------------------------------------------------------------

describe("toggleExcluded — crossing out a row the scan got wrong", () => {
  it("crosses out the row with that key", () => {
    expect(toggleExcluded(rows, "b").map((r) => r.excluded)).toEqual([false, true, false]);
  });

  it("keeps the crossed-out row in its place, so it can be put back", () => {
    expect(toggleExcluded(rows, "b").map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("toggling the same row again puts it back", () => {
    expect(toggleExcluded(toggleExcluded(rows, "b"), "b")).toEqual(rows);
  });

  it("an unknown key changes nothing", () => {
    expect(toggleExcluded(rows, "nope")).toEqual(rows);
  });

  it("does not mutate the list it was given", () => {
    toggleExcluded(rows, "b");
    expect(rows.map((r) => r.excluded)).toEqual([false, false, false]);
  });
});

describe("includedItems — what still counts", () => {
  it("drops the crossed-out rows, keeping the rest in order", () => {
    expect(includedItems(toggleExcluded(rows, "b")).map((r) => r.key)).toEqual(["a", "c"]);
  });

  it("crossing every row out leaves nothing to split", () => {
    const none = rows.reduce((list, r) => toggleExcluded(list, r.key), rows);
    expect(includedItems(none)).toEqual([]);
  });

  it("property: a crossed-out row drops exactly its price, and undoing restores it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (prices, pick) => {
          const list = prices.map((price_cents, i) => ({
            key: `k${i}`,
            label: `Item ${i}`,
            price_cents,
            excluded: false,
          }));
          const target = list[pick % list.length]!;
          const crossed = toggleExcluded(list, target.key);
          expect(subtotalOf(includedItems(crossed))).toBe(
            subtotalOf(list) - target.price_cents,
          );
          expect(toggleExcluded(crossed, target.key)).toEqual(list);
        },
      ),
    );
  });
});
