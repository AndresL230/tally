// The mockup's paper/ink palette, verbatim.

export const INK = "#211f1c";
export const PAPER = "#f2efe7";
export const CARD = "#fbfaf6";
export const FRIEND = "#2c2823"; // the friend always renders as this fixed dark neutral

export const MUTED_1 = "#4a453d";
export const MUTED_2 = "#6f6a61";
export const MUTED_3 = "#8a857c";
export const MUTED_4 = "#a8a298";
export const MUTED_5 = "#b3aca1";
export const MUTED_6 = "#c9c2b6";

export const ACCENT_PALETTE = [
  "#0a8a9b",
  "#1b6ef3",
  "#d4437a",
  "#e4572e",
  "#7c3aed",
  "#0f8a5f",
] as const;
export const DEFAULT_ACCENT = ACCENT_PALETTE[0];

export const ARCHIVO = "Archivo, sans-serif";
export const MONO = "'IBM Plex Mono', monospace";
export const SERIF = "'Instrument Serif', Georgia, serif";

/** The mockup's sh(): darken a hex color by a factor. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export interface Colors {
  me: string;
  hover: string;
  deep: string;
  fr: string;
}

export function colorsFor(accent: string | null | undefined): Colors {
  const me = accent || DEFAULT_ACCENT;
  return { me, hover: shade(me, 0.8), deep: shade(me, 0.7), fr: FRIEND };
}

/** The two-tone spine/swatch background for half-assigned items. */
export function halfBg(c: Colors): string {
  return `linear-gradient(180deg, ${c.me} 0 50%, ${c.fr} 50% 100%)`;
}
