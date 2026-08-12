import { useState } from "react";
import { BackLink } from "../components/BackLink";
import type { CSSProperties } from "react";
import { divRoundHalfUp, percentShare } from "../../shared/money";
import { moneyAbs, parseDollarsToCents } from "../../shared/format";
import { ARCHIVO, MONO, MUTED_1, MUTED_3, SERIF, type Colors } from "../theme";
import { PercentControl } from "../components/PercentControl";
import { isISODate, todayISO } from "../util";

// Port of the mockup's manual screen (sc-if isManual), with two copy
// variants: 'photofail' keeps the mockup's failure copy + Retake photo
// (wired in M2); 'byhand' is the non-apologetic M1 entry point.
//
// The percentage split control is added per the spec (owner ruling: manual
// entry gains a percentage split control the mockup lacks).

export interface ManualCommit {
  merchant: string;
  occurred_on: string;
  total_cents: number;
  /** Email of whoever paid. */
  payer: string;
  /** The NON-PAYER's share, per the contract's pct semantics. */
  other_share_cents: number;
}

export interface ManualScreenProps {
  reason: "byhand" | "photofail";
  colors: Colors;
  friendName: string;
  viewerEmail: string;
  friendEmail: string;
  onCancel: () => void;
  onCommit: (payload: ManualCommit) => void;
  /** photofail only; the camera flow arrives with M2. */
  onRetake?: () => void;
}

// Tax-region estimation helper (decision C: chips appear ONLY in manual
// entry). Rates in hundred-thousandths so the estimate is integer math:
// estimated tax = divRoundHalfUp(entered_total * rate, 100000).
const TAX_REGIONS = [
  { key: "none", label: "Untaxed", rate: 0 },
  { key: "nj", label: "NJ 6.625%", rate: 6625 },
  { key: "ny", label: "NY 8.875%", rate: 8875 },
] as const;
type TaxRegionKey = (typeof TAX_REGIONS)[number]["key"];

const labelCap: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 5,
};

export function ManualScreen({
  reason,
  colors: C,
  friendName: F,
  viewerEmail,
  friendEmail,
  onCancel,
  onCommit,
  onRetake,
}: ManualScreenProps) {
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(todayISO());
  const [totalText, setTotalText] = useState("");
  const [payer, setPayer] = useState<"me" | "friend">("me");
  const [pct, setPct] = useState(50);
  const [taxRegion, setTaxRegion] = useState<TaxRegionKey>("none");

  const enteredCents = parseDollarsToCents(totalText);
  const region = TAX_REGIONS.find((r) => r.key === taxRegion) ?? TAX_REGIONS[0];
  const taxCents =
    enteredCents === null || region.rate === 0
      ? 0
      : divRoundHalfUp(enteredCents * region.rate, 100000);
  // What actually gets committed: the entered amount plus the estimate.
  const totalCents = enteredCents === null ? null : enteredCents + taxCents;
  const valid = merchant.trim().length > 0 && totalCents !== null && isISODate(date);

  const payBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    height: 52,
    borderRadius: 14,
    cursor: "pointer",
    font: `600 16px ${ARCHIVO}`,
    border: active ? 0 : "1px solid rgba(0,0,0,.16)",
    background: active ? C.me : "transparent",
    color: active ? "#fff" : "#6f6a61",
  });

  const commit = () => {
    if (!valid || totalCents === null) return;
    const friendShare = percentShare(totalCents, pct);
    // The posted other_share is the NON-PAYER's share (contract):
    // viewer pays -> the friend is the other; friend pays -> the viewer is.
    const otherShare = payer === "me" ? friendShare : totalCents - friendShare;
    onCommit({
      merchant: merchant.trim(),
      occurred_on: date,
      total_cents: totalCents,
      payer: payer === "me" ? viewerEmail : friendEmail,
      other_share_cents: otherShare,
    });
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 22px 20px" }}>
        <BackLink onClick={onCancel}>Cancel</BackLink>

        <div style={{ marginTop: 18, borderLeft: `3px solid ${C.me}`, paddingLeft: 14 }}>
          {reason === "photofail" ? (
            <>
              <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15 }}>No text in that photo.</div>
              <div style={{ marginTop: 8, font: `400 15px ${ARCHIVO}`, lineHeight: 1.5, color: MUTED_1 }}>
                The image was too dark to find a total. Type it in below, or shoot it again with the receipt flat and lit.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15 }}>Enter it by hand.</div>
              <div style={{ marginTop: 8, font: `400 15px ${ARCHIVO}`, lineHeight: 1.5, color: MUTED_1 }}>
                Merchant, date, total — then split it.
              </div>
            </>
          )}
        </div>
        {reason === "photofail" && (
          <button
            onClick={onRetake}
            style={{
              marginTop: 16,
              height: 48,
              padding: "0 18px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,.18)",
              background: "transparent",
              font: `600 14px ${ARCHIVO}`,
              cursor: "pointer",
            }}
          >
            Retake photo
          </button>
        )}

        <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 18 }}>
          <label style={{ display: "block" }}>
            <span style={labelCap}>Merchant</span>
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              style={{
                width: "100%",
                border: 0,
                borderBottom: "1px solid rgba(0,0,0,.18)",
                paddingBottom: 7,
                font: `500 19px ${ARCHIVO}`,
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ flex: 1, display: "block" }}>
              <span style={labelCap}>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  border: 0,
                  borderBottom: "1px solid rgba(0,0,0,.18)",
                  paddingBottom: 7,
                  font: `500 16px ${MONO}`,
                }}
              />
            </label>
            <label style={{ width: 120, display: "block" }}>
              <span style={labelCap}>Total</span>
              <input
                value={totalText}
                inputMode="decimal"
                placeholder="$0.00"
                onChange={(e) => setTotalText(e.target.value)}
                onBlur={() => {
                  const cents = parseDollarsToCents(totalText);
                  if (cents !== null) setTotalText(moneyAbs(cents));
                }}
                style={{
                  width: "100%",
                  height: 34,
                  border: 0,
                  borderBottom: "1px solid rgba(0,0,0,.18)",
                  paddingBottom: 7,
                  font: `600 16px ${MONO}`,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </label>
          </div>
          <div>
            <div style={{ ...labelCap, marginBottom: 7 }}>Estimate tax</div>
            <div style={{ display: "flex", gap: 6 }}>
              {TAX_REGIONS.map((r) => {
                const active = taxRegion === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setTaxRegion(r.key)}
                    style={{
                      padding: "7px 11px",
                      borderRadius: 9,
                      cursor: "pointer",
                      font: `600 11.5px ${MONO}`,
                      border: `1px solid ${active ? C.me : "rgba(0,0,0,.14)"}`,
                      background: active ? `${C.me}22` : "transparent",
                      color: active ? C.deep : "#6f6a61",
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            {taxCents > 0 && totalCents !== null && (
              <div style={{ marginTop: 8, font: `400 12px ${MONO}`, color: MUTED_3 }}>
                +{moneyAbs(taxCents)} estimated tax → {moneyAbs(totalCents)} on the ledger
              </div>
            )}
          </div>
          <div>
            <div style={{ ...labelCap, marginBottom: 7 }}>Who paid</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPayer("me")} style={payBtn(payer === "me")}>
                You
              </button>
              <button onClick={() => setPayer("friend")} style={payBtn(payer === "friend")}>
                {F}
              </button>
            </div>
          </div>
          <PercentControl colors={C} friendName={F} totalCents={totalCents ?? 0} pct={pct} onPct={setPct} />
        </div>
      </div>
      <div style={{ flex: "none", padding: "12px 18px 20px", borderTop: "1px solid rgba(0,0,0,.1)" }}>
        <button
          onClick={commit}
          style={{
            width: "100%",
            height: 58,
            borderRadius: 16,
            border: 0,
            background: valid ? C.me : "rgba(0,0,0,.14)",
            color: valid ? "#fff" : MUTED_3,
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
