import type { CSSProperties } from "react";
import { percentShare } from "../../shared/money";
import { moneyAbs } from "../../shared/format";
import { ARCHIVO, CARD, MONO, MUTED_3, SERIF, type Colors } from "../theme";

// The mockup's percent card (percent screen), extracted so manual entry and
// the extraction-fallback percent screen share one control.
//
// pct semantics (per the M1 contract): the slider value is ALWAYS the
// FRIEND's share percent, 0..100 in steps of 5.

export interface PercentControlProps {
  colors: Colors;
  friendName: string;
  /** Integer cents. The live amounts split this. */
  totalCents: number;
  pct: number;
  onPct: (pct: number) => void;
  style?: CSSProperties;
}

const quickBtn: CSSProperties = {
  flex: 1,
  height: 46,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,.16)",
  background: "transparent",
  font: `600 13px ${ARCHIVO}`,
  cursor: "pointer",
};

export function PercentControl({ colors: C, friendName: F, totalCents, pct, onPct, style }: PercentControlProps) {
  const friendCents = percentShare(totalCents, pct);
  const meCents = totalCents - friendCents; // derived, never computed independently

  return (
    <div
      style={{
        background: CARD,
        border: "1px solid rgba(0,0,0,.09)",
        borderRadius: 6,
        padding: "18px 16px 20px",
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div style={{ font: `600 12px ${ARCHIVO}`, color: C.fr, marginBottom: 2 }}>{F}</div>
          <div style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {moneyAbs(friendCents)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ font: `600 12px ${ARCHIVO}`, color: C.me, marginBottom: 2 }}>You</div>
          <div style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {moneyAbs(meCents)}
          </div>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onPct(parseInt(e.target.value, 10))}
        style={{ width: "100%", marginTop: 18, height: 34 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", font: `500 12px ${MONO}`, color: MUTED_3 }}>
        <span>{pct}%</span>
        <span>{100 - pct}%</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => onPct(100)} style={quickBtn}>
          All {F}'s
        </button>
        <button onClick={() => onPct(50)} style={quickBtn}>
          Half each
        </button>
        <button onClick={() => onPct(0)} style={quickBtn}>
          All yours
        </button>
      </div>
    </div>
  );
}
