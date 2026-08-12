// The Tally logo as an inline SVG: four ink strokes crossed by the accent
// slash — the same mark as the app icon and the ledger's "Even." graphic.

import { INK } from "../theme";

export function TallyMark({ height = 18, accent }: { height?: number; accent: string }) {
  const width = (height * 64) / 48;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 48"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {[8, 22, 36, 50].map((x) => (
        <line key={x} x1={x} y1={5} x2={x} y2={43} stroke={INK} strokeWidth={6} strokeLinecap="round" />
      ))}
      <line x1={2} y1={34} x2={58} y2={12} stroke={accent} strokeWidth={6} strokeLinecap="round" />
    </svg>
  );
}
