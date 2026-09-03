// The confirm screen's editable item list. ALL INTEGER CENTS.
//
// The scan is a draft, not a verdict: a line it invented, doubled, or
// mispriced has to be crossable-out and repriceable before anything reaches
// the ledger. Crossing a row out never deletes it — it stays in the list,
// struck through, so the user can see what the scan read and put it back —
// so `includedItems` is the gate every number passes through.
//
// That makes the ITEM LIST the thing the user edits and the receipt total a
// derived number, so this module holds the extra (tax and tip) and derives
// the total — total = subtotal + extra — with `extraFromTotal` as the
// inverse for when the user types over the total and pins it instead
// (DEVIATIONS D15). The split math itself stays in money.ts; nothing here
// knows who owes whom.

export interface PricedItem {
  price_cents: number;
}

export interface KeyedItem {
  key: string;
}

/** A row the user crossed out is still on the receipt, just not on the
 *  split — nothing here ever drops it from the list. */
export interface ExcludableItem extends KeyedItem {
  excluded: boolean;
}

/** What the items add up to. */
export function subtotalOf(items: readonly PricedItem[]): number {
  return items.reduce((sum, item) => sum + item.price_cents, 0);
}

/**
 * The receipt total with the extra held: total = subtotal + extra, clamped
 * at 0. Extra may be negative (a discount), and deleting items can leave a
 * discount larger than what remains — splitItems throws on a negative
 * total, so the clamp is what keeps an over-deleted receipt renderable
 * rather than crashing the screen.
 */
export function totalFromExtra(subtotalCents: number, extraCents: number): number {
  if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(extraCents)) {
    throw new Error("subtotal and extra must be safe integers");
  }
  return Math.max(0, subtotalCents + extraCents);
}

/** The inverse: the extra a typed-over total implies. Negative below the
 *  items (a discount). */
export function extraFromTotal(totalCents: number, subtotalCents: number): number {
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(subtotalCents)) {
    throw new Error("total and subtotal must be safe integers");
  }
  return totalCents - subtotalCents;
}

/** The list with that row crossed out, or put back if it already was. An
 *  unknown key changes nothing. Never mutates the list it is given. */
export function toggleExcluded<T extends ExcludableItem>(
  list: readonly T[],
  key: string,
): T[] {
  return list.map((item) =>
    item.key === key ? { ...item, excluded: !item.excluded } : item,
  );
}

/** The rows that still count, in order. The subtotal, the split, and the
 *  posted items all start here. */
export function includedItems<T extends { excluded: boolean }>(
  list: readonly T[],
): T[] {
  return list.filter((item) => !item.excluded);
}
