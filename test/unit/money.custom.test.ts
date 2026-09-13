// Custom per-item splits in src/shared/money.ts. A SplitItem may carry
// share_cents: the person named in assigned_to pays exactly that many cents
// of the item and the other member pays the rest. Exact cents, so no
// rounding rides on them; they join the half-cent accumulator as whole
// cents. ALL MONEY IS INTEGER CENTS.

import { describe, it, expect } from "vitest";
import { splitItems } from "../../src/shared/money";

const PAYER = "payer@example.com";
const OTHER = "other@example.com";

describe("splitItems — share_cents (custom per-item split)", () => {
  it("assigned to OTHER with share_cents: other pays exactly that, payer the rest", () => {
    const sp = splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 300 }], PAYER, OTHER, 1000);
    expect(sp.other_sub_cents).toBe(300);
    expect(sp.payer_sub_cents).toBe(700);
    expect(sp.other_share_cents).toBe(300);
    expect(sp.payer_share_cents).toBe(700);
  });

  it("assigned to PAYER with share_cents: other pays the remainder", () => {
    const sp = splitItems([{ price_cents: 1000, assigned_to: PAYER, share_cents: 300 }], PAYER, OTHER, 1000);
    expect(sp.other_sub_cents).toBe(700);
    expect(sp.payer_sub_cents).toBe(300);
  });

  it("null or absent share_cents means the whole item, as before", () => {
    const a = splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: null }], PAYER, OTHER, 1000);
    const b = splitItems([{ price_cents: 1000, assigned_to: OTHER }], PAYER, OTHER, 1000);
    expect(a.other_sub_cents).toBe(1000);
    expect(b.other_sub_cents).toBe(1000);
  });

  it("the full range is allowed: 0 and the whole price", () => {
    expect(splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 0 }], PAYER, OTHER, 1000).other_sub_cents).toBe(0);
    expect(splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 1000 }], PAYER, OTHER, 1000).other_sub_cents).toBe(1000);
  });

  it("custom cents join the half-cent accumulator and round once with the halves", () => {
    // half of 999 = 499.5 half-cent units 999; custom other 300 = 600 units;
    // 1599 units -> 799.5 -> 800 (halves toward +infinity).
    const sp = splitItems(
      [
        { price_cents: 999, assigned_to: "half" },
        { price_cents: 1000, assigned_to: OTHER, share_cents: 300 },
      ],
      PAYER,
      OTHER,
      1999,
    );
    expect(sp.other_sub_cents).toBe(800);
    expect(sp.payer_sub_cents).toBe(1199);
  });

  it("the extra splits in proportion to the custom subtotal", () => {
    // subtotal 1000, extra 100, other_sub 300 -> other_extra 30.
    const sp = splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 300 }], PAYER, OTHER, 1100);
    expect(sp.other_extra_cents).toBe(30);
    expect(sp.payer_extra_cents).toBe(70);
    expect(sp.other_share_cents).toBe(330);
    expect(sp.payer_share_cents).toBe(770);
  });

  it("rejects share_cents on a 'half' item", () => {
    expect(() =>
      splitItems([{ price_cents: 1000, assigned_to: "half", share_cents: 300 }], PAYER, OTHER, 1000),
    ).toThrow(/share_cents/);
  });

  it("rejects share_cents outside 0..price_cents or non-integer", () => {
    expect(() => splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 1001 }], PAYER, OTHER, 1000)).toThrow(/share_cents/);
    expect(() => splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: -1 }], PAYER, OTHER, 1000)).toThrow(/share_cents/);
    expect(() => splitItems([{ price_cents: 1000, assigned_to: OTHER, share_cents: 1.5 }], PAYER, OTHER, 1000)).toThrow(/share_cents/);
  });
});
