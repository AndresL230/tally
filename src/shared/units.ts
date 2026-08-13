// Per-unit expansion of quantity line items. ALL INTEGER CENTS.
//
// Extraction (src/worker/extract.ts) records `qty` as a free-text display
// string copied off the receipt ("×2", "2x", "3", "2 @ 1.50", …) and
// `price_cents` as the price of the WHOLE LINE. The confirm screen expands
// such a line into one row per unit so each unit can be assigned
// separately (two teas mine, one theirs); the pure parsing and splitting
// lives here with the rest of the shared money code, not in the component.

import type { ApiItem } from "./types";

/**
 * Highest count one line may expand to. Twenty is deliberate: a bigger
 * count on a two-person receipt is far more likely a weight or a mis-read
 * than 20+ identical units anyone wants to assign one by one, twenty
 * same-label rows already strain the tap-to-assign list, and no single
 * line can then eat more than a fifth of the API's 100-item budget.
 */
export const MAX_UNITS_PER_LINE = 20;

/** The expenses POST rejects more than 100 items (mutations.ts), so
 *  expansion must never grow the confirm list past what the server will
 *  accept. */
export const MAX_EXPANDED_ITEMS = 100;

// Recognized quantity spellings, each anchored to the WHOLE string:
//   "3"                      bare integer
//   "×3" "x3" "X3" "*3"      multiplier prefix
//   "3×" "3x" "3X" "3*"      multiplier suffix
//   "3 @ 1.50" "3 @ $1.50"   count at unit price ("," decimals too)
// Decimals ("1.5") and unit-bearing strings ("2 lb") do NOT parse: a
// weight is not a count. Digits are capped at 9 so Number() stays exact
// (extraction caps the whole string at 10 chars anyway).
const QTY_PATTERNS = [
  /^\s*[×xX*]?\s*(\d{1,9})\s*$/, // bare or multiplier-prefixed
  /^\s*(\d{1,9})\s*[×xX*]\s*$/, // multiplier-suffixed
  /^\s*(\d{1,9})\s*@\s*\$?\d+(?:[.,]\d{1,2})?\s*$/, // count @ unit price
];

/** Read the count a qty display string denotes, or null when it doesn't
 *  denote one. Reports what the string SAYS ("0" -> 0, "999" -> 999);
 *  whether that count expands is the caller's decision. */
export function parseQtyCount(qty: string | null): number | null {
  if (qty === null) return null;
  for (const re of QTY_PATTERNS) {
    const m = re.exec(qty);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Split a line price into n unit prices that sum back EXACTLY:
 *  base = trunc(line/n) — BigInt, so the division never rides on floats —
 *  and the leftover (line - base*n) cents land one each on the FIRST
 *  units. The penny rule: no cent is ever lost or invented. */
export function splitPriceCents(lineCents: number, n: number): number[] {
  if (!Number.isSafeInteger(lineCents) || lineCents < 0) {
    throw new Error("line price_cents must be a non-negative integer");
  }
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error("unit count must be a positive integer");
  }
  const base = Number(BigInt(lineCents) / BigInt(n)); // truncates
  const remainder = lineCents - base * n; // 0 <= remainder < n
  const units = new Array<number>(n);
  for (let i = 0; i < n; i++) units[i] = i < remainder ? base + 1 : base;
  return units;
}

/**
 * Expand quantity lines into one row per unit, in place in the list.
 * A row expands iff its qty parses to n with 2 <= n <= MAX_UNITS_PER_LINE,
 * its price is a usable non-negative integer, and the WHOLE list stays
 * within MAX_EXPANDED_ITEMS (every not-yet-processed row counted as at
 * least 1) — a receipt that would blow past the cap expands left to right
 * only as far as is safe and the rest passes through unchanged, which
 * still posts. Expanded rows keep the label, DROP the qty suffix (three
 * rows each reading "Boba Tea ×3" would lie), copy assigned_to, and get
 * stable derived ids `${id}#1..#n` ("#" never appears in the UUID ids the
 * API mints, so derived ids cannot collide with real ones).
 */
export function expandQtyItems(items: readonly ApiItem[]): ApiItem[] {
  const out: ApiItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const n = parseQtyCount(item.qty);
    const remaining = items.length - i - 1;
    if (
      n !== null &&
      n >= 2 &&
      n <= MAX_UNITS_PER_LINE &&
      out.length + n + remaining <= MAX_EXPANDED_ITEMS &&
      item.price_cents !== null &&
      Number.isSafeInteger(item.price_cents) &&
      item.price_cents >= 0
    ) {
      const unitPrices = splitPriceCents(item.price_cents, n);
      for (let k = 0; k < n; k++) {
        out.push({
          id: `${item.id}#${k + 1}`,
          label: item.label,
          qty: null,
          price_cents: unitPrices[k]!,
          assigned_to: item.assigned_to,
        });
      }
    } else {
      out.push(item);
    }
  }
  return out;
}
