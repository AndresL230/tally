import { divRoundHalfUp } from "./money";

// The confirm screen's three-state item toggle. The st codes (0/1/2) are
// EPHEMERAL UI STATE only — everything posted or stored is canonical
// (an email or the literal 'half'); translation happens exactly here, at
// the UI boundary (reconciled decision D).

export type ItemState = 0 | 1 | 2;
// 0 = other person's (the default; zero taps is the common case)
// 1 = mine (the viewer's)
// 2 = half

/** One tap: other's -> mine -> half -> other's. */
export function cycleState(st: ItemState): ItemState {
  return ((st + 1) % 3) as ItemState;
}

/** UI -> canonical at POST time. */
export function stateToAssigned(
  st: ItemState,
  viewerEmail: string,
  friendEmail: string,
): string {
  if (viewerEmail === friendEmail) {
    throw new Error("viewer and friend must be different people");
  }
  switch (st) {
    case 0:
      return friendEmail;
    case 1:
      return viewerEmail;
    case 2:
      return "half";
  }
}

/** Canonical -> UI when loading. Extracted items arrive with
 *  assigned_to NULL, which renders as the default (other person's). */
export function assignedToState(
  assigned: string | null,
  viewerEmail: string,
  friendEmail: string,
): ItemState {
  if (viewerEmail === friendEmail) {
    throw new Error("viewer and friend must be different people");
  }
  if (assigned === null || assigned === friendEmail) return 0;
  if (assigned === viewerEmail) return 1;
  if (assigned === "half") return 2;
  throw new Error(`assigned_to must be a member email or 'half', got ${assigned}`);
}

/** Beat-confirm rule (mockup: noneMine = every st === 0): the commit
 *  button demands a second tap iff the list is NON-EMPTY and every item
 *  is still the other person's. A 'half' item breaks the beat. An empty
 *  list is false — the confirm screen must not commit zero items. */
export function needsBeatConfirm(states: readonly ItemState[]): boolean {
  return states.length > 0 && states.every((st) => st === 0);
}

// ---------------------------------------------------------------------------
// Custom splits. The confirm screen holds a custom split as the VIEWER's
// cents of the item — ephemeral UI state like the st codes — and translates
// at the same boundary: anchored on the viewer's email with share_cents
// going out, back to the viewer's cents from either anchor coming in.
// ---------------------------------------------------------------------------

/** UI -> canonical at POST time: the viewer pays viewerCents of the item. */
export function customToAssigned(
  viewerCents: number,
  viewerEmail: string,
  friendEmail: string,
): { assigned_to: string; share_cents: number } {
  if (viewerEmail === friendEmail) {
    throw new Error("viewer and friend must be different people");
  }
  if (!Number.isSafeInteger(viewerCents) || viewerCents < 0) {
    throw new Error("viewerCents must be a non-negative integer");
  }
  return { assigned_to: viewerEmail, share_cents: viewerCents };
}

/** Canonical -> the viewer's cents when loading, or null when the item is
 *  not custom-split. The anchor may be either member. */
export function assignedToCustom(
  assigned: string | null,
  shareCents: number | null,
  priceCents: number,
  viewerEmail: string,
  friendEmail: string,
): number | null {
  if (viewerEmail === friendEmail) {
    throw new Error("viewer and friend must be different people");
  }
  if (shareCents === null) return null;
  if (!Number.isSafeInteger(shareCents) || shareCents < 0 || shareCents > priceCents) {
    throw new Error("share_cents must be an integer between 0 and price_cents");
  }
  if (assigned === viewerEmail) return shareCents;
  if (assigned === friendEmail) return priceCents - shareCents;
  throw new Error(`share_cents needs a member email anchor, got ${assigned}`);
}

/** The whole percent that cents is of price (halves up); 0 of a free item. */
export function centsToPercent(cents: number, priceCents: number): number {
  if (priceCents === 0) return 0;
  return divRoundHalfUp(cents * 100, priceCents);
}
