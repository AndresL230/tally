import type { CSSProperties } from "react";
import { percentShare } from "../../shared/money";
import { centsToPercent } from "../../shared/assign";
import { moneyAbs } from "../../shared/format";
import { ARCHIVO, MONO, SERIF, type Colors } from "../theme";

// The custom-split card that opens under a receipt row in the split state.
// Same grammar as the percent screen's card (PercentControl): the friend's
// amount on the left, yours on the right, one thumb-sized slider between
// them, and quick buttons for the shares people actually reach for. The
// value it edits is the VIEWER's cents of the item; the friend's side is
// always the remainder.

export interface ItemSplitControlProps {
  colors: Colors;
  friendName: string;
  /** Integer cents. The item's price; the two shares sum to it. */
  priceCents: number;
  /** Integer cents. The viewer's share. */
  viewerCents: number;
  onViewerCents: (cents: number) => void;
  /** A quick button picks a share AND is done: the card should fold away. */
  onPick?: (cents: number) => void;
  /** For the slider's accessible name. */
  label: string;
  /** Folding away: play the closing animation, then call onClosed. */
  closing?: boolean;
  onClosed?: () => void;
}

const capsLabel: CSSProperties = {
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const amount: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 24,
  lineHeight: 1.1,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/** The percent as a small tinted pill in the person's colour. */
const pill = (color: string): CSSProperties => ({
  font: `600 11px ${MONO}`,
  fontVariantNumeric: "tabular-nums",
  padding: "3px 7px",
  borderRadius: 999,
  background: `${color}1a`,
  color,
  whiteSpace: "nowrap",
});

const quickBtn = (active: boolean, accent: string): CSSProperties => ({
  flex: 1,
  height: 40,
  borderRadius: 10,
  border: active ? 0 : "1px solid rgba(0,0,0,.16)",
  background: active ? accent : "transparent",
  color: active ? "#fff" : "inherit",
  font: `600 13px ${ARCHIVO}`,
  cursor: "pointer",
});

export function ItemSplitControl({
  colors: C,
  friendName: F,
  priceCents,
  viewerCents,
  onViewerCents,
  onPick,
  label,
  closing = false,
  onClosed,
}: ItemSplitControlProps) {
  const viewerPct = centsToPercent(viewerCents, priceCents);
  const friendPct = 100 - viewerPct;
  const centsAt = (pct: number) => priceCents - percentShare(priceCents, 100 - pct);
  const setViewerPct = (pct: number) => onViewerCents(centsAt(pct));
  const pick = (pct: number) => {
    const cents = centsAt(pct);
    onViewerCents(cents);
    onPick?.(cents);
  };

  return (
    <div
      className="split-card"
      aria-hidden={closing}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) onClosed?.();
      }}
      style={{
        padding: "18px 18px 18px 24px",
        borderBottom: "1px solid rgba(0,0,0,.07)",
        background: `${C.me}0d`,
        overflow: "hidden",
        pointerEvents: closing ? "none" : "auto",
        animation: closing ? "splitClose .22s ease both" : "splitOpen .28s ease both",
      }}
    >
      {/* One line per side, name outermost so the two read as mirror
          images across the slider: JORDAN $2.75 (50%) … (50%) $2.75 YOU. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ ...capsLabel, color: C.fr }}>{F}</span>
          <span style={amount}>{moneyAbs(priceCents - viewerCents)}</span>
          <span style={pill(C.fr)}>{friendPct}%</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={pill(C.me)}>{viewerPct}%</span>
          <span style={amount}>{moneyAbs(viewerCents)}</span>
          <span style={{ ...capsLabel, color: C.me }}>You</span>
        </div>
      </div>

      <input
        type="range"
        className="split-range"
        min={0}
        max={100}
        step={5}
        value={friendPct}
        aria-label={`${F}'s percent of ${label}`}
        onChange={(e) => setViewerPct(100 - parseInt(e.target.value, 10))}
        style={
          {
            display: "block",
            marginTop: 10,
            "--split-track": `linear-gradient(90deg, ${C.fr} 0 ${friendPct}%, ${C.me} ${friendPct}% 100%)`,
          } as CSSProperties
        }
      />

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {[25, 50, 75].map((pct) => (
          <button key={pct} onClick={() => pick(pct)} style={quickBtn(viewerPct === pct, C.me)}>
            {pct}% yours
          </button>
        ))}
      </div>
    </div>
  );
}
