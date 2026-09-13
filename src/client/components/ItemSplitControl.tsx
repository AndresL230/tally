import type { CSSProperties } from "react";
import { percentShare } from "../../shared/money";
import { centsToPercent } from "../../shared/assign";
import { moneyAbs } from "../../shared/format";
import { ARCHIVO, MONO, MUTED_3, SERIF, type Colors } from "../theme";

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
  /** For the slider's accessible name. */
  label: string;
}

const capsLabel: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  marginBottom: 4,
};

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
  label,
}: ItemSplitControlProps) {
  const viewerPct = centsToPercent(viewerCents, priceCents);
  const friendPct = 100 - viewerPct;
  const setViewerPct = (pct: number) => onViewerCents(priceCents - percentShare(priceCents, 100 - pct));

  return (
    <div
      className="split-card"
      style={{
        padding: "18px 18px 18px 24px",
        borderBottom: "1px solid rgba(0,0,0,.07)",
        background: `${C.me}0d`,
        overflow: "hidden",
        animation: "splitOpen .28s ease both",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span style={{ ...capsLabel, color: C.fr }}>{F}</span>
          <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {moneyAbs(priceCents - viewerCents)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ ...capsLabel, color: C.me }}>You</span>
          <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {moneyAbs(viewerCents)}
          </div>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={friendPct}
        aria-label={`${F}'s percent of ${label}`}
        onChange={(e) => setViewerPct(100 - parseInt(e.target.value, 10))}
        style={{ display: "block", width: "100%", margin: "16px 0 0", height: 34, accentColor: C.me }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          font: `500 12px ${MONO}`,
          color: MUTED_3,
        }}
      >
        <span>{friendPct}%</span>
        <span>{viewerPct}%</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {[25, 50, 75].map((pct) => (
          <button key={pct} onClick={() => setViewerPct(pct)} style={quickBtn(viewerPct === pct, C.me)}>
            {pct}% yours
          </button>
        ))}
      </div>
    </div>
  );
}
