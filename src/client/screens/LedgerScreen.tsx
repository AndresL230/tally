import type { CSSProperties } from "react";
import type { ApiEntry, LedgerDetail } from "../../shared/types";
import { viewerDelta } from "../../shared/ledger";
import { moneyAbs, moneySigned, runningLabel, shortDate } from "../../shared/format";
import { ARCHIVO, INK, MONO, MUTED_3, MUTED_4, MUTED_5, MUTED_6, PAPER, SERIF, type Colors } from "../theme";

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
function numWord(n: number): string {
  return NUM_WORDS[n] ?? String(n);
}
function capitalize(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export interface LedgerScreenProps {
  detail: LedgerDetail;
  colors: Colors;
  friendName: string;
  onOpenEntry?: (entry: ApiEntry) => void;
  onSettle?: () => void;
  onAddReceipt?: () => void;
}

export function LedgerScreen({
  detail,
  colors: C,
  friendName: F,
  onOpenEntry,
  onSettle,
  onAddReceipt,
}: LedgerScreenProps) {
  const { entries, viewer, ledger } = detail;
  const v = (cents: number) => viewerDelta(cents, viewer, ledger);
  const balance = entries.length ? v(entries[entries.length - 1]!.running_cents) : 0;
  const open = balance !== 0;
  const owedByFriend = balance > 0;

  const settledLine = (() => {
    if (!entries.length) return "Nothing owed either way.";
    const receipts = entries.filter((e) => e.kind === "expense").length;
    const payments = entries.filter((e) => e.kind === "settlement").length;
    const since = shortDate(entries[entries.length - 1]!.occurred_on);
    return `Square since ${since}. ${capitalize(numWord(receipts))} receipt${receipts === 1 ? "" : "s"}, ${numWord(payments)} payment${payments === 1 ? "" : "s"}.`;
  })();

  const rows = entries
    .map((e) => {
      const dv = v(e.delta_cents);
      const run = v(e.running_cents);
      const pos = dv > 0;
      const isPay = e.kind === "settlement";
      const sub = isPay
        ? e.settlement?.from_email === viewer
          ? `you paid ${F}`
          : `${F} paid you`
        : `${shortDate(e.occurred_on)} · ${e.expense?.payer === viewer ? "you paid" : `${F} paid`}`;
      return { e, dv, run, pos, isPay, sub };
    })
    .reverse();

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 22px 20px", flex: "none" }}>
        <div style={{ font: `600 10px ${ARCHIVO}`, letterSpacing: ".16em", textTransform: "uppercase", color: MUTED_3 }}>
          You and {F}
        </div>

        {open ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: SERIF, fontSize: 64, lineHeight: 0.95, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>
              {moneyAbs(balance)}
            </div>
            <div style={{ marginTop: 8, font: `600 16px ${ARCHIVO}` }}>
              <span style={{ color: owedByFriend ? C.me : C.fr, fontWeight: 600 }}>
                {owedByFriend ? `${F} owes you` : `You owe ${F}`}
              </span>
            </div>
            <div style={{ marginTop: 14, height: 6, borderRadius: 3, overflow: "hidden", background: "rgba(0,0,0,.07)", display: "flex" }}>
              <div style={{ width: `${Math.min(100, Math.abs(balance) / 200)}%`, background: owedByFriend ? C.me : C.fr }} />
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 14, display: "flex", alignItems: "flex-end", gap: 18 }}>
              <div style={{ fontFamily: SERIF, fontSize: 64, lineHeight: 0.9 }}>Even.</div>
              <div style={{ position: "relative", width: 60, height: 40, marginBottom: 10, flex: "none" }}>
                {[0, 11, 22, 33].map((left) => (
                  <div key={left} style={{ position: "absolute", left, top: 0, width: 3, height: 36, background: INK }} />
                ))}
                <div style={{ position: "absolute", left: -3, top: 16, width: 48, height: 3, background: C.me, transform: "rotate(-24deg)", transformOrigin: "left center" }} />
              </div>
            </div>
            <div style={{ marginTop: 8, font: `400 15px ${ARCHIVO}`, color: "#6f6a61" }}>{settledLine}</div>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", borderTop: "1px solid rgba(0,0,0,.09)" }}>
        {entries.length ? (
          <div>
            {rows.map(({ e, dv, run, pos, isPay, sub }) => (
              <button
                key={e.id}
                onClick={onOpenEntry ? () => onOpenEntry(e) : undefined}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "3px 14px",
                  padding: "13px 22px",
                  border: 0,
                  borderBottom: "1px solid rgba(0,0,0,.055)",
                  alignItems: "baseline",
                  background: "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      flex: "none",
                      background: isPay ? "transparent" : pos ? C.me : C.fr,
                      border: isPay ? "1px solid rgba(0,0,0,.3)" : 0,
                    }}
                  />
                  <span
                    style={{
                      font: `${isPay ? "400" : "500"} 15px ${ARCHIVO}`,
                      color: isPay ? MUTED_3 : INK,
                      fontStyle: isPay ? "italic" : "normal",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isPay ? "Settle up" : e.expense?.merchant}
                  </span>
                </span>
                <span
                  style={{
                    font: `500 15px ${MONO}`,
                    fontVariantNumeric: "tabular-nums",
                    color: isPay ? MUTED_4 : pos ? C.me : C.fr,
                  }}
                >
                  {moneySigned(dv)}
                </span>
                <span style={{ font: `400 11.5px ${MONO}`, color: MUTED_3, paddingLeft: 19 }}>{sub}</span>
                <span
                  style={{
                    font: `400 11.5px ${MONO}`,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: run === 0 ? MUTED_4 : run > 0 ? C.me : C.fr,
                    opacity: 0.8,
                  }}
                >
                  {runningLabel(run)} <span style={{ color: MUTED_6 }}>›</span>
                </span>
              </button>
            ))}
            <div style={{ padding: 22, textAlign: "center", font: `400 11px ${MONO}`, color: MUTED_5, letterSpacing: ".08em" }}>
              — start of ledger —
            </div>
          </div>
        ) : (
          <div style={{ padding: "56px 30px", textAlign: "center" }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.25, color: INK }}>
              Nothing on the ledger yet.
              <br />
              Snap the next receipt.
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          flex: "none",
          padding: "12px 18px 22px",
          borderTop: "1px solid rgba(0,0,0,.09)",
          background: PAPER,
          display: "flex",
          gap: 10,
        }}
      >
        <button
          onClick={onSettle}
          style={{
            flex: "none",
            height: 58,
            padding: "0 20px",
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,.16)",
            background: "transparent",
            color: INK,
            font: `600 15px ${ARCHIVO}`,
            cursor: "pointer",
          }}
        >
          Settle up
        </button>
        <button
          onClick={onAddReceipt}
          style={{
            flex: 1,
            height: 58,
            borderRadius: 16,
            border: 0,
            background: C.me,
            color: "#fff",
            font: `600 16px ${ARCHIVO}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <CameraGlyph />
          Add receipt
        </button>
      </div>
    </div>
  );
}

function CameraGlyph() {
  const outer: CSSProperties = {
    width: 16,
    height: 13,
    border: "2px solid #f7f5ef",
    borderRadius: 3,
    display: "inline-block",
    position: "relative",
  };
  const inner: CSSProperties = {
    position: "absolute",
    left: 4,
    top: 2,
    width: 6,
    height: 6,
    border: "2px solid #f7f5ef",
    borderRadius: "50%",
  };
  return (
    <span style={outer}>
      <span style={inner} />
    </span>
  );
}
