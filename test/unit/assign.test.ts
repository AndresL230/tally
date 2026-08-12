// Unit tests for the three-state toggle state machine, written against the
// normative spec in M2_CONTRACT.md (src/shared/assign.ts section) — NOT
// against the implementation.
//
// Contract:
//   0 = other person's (default), 1 = mine (viewer), 2 = half
//   cycleState: 0 -> 1 -> 2 -> 0 (one tap each)
//   stateToAssigned: 0 -> friendEmail, 1 -> viewerEmail, 2 -> 'half';
//     throws when viewerEmail === friendEmail
//   assignedToState: null -> 0 (extracted items arrive unassigned),
//     friendEmail -> 0, viewerEmail -> 1, 'half' -> 2, anything else throws;
//     throws when viewerEmail === friendEmail; round-trips with stateToAssigned
//   needsBeatConfirm: true iff the list is NON-EMPTY and every state === 0;
//     a 'half' item breaks the beat; empty list is false

import { describe, it, expect } from "vitest";
import {
  cycleState,
  stateToAssigned,
  assignedToState,
  needsBeatConfirm,
  type ItemState,
} from "../../src/shared/assign";

const VIEWER = "alex@example.com";
const FRIEND = "jordan@example.com";
const ALL_STATES: readonly ItemState[] = [0, 1, 2];

describe("cycleState — one tap: other's -> mine -> half -> other's", () => {
  it("cycles 0 -> 1", () => {
    expect(cycleState(0)).toBe(1);
  });

  it("cycles 1 -> 2", () => {
    expect(cycleState(1)).toBe(2);
  });

  it("cycles 2 -> 0 (wraps, never a fourth state)", () => {
    expect(cycleState(2)).toBe(0);
  });

  it("property: three taps is the identity for every state", () => {
    for (const st of ALL_STATES) {
      expect(cycleState(cycleState(cycleState(st)))).toBe(st);
    }
  });

  it("property: every tap lands on a valid state (0|1|2)", () => {
    for (const st of ALL_STATES) {
      expect(ALL_STATES).toContain(cycleState(st));
    }
  });
});

describe("stateToAssigned — UI -> canonical at POST time", () => {
  it("0 (other's, the default) -> the FRIEND's email, never the viewer's", () => {
    expect(stateToAssigned(0, VIEWER, FRIEND)).toBe(FRIEND);
  });

  it("1 (mine) -> the viewer's email", () => {
    expect(stateToAssigned(1, VIEWER, FRIEND)).toBe(VIEWER);
  });

  it("2 -> the literal string 'half'", () => {
    expect(stateToAssigned(2, VIEWER, FRIEND)).toBe("half");
  });

  it("throws when viewer === friend, for every state", () => {
    for (const st of ALL_STATES) {
      expect(() => stateToAssigned(st, VIEWER, VIEWER)).toThrow();
    }
  });
});

describe("assignedToState — canonical -> UI when loading", () => {
  it("NULL loads as 0: extracted items arrive unassigned = other person's", () => {
    expect(assignedToState(null, VIEWER, FRIEND)).toBe(0);
  });

  it("friend's email -> 0", () => {
    expect(assignedToState(FRIEND, VIEWER, FRIEND)).toBe(0);
  });

  it("viewer's email -> 1", () => {
    expect(assignedToState(VIEWER, VIEWER, FRIEND)).toBe(1);
  });

  it("'half' -> 2", () => {
    expect(assignedToState("half", VIEWER, FRIEND)).toBe(2);
  });

  it("throws on an unknown email (a third person is never a valid assignment)", () => {
    expect(() => assignedToState("mallory@example.com", VIEWER, FRIEND)).toThrow();
  });

  it("throws on viewer-relative junk like 'mine' / 'theirs'", () => {
    expect(() => assignedToState("mine", VIEWER, FRIEND)).toThrow();
    expect(() => assignedToState("theirs", VIEWER, FRIEND)).toThrow();
  });

  it("throws on near-miss spellings of 'half' (contract says the LITERAL 'half')", () => {
    expect(() => assignedToState("Half", VIEWER, FRIEND)).toThrow();
    expect(() => assignedToState("HALF", VIEWER, FRIEND)).toThrow();
    expect(() => assignedToState(" half", VIEWER, FRIEND)).toThrow();
  });

  it("throws on the empty string", () => {
    expect(() => assignedToState("", VIEWER, FRIEND)).toThrow();
  });

  it("throws when viewer === friend, even for values that would otherwise map", () => {
    expect(() => assignedToState(null, VIEWER, VIEWER)).toThrow();
    expect(() => assignedToState("half", VIEWER, VIEWER)).toThrow();
    expect(() => assignedToState(VIEWER, VIEWER, VIEWER)).toThrow();
  });
});

describe("round-trips between stateToAssigned and assignedToState", () => {
  it("state -> canonical -> state is the identity for all three states", () => {
    for (const st of ALL_STATES) {
      const canonical = stateToAssigned(st, VIEWER, FRIEND);
      expect(assignedToState(canonical, VIEWER, FRIEND)).toBe(st);
    }
  });

  it("canonical -> state -> canonical is the identity for all three canonical values", () => {
    for (const canonical of [FRIEND, VIEWER, "half"]) {
      const st = assignedToState(canonical, VIEWER, FRIEND);
      expect(stateToAssigned(st, VIEWER, FRIEND)).toBe(canonical);
    }
  });

  it("round-trips hold with the roles swapped (friend as viewer)", () => {
    for (const st of ALL_STATES) {
      const canonical = stateToAssigned(st, FRIEND, VIEWER);
      expect(assignedToState(canonical, FRIEND, VIEWER)).toBe(st);
    }
  });

  it("the SAME canonical value reads as opposite states for the two viewers", () => {
    // Stored canonically (rule D): VIEWER's email is 'mine' (1) to the viewer
    // but 'other's' (0) to the friend.
    expect(assignedToState(VIEWER, VIEWER, FRIEND)).toBe(1);
    expect(assignedToState(VIEWER, FRIEND, VIEWER)).toBe(0);
  });
});

describe("needsBeatConfirm — the 'Yes, all of it is <Name>'s' second tap", () => {
  it("empty list -> false (zero items must not commit at all)", () => {
    expect(needsBeatConfirm([])).toBe(false);
  });

  it("single item still other's -> true", () => {
    expect(needsBeatConfirm([0])).toBe(true);
  });

  it("all items other's (non-empty) -> true", () => {
    expect(needsBeatConfirm([0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it("any item mine -> false", () => {
    expect(needsBeatConfirm([0, 1, 0])).toBe(false);
    expect(needsBeatConfirm([1])).toBe(false);
  });

  it("a 'half' item breaks the beat -> false, including [0,0,2]", () => {
    expect(needsBeatConfirm([0, 0, 2])).toBe(false);
    expect(needsBeatConfirm([2])).toBe(false);
  });

  it("all mine / all half -> false", () => {
    expect(needsBeatConfirm([1, 1, 1])).toBe(false);
    expect(needsBeatConfirm([2, 2, 2])).toBe(false);
  });
});
