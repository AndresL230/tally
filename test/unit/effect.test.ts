// expenseEffect — the balance movement a pending expense would make, stated
// in the viewer's terms. The entry screens compute this BEFORE committing so
// the user sees who ends up owing whom; a zero movement is called out rather
// than silently written as a no-op row.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { expenseEffect } from "../../src/shared/ledger";

const arbShare = fc.integer({ min: 0, max: 1_000_000 });

describe("expenseEffect — who ends up owing whom", () => {
  it("the payer is owed the other person's share", () => {
    expect(expenseEffect(250, true)).toEqual({ kind: "friend_owes_viewer", cents: 250 });
    expect(expenseEffect(250, false)).toEqual({ kind: "viewer_owes_friend", cents: 250 });
  });

  it("a zero share moves nothing, whoever paid", () => {
    expect(expenseEffect(0, true)).toEqual({ kind: "none" });
    expect(expenseEffect(0, false)).toEqual({ kind: "none" });
  });

  it("property: swapping the payer mirrors the direction and keeps the magnitude", () => {
    fc.assert(
      fc.property(arbShare, (share) => {
        const paid = expenseEffect(share, true);
        const owed = expenseEffect(share, false);
        if (share === 0) {
          expect(paid).toEqual({ kind: "none" });
          expect(owed).toEqual({ kind: "none" });
          return;
        }
        expect(paid).toEqual({ kind: "friend_owes_viewer", cents: share });
        expect(owed).toEqual({ kind: "viewer_owes_friend", cents: share });
      }),
      { numRuns: 300 },
    );
  });

  it("property: the reported magnitude is never negative", () => {
    fc.assert(
      fc.property(arbShare, fc.boolean(), (share, payerIsViewer) => {
        const effect = expenseEffect(share, payerIsViewer);
        if (effect.kind !== "none") expect(effect.cents).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});
