// Void-chain resolution. The ledger is append-only, so undoing a void is
// not a delete: it appends a reversal OF the reversal. A row's live state is
// therefore the PARITY of its chain, not the mere presence of reversed_by.
//
//   E                    live
//   E <- R1              voided
//   E <- R1 <- R2        live again
//   E <- R1 <- R2 <- R3  voided again
//
// Only the TIP may be targeted by a new void — the schema's
// UNIQUE(reverses_id) forbids reversing a row that is already reversed.

export interface VoidChainRow {
  id: string;
  reverses_id: string | null;
  reversed_by: string | null;
}

/** Walk to the end of the reversal chain containing `id`. Unknown ids come
 *  back unchanged; a malformed cyclic chain stops instead of spinning. */
export function chainTip(id: string, rows: Map<string, VoidChainRow>): string {
  const seen = new Set<string>([id]);
  let cursor = id;
  for (;;) {
    const next = rows.get(cursor)?.reversed_by;
    if (!next || seen.has(next)) return cursor;
    seen.add(next);
    cursor = next;
  }
}

/** How far `id` sits from the original entry: 0 for the entry itself, 1 for
 *  its void, 2 for the unvoid of that void, and so on. What a reversal DOES
 *  alternates with this — even rows are live entries, odd rows are live
 *  voids — so "does it reverse a reversal?" is NOT the same question. */
export function chainDepth(id: string, rows: Map<string, VoidChainRow>): number {
  const seen = new Set<string>([id]);
  let cursor = id;
  let depth = 0;
  for (;;) {
    const prev = rows.get(cursor)?.reverses_id;
    if (!prev || seen.has(prev)) return depth;
    seen.add(prev);
    cursor = prev;
    depth++;
  }
}

/** True when the reversals stacked on `id` leave it currently reversed. */
export function isVoided(id: string, rows: Map<string, VoidChainRow>): boolean {
  if (!rows.has(id)) return false;
  const seen = new Set<string>([id]);
  let cursor = id;
  let depth = 0;
  for (;;) {
    const next = rows.get(cursor)?.reversed_by;
    if (!next || seen.has(next)) return depth % 2 === 1;
    seen.add(next);
    cursor = next;
    depth++;
  }
}

/** Index the entries of a ledger detail for the two helpers above. */
export function voidChain(
  entries: { id: string; expense?: { reverses_id: string | null; reversed_by: string | null } }[],
): Map<string, VoidChainRow> {
  const rows = new Map<string, VoidChainRow>();
  for (const e of entries) {
    if (!e.expense) continue;
    rows.set(e.id, {
      id: e.id,
      reverses_id: e.expense.reverses_id,
      reversed_by: e.expense.reversed_by,
    });
  }
  return rows;
}
