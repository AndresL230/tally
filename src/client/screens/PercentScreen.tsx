import { useState } from "react";
import { percentShare } from "../../shared/money";
import { longDate, moneyAbs } from "../../shared/format";
import { ARCHIVO, MONO, MUTED_1, MUTED_3, SERIF, type Colors } from "../theme";
import { PercentControl } from "../components/PercentControl";

// Port of the mockup's percent screen (sc-if isPercent): the extraction
// fallback when the total came through but the line items didn't. Not
// reachable in M1 navigation — M2 wires it after extraction.

export interface PercentScreenProps {
  colors: Colors;
  friendName: string;
  merchant: string;
  /** Canonical 'YYYY-MM-DD'. */
  occurredOn: string;
  totalCents: number;
  /** Email of whoever paid. */
  payer: string;
  viewerEmail: string;
  onCancel: () => void;
  /** The NON-PAYER's share in cents, per the contract's pct semantics. */
  onCommit: (otherShareCents: number) => void;
}

export function PercentScreen({
  colors: C,
  friendName: F,
  merchant,
  occurredOn,
  totalCents,
  payer,
  viewerEmail,
  onCancel,
  onCommit,
}: PercentScreenProps) {
  const [pct, setPct] = useState(50);
  const payerIsViewer = payer === viewerEmail;

  const friendCents = percentShare(totalCents, pct);
  const meCents = totalCents - friendCents;
  // What the non-payer owes: the slider always means the FRIEND's percent.
  const owedCents = payerIsViewer ? friendCents : meCents;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 22px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={onCancel}
            style={{ border: 0, background: "transparent", padding: 0, font: `500 14px ${ARCHIVO}`, color: MUTED_3, cursor: "pointer" }}
          >
            Cancel
          </button>
          <span style={{ font: `600 10px ${ARCHIVO}`, letterSpacing: ".16em", textTransform: "uppercase", color: MUTED_3 }}>
            Check the receipt
          </span>
        </div>
        <div style={{ marginTop: 18, fontFamily: SERIF, fontSize: 32, lineHeight: 1.1 }}>{merchant}</div>
        <div style={{ marginTop: 6, font: `500 14px ${MONO}`, color: MUTED_3 }}>
          {longDate(occurredOn)} · {moneyAbs(totalCents)} · {payerIsViewer ? "you paid" : `${F} paid`}
        </div>

        <div
          style={{
            marginTop: 18,
            borderLeft: `3px solid ${C.me}`,
            paddingLeft: 14,
            font: `400 15px ${ARCHIVO}`,
            lineHeight: 1.5,
            color: MUTED_1,
          }}
        >
          The total came through, the line items didn't. Set each share by percentage instead.
        </div>

        <PercentControl colors={C} friendName={F} totalCents={totalCents} pct={pct} onPct={setPct} style={{ marginTop: 26 }} />
      </div>
      <div style={{ flex: "none", padding: "12px 18px 20px", borderTop: "1px solid rgba(0,0,0,.1)" }}>
        <div style={{ font: `500 15px ${ARCHIVO}`, color: MUTED_1, marginBottom: 10 }}>
          {payerIsViewer ? `${F} owes` : "You owe"}{" "}
          <span style={{ fontFamily: SERIF, fontSize: 26, verticalAlign: -3, margin: "0 4px" }}>{moneyAbs(owedCents)}</span> of{" "}
          {moneyAbs(totalCents)}
        </div>
        <button
          onClick={() => onCommit(owedCents)}
          style={{
            width: "100%",
            height: 58,
            borderRadius: 16,
            border: 0,
            background: C.me,
            color: "#fff",
            font: `600 16px ${ARCHIVO}`,
            cursor: "pointer",
          }}
        >
          Add to ledger
        </button>
      </div>
    </div>
  );
}
