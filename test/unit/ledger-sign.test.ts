// Property tests for src/shared/ledger.ts sign/viewer translation, written
// against M1_CONTRACT.md ONLY:
//
//   viewerDelta(canonicalCents, viewer, {person_a, person_b})
//     viewer===person_a -> unchanged; viewer===person_b -> negated; else throws
//   canonicalDelta(viewerCents, viewer, ledger)  // self-inverse
//   otherMember(viewer, ledger)
//   orderMembers(x, y): [a, b]  // lowercases; a < b; throws if equal

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  viewerDelta,
  canonicalDelta,
  otherMember,
  orderMembers,
} from "../../src/shared/ledger";

const A = "alex@example.com";
const B = "jordan@example.com"; // A < B lexicographically
const LEDGER = { person_a: A, person_b: B };
const OUTSIDER = "mallory@example.com";

const arbCents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

describe("viewerDelta — canonical -> viewer-relative", () => {
  it("is the identity for person_a and exact negation for person_b", () => {
    fc.assert(
      fc.property(arbCents, (x) => {
        expect(viewerDelta(x, A, LEDGER)).toBe(x);
        expect(viewerDelta(x, B, LEDGER)).toBe(-x);
      }),
      { numRuns: 300 },
    );
  });

  it("viewerDelta seen from person_a === -(viewerDelta seen from person_b)", () => {
    fc.assert(
      fc.property(arbCents, (x) => {
        expect(viewerDelta(x, A, LEDGER)).toBe(-viewerDelta(x, B, LEDGER));
      }),
      { numRuns: 300 },
    );
  });

  it("throws when the viewer is not a member of the ledger", () => {
    expect(() => viewerDelta(100, OUTSIDER, LEDGER)).toThrow();
    expect(() => viewerDelta(100, "", LEDGER)).toThrow();
  });
});

describe("canonicalDelta — viewer-relative -> canonical (self-inverse pair)", () => {
  it("round-trips: canonicalDelta(viewerDelta(x, v, L), v, L) === x for BOTH viewers", () => {
    fc.assert(
      fc.property(arbCents, fc.constantFrom(A, B), (x, viewer) => {
        expect(canonicalDelta(viewerDelta(x, viewer, LEDGER), viewer, LEDGER)).toBe(x);
      }),
      { numRuns: 300 },
    );
  });

  it("round-trips the other way: viewerDelta(canonicalDelta(x, v, L), v, L) === x for BOTH viewers", () => {
    fc.assert(
      fc.property(arbCents, fc.constantFrom(A, B), (x, viewer) => {
        expect(viewerDelta(canonicalDelta(x, viewer, LEDGER), viewer, LEDGER)).toBe(x);
      }),
      { numRuns: 300 },
    );
  });

  it("throws when the viewer is not a member of the ledger", () => {
    expect(() => canonicalDelta(100, OUTSIDER, LEDGER)).toThrow();
    expect(() => canonicalDelta(100, "", LEDGER)).toThrow();
  });
});

describe("otherMember — the counterpart of the viewer", () => {
  it("returns person_b for person_a and person_a for person_b", () => {
    expect(otherMember(A, LEDGER)).toBe(B);
    expect(otherMember(B, LEDGER)).toBe(A);
  });

  it("throws when the viewer is not a member of the ledger", () => {
    expect(() => otherMember(OUTSIDER, LEDGER)).toThrow();
    expect(() => otherMember("", LEDGER)).toThrow();
  });
});

describe("orderMembers — lowercases, orders a < b, throws on equal", () => {
  it("lowercases both emails and returns them in ascending order", () => {
    expect(orderMembers("B@X.com", "a@y.com")).toEqual(["a@y.com", "b@x.com"]);
    expect(orderMembers("a@y.com", "B@X.com")).toEqual(["a@y.com", "b@x.com"]);
    expect(orderMembers("JORDAN@EXAMPLE.COM", "alex@example.com")).toEqual([
      "alex@example.com",
      "jordan@example.com",
    ]);
    expect(orderMembers(A, B)).toEqual([A, B]);
  });

  it("property: result is the lowercased input pair, sorted with a < b", () => {
    // ASCII-ish emails so toLowerCase is unambiguous.
    const arbEmailish = fc.string({
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-",
      ),
      minLength: 1,
      maxLength: 20,
    });
    fc.assert(
      fc.property(arbEmailish, arbEmailish, (x, y) => {
        fc.pre(x.toLowerCase() !== y.toLowerCase());
        const [a, b] = orderMembers(x, y);
        expect(a < b).toBe(true);
        // Same members, lowercased — nothing invented, nothing dropped.
        expect([a, b]).toEqual([x.toLowerCase(), y.toLowerCase()].sort());
      }),
      { numRuns: 300 },
    );
  });

  it("throws when the two emails are equal after lowercasing", () => {
    expect(() => orderMembers("same@example.com", "same@example.com")).toThrow();
    expect(() => orderMembers("Alex@Example.COM", "alex@example.com")).toThrow();
  });
});
