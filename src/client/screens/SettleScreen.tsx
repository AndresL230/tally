import { useState } from "react";
import { BackLink } from "../components/BackLink";
import { dollars, parseDollarsToCents } from "../../shared/format";
import { ARCHIVO, MONO, MUTED_1, MUTED_2, MUTED_3, SERIF, type Colors } from "../theme";

// Port of the mockup's settle screen (sc-if isSettle): direction sentence
// from the balance sign (viewer perspective), amount prefilled with the
// full balance, one button — plus the "Nothing to settle." settled variant.

export interface SettleScreenProps {
  colors: Colors;
  friendName: string;
  /** Viewer-relative balance in cents (positive = the friend owes the viewer). */
  balanceCents: number;
  onCancel: () => void;
  onCommit: (payload: { amount_cents: number }) => void;
}

export function SettleScreen({ colors: C, friendName: F, balanceCents, onCancel, onCommit }: SettleScreenProps) {
  const [text, setText] = useState(dollars(balanceCents));
  const amountCents = parseDollarsToCents(text);
  const open = balanceCents !== 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "4px 22px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <BackLink onClick={onCancel}>Cancel</BackLink>
        <span style={{ font: `600 10px ${ARCHIVO}`, letterSpacing: ".16em", textTransform: "uppercase", color: MUTED_3 }}>
          Settle up
        </span>
      </div>

      {open ? (
        <div style={{ marginTop: 40, flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ font: `500 17px ${ARCHIVO}`, color: MUTED_1 }}>
            {balanceCents > 0 ? `${F} is paying you back.` : `You are paying ${F} back.`}
          </div>
          <div
            style={{
              marginTop: 20,
              display: "flex",
              alignItems: "baseline",
              borderBottom: "1px solid rgba(0,0,0,.2)",
              paddingBottom: 8,
            }}
          >
            <span style={{ fontFamily: SERIF, fontSize: 44, color: MUTED_3 }}>$</span>
            <input
              value={text}
              inputMode="decimal"
              onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
              style={{
                flex: 1,
                border: 0,
                fontFamily: SERIF,
                fontSize: 62,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                padding: "0 0 0 4px",
                minWidth: 0,
              }}
            />
          </div>
          <div style={{ marginTop: 12, font: `400 13px ${MONO}`, color: MUTED_3 }}>
            Prefilled to the full balance. Change it for a partial payment.
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              if (amountCents !== null && amountCents > 0) onCommit({ amount_cents: amountCents });
            }}
            style={{
              width: "100%",
              height: 58,
              borderRadius: 16,
              border: 0,
              background: amountCents !== null && amountCents > 0 ? C.me : "rgba(0,0,0,.14)",
              color: amountCents !== null && amountCents > 0 ? "#fff" : MUTED_3,
              font: `600 16px ${ARCHIVO}`,
              cursor: "pointer",
            }}
          >
            Record payment
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 60, flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: SERIF, fontSize: 44, lineHeight: 1.05 }}>Nothing to settle.</div>
          <div style={{ marginTop: 10, font: `400 15px ${ARCHIVO}`, color: MUTED_2 }}>The balance is already zero.</div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              width: "100%",
              height: 58,
              borderRadius: 16,
              border: "1px solid rgba(0,0,0,.18)",
              background: "transparent",
              font: `600 16px ${ARCHIVO}`,
              cursor: "pointer",
            }}
          >
            Back to the ledger
          </button>
        </div>
      )}
    </div>
  );
}
