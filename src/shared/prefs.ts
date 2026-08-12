// User preference constants shared by client rendering and server
// validation. The friend always renders as the fixed dark neutral
// (decision B); the accent palette is the mockup's six colors exactly.

export const ACCENT_PALETTE = [
  "#0a8a9b",
  "#1b6ef3",
  "#d4437a",
  "#e4572e",
  "#7c3aed",
  "#0f8a5f",
] as const;

export type AccentColor = (typeof ACCENT_PALETTE)[number];

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && (ACCENT_PALETTE as readonly string[]).includes(value);
}

/** Loose but serviceable e-mail shape check (the Access policy is the real
 *  gatekeeper; this catches typos before a dead ledger gets created). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}
