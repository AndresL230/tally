// The custom-split half of src/shared/assign.ts. On the confirm screen a
// custom split is held as the VIEWER's cents of the item (ephemeral, like
// the st codes); it crosses the wire anchored on the viewer's email with
// share_cents, and loads back as the viewer's cents from either anchor.

import { describe, it, expect } from "vitest";
import { customToAssigned, assignedToCustom, centsToPercent } from "../../src/shared/assign";
import { percentShare } from "../../src/shared/money";

const VIEWER = "alex@example.com";
const FRIEND = "jordan@example.com";

describe("customToAssigned — UI -> canonical at POST time", () => {
  it("anchors on the viewer: assigned_to is the viewer, share_cents the viewer's cents", () => {
    expect(customToAssigned(300, VIEWER, FRIEND)).toEqual({ assigned_to: VIEWER, share_cents: 300 });
  });

  it("throws when viewer === friend", () => {
    expect(() => customToAssigned(300, VIEWER, VIEWER)).toThrow();
  });

  it("throws on a negative or non-integer amount", () => {
    expect(() => customToAssigned(-1, VIEWER, FRIEND)).toThrow();
    expect(() => customToAssigned(1.5, VIEWER, FRIEND)).toThrow();
  });
});

describe("assignedToCustom — canonical -> the viewer's cents when loading", () => {
  it("null share_cents is not a custom split", () => {
    expect(assignedToCustom(VIEWER, null, 1000, VIEWER, FRIEND)).toBeNull();
    expect(assignedToCustom(FRIEND, null, 1000, VIEWER, FRIEND)).toBeNull();
    expect(assignedToCustom("half", null, 1000, VIEWER, FRIEND)).toBeNull();
  });

  it("anchored on the viewer: share_cents is the viewer's cents", () => {
    expect(assignedToCustom(VIEWER, 300, 1000, VIEWER, FRIEND)).toBe(300);
  });

  it("anchored on the friend: the viewer's cents are the remainder", () => {
    expect(assignedToCustom(FRIEND, 300, 1000, VIEWER, FRIEND)).toBe(700);
  });

  it("throws on share_cents with 'half', an unknown email, or a share above the price", () => {
    expect(() => assignedToCustom("half", 300, 1000, VIEWER, FRIEND)).toThrow();
    expect(() => assignedToCustom("mallory@example.com", 300, 1000, VIEWER, FRIEND)).toThrow();
    expect(() => assignedToCustom(FRIEND, 1001, 1000, VIEWER, FRIEND)).toThrow();
  });

  it("round-trips through customToAssigned for either viewer", () => {
    const wire = customToAssigned(300, VIEWER, FRIEND);
    expect(assignedToCustom(wire.assigned_to, wire.share_cents, 1000, VIEWER, FRIEND)).toBe(300);
    expect(assignedToCustom(wire.assigned_to, wire.share_cents, 1000, FRIEND, VIEWER)).toBe(700);
  });
});

describe("centsToPercent — the editor's other field", () => {
  it("rounds to the nearest whole percent, halves up", () => {
    expect(centsToPercent(300, 1000)).toBe(30);
    expect(centsToPercent(333, 1000)).toBe(33);
    expect(centsToPercent(335, 1000)).toBe(34);
    expect(centsToPercent(1, 3)).toBe(33);
  });

  it("a free item is 0 percent, never a division by zero", () => {
    expect(centsToPercent(0, 0)).toBe(0);
  });

  it("is the inverse of percentShare on whole percents", () => {
    for (let pct = 0; pct <= 100; pct++) {
      expect(centsToPercent(percentShare(1000, pct), 1000)).toBe(pct);
    }
  });
});
