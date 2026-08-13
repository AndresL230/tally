// Void-chain resolution. A void is itself an expense whose reverses_id
// points at its target, so unvoiding appends a reversal OF the reversal.
// A row's live state is therefore the PARITY of its reversal chain:
//
//   E                      -> live
//   E <- R1                -> voided
//   E <- R1 <- R2          -> live again (unvoided)
//   E <- R1 <- R2 <- R3    -> voided again
//
// Only the tip of the chain may be targeted by a new void: the schema's
// UNIQUE(reverses_id) forbids reversing a row that is already reversed.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { chainDepth, chainTip, isVoided, type VoidChainRow } from "../../src/shared/voids";

/** Build a lookup for an original followed by `n` stacked reversals. */
function chainOf(n: number): { rows: Map<string, VoidChainRow>; ids: string[] } {
  const ids = ["e", ...Array.from({ length: n }, (_, i) => `r${i + 1}`)];
  const rows = new Map<string, VoidChainRow>();
  ids.forEach((id, i) => {
    rows.set(id, {
      id,
      reverses_id: i === 0 ? null : ids[i - 1]!,
      reversed_by: i === ids.length - 1 ? null : ids[i + 1]!,
    });
  });
  return { rows, ids };
}

describe("chainTip — the only row a new void may target", () => {
  it("is the row itself when nothing reverses it", () => {
    const { rows } = chainOf(0);
    expect(chainTip("e", rows)).toBe("e");
  });

  it("walks to the end of the reversal chain", () => {
    expect(chainTip("e", chainOf(1).rows)).toBe("r1");
    expect(chainTip("e", chainOf(2).rows)).toBe("r2");
    expect(chainTip("e", chainOf(5).rows)).toBe("r5");
  });

  it("returns the same tip from anywhere along the chain", () => {
    const { rows, ids } = chainOf(4);
    for (const id of ids) expect(chainTip(id, rows)).toBe("r4");
  });

  it("returns the id unchanged when it is not in the lookup", () => {
    expect(chainTip("ghost", chainOf(2).rows)).toBe("ghost");
  });

  it("terminates on a cyclic chain instead of hanging", () => {
    // Not reachable through the API, but malformed data must not spin the UI.
    const rows = new Map<string, VoidChainRow>([
      ["a", { id: "a", reverses_id: "b", reversed_by: "b" }],
      ["b", { id: "b", reverses_id: "a", reversed_by: "a" }],
    ]);
    expect(() => chainTip("a", rows)).not.toThrow();
  });
});

describe("chainDepth — distance from the original entry", () => {
  it("is 0 for the original and counts one per stacked reversal", () => {
    const { rows } = chainOf(3);
    expect(chainDepth("e", rows)).toBe(0);
    expect(chainDepth("r1", rows)).toBe(1);
    expect(chainDepth("r2", rows)).toBe(2);
    expect(chainDepth("r3", rows)).toBe(3);
  });

  it("distinguishes a re-void from an unvoid — both reverse a reversal", () => {
    const { rows } = chainOf(3);
    // r2 undoes r1's void; r3 voids again. "Reverses a reversal" is true of
    // BOTH, so only the parity of the depth tells them apart.
    expect(chainDepth("r2", rows) % 2).toBe(0); // an unvoid
    expect(chainDepth("r3", rows) % 2).toBe(1); // a void, again
  });

  it("is 0 for an unknown id and terminates on a cyclic chain", () => {
    expect(chainDepth("ghost", chainOf(2).rows)).toBe(0);
    const cyclic = new Map<string, VoidChainRow>([
      ["a", { id: "a", reverses_id: "b", reversed_by: "b" }],
      ["b", { id: "b", reverses_id: "a", reversed_by: "a" }],
    ]);
    expect(() => chainDepth("a", cyclic)).not.toThrow();
  });
});

describe("isVoided — parity of the reversal chain", () => {
  it("is false for an untouched entry", () => {
    expect(isVoided("e", chainOf(0).rows)).toBe(false);
  });

  it("is true after a void and false again after an unvoid", () => {
    expect(isVoided("e", chainOf(1).rows)).toBe(true);
    expect(isVoided("e", chainOf(2).rows)).toBe(false);
    expect(isVoided("e", chainOf(3).rows)).toBe(true);
    expect(isVoided("e", chainOf(4).rows)).toBe(false);
  });

  it("property: an original is voided exactly when its chain length is odd", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (n) => {
        expect(isVoided("e", chainOf(n).rows)).toBe(n % 2 === 1);
      }),
      { numRuns: 31 },
    );
  });

  it("is false for an id that is not in the lookup", () => {
    expect(isVoided("ghost", chainOf(1).rows)).toBe(false);
  });
});
