// Small client-side helpers (no money math here).

/** Today's local date as canonical 'YYYY-MM-DD'. */
export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** An epoch-ms timestamp as the canonical 'YYYY-MM-DD' of its LOCAL day —
 *  the reader's calendar day, matching how todayISO() reads the clock. */
export function isoDay(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Loose canonical-date check for form guards. */
export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
