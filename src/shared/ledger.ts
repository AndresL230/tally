// Canonical <-> viewer-relative translation. Deltas are stored from
// person_a's perspective forever; both viewers see positive = "I'm owed".

export interface LedgerIdentity {
  person_a: string;
  person_b: string;
}

/** Translate a canonical delta into the viewer's perspective. */
export function viewerDelta(
  canonicalCents: number,
  viewer: string,
  ledger: LedgerIdentity,
): number {
  if (viewer === ledger.person_a) return canonicalCents;
  if (viewer === ledger.person_b) return -canonicalCents;
  throw new Error("viewer is not a member of this ledger");
}

/** Translate a viewer-relative delta back to canonical. Self-inverse. */
export function canonicalDelta(
  viewerCents: number,
  viewer: string,
  ledger: LedgerIdentity,
): number {
  return viewerDelta(viewerCents, viewer, ledger);
}

/** The other member of a two-person ledger. */
export function otherMember(viewer: string, ledger: LedgerIdentity): string {
  if (viewer === ledger.person_a) return ledger.person_b;
  if (viewer === ledger.person_b) return ledger.person_a;
  throw new Error("viewer is not a member of this ledger");
}

/** Canonical member ordering for a new ledger. */
export function orderMembers(x: string, y: string): [string, string] {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  if (a === b) throw new Error("a ledger needs two distinct people");
  return a < b ? [a, b] : [b, a];
}
