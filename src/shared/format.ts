// Display formatting for integer cents. Mirrors the mockup's formatting
// exactly (including the U+2212 minus on signed row amounts) but never
// passes through floats: cents are split with integer math.

export function dollars(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/** "$12.34"; negative values as "-$12.34" (mockup's m()). */
export function money(cents: number): string {
  return `${cents < 0 ? "-$" : "$"}${dollars(cents)}`;
}

/** Unsigned "$12.34" of the magnitude. */
export function moneyAbs(cents: number): string {
  return `$${dollars(cents)}`;
}

/** "+$12.34" / "−$12.34" (U+2212), as the ledger rows render deltas.
 *  Zero renders "−$0.00", matching the mockup (`pos = dv > 0`). */
export function moneySigned(cents: number): string {
  return `${cents > 0 ? "+" : "−"}$${dollars(cents)}`;
}

/** Ledger-row running balance: "even" at zero, else the magnitude. */
export function runningLabel(cents: number): string {
  return cents === 0 ? "even" : moneyAbs(cents);
}

/** "Aug 6" from 'YYYY-MM-DD' without Date-object timezone hazards. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m) - 1;
  return `${months[mi] ?? "?"} ${Number(d)}`;
}

/** "Aug 6, 2026" from 'YYYY-MM-DD'. */
export function longDate(iso: string): string {
  const y = iso.split("-")[0];
  return `${shortDate(iso)}, ${y}`;
}

/** Parse a user-typed dollar amount ("12.5", "$12.50") into cents, integer math only. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const m = cleaned.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1] ? parseInt(m[1], 10) : 0;
  const fracRaw = (m[2] ?? "").slice(0, 2).padEnd(2, "0");
  const frac = fracRaw ? parseInt(fracRaw, 10) : 0;
  if (!Number.isSafeInteger(whole)) return null;
  return whole * 100 + frac;
}
