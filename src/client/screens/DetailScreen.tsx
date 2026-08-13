import { useState } from "react";
import { BackLink } from "../components/BackLink";
import type { CSSProperties } from "react";
import type { ApiEntry, LedgerDetail } from "../../shared/types";
import { otherMember, viewerDelta } from "../../shared/ledger";
import { chainDepth, chainTip, isVoided as chainVoided, voidChain } from "../../shared/voids";
import { divRoundHalfUp, splitItems, type SplitResult } from "../../shared/money";
import { longDate, money, moneyAbs, moneySigned } from "../../shared/format";
import { ARCHIVO, CARD, INK, MONO, MUTED_1, MUTED_2, MUTED_3, SERIF, halfBg, type Colors } from "../theme";
import { isoDay } from "../util";

// Port of the mockup's entry detail (sc-if isDetail): delta hero in the
// serif face, readonly item list with the spine/tint vocabulary, extra
// breakdown and share summary, note block for percent/manual entries and
// settlements — plus the M1 void affordance (no mockup design; it borrows
// the mockup's beat-confirm pattern: first tap arms, second tap voids).

export interface DetailScreenProps {
  entry: ApiEntry;
  detail: LedgerDetail;
  colors: Colors;
  friendName: string;
  onBack: () => void;
  /** Voids the given entry id. Unvoiding is the same call aimed at the live
   *  reversal — the ledger is append-only, so undo appends, never deletes. */
  onVoid: (targetId: string) => void;
  /** Swaps who paid, in place. Names the target payer, never "the other one". */
  onSetPayer: (entryId: string, payer: string) => void;
}

export function DetailScreen({
  entry,
  detail,
  colors: C,
  friendName: F,
  onBack,
  onVoid,
  onSetPayer,
}: DetailScreenProps) {
  const [armed, setArmed] = useState(false);
  const { viewer, ledger } = detail;
  const friendEmail = otherMember(viewer, ledger);

  const ex = entry.kind === "expense" ? entry.expense : undefined;
  const st = entry.kind === "settlement" ? entry.settlement : undefined;
  const isPay = entry.kind === "settlement";
  const isReversal = !!ex?.reverses_id;
  // Voided state is the PARITY of the reversal chain: a void that has itself
  // been voided is an undone void, and the original is live again.
  const chain = voidChain(detail.entries);
  const isVoided = !!ex && chainVoided(entry.id, chain);
  // Even depth = puts an entry back, odd = takes it away. Both reverse a
  // reversal once the chain is three long, so only the parity separates them.
  const undoesAVoid = isReversal && chainDepth(entry.id, chain) % 2 === 0;

  const dv = viewerDelta(entry.delta_cents, viewer, ledger);
  const pos = dv > 0;

  const payerLine = isPay
    ? st?.from_email === viewer
      ? "you paid"
      : `${F} paid`
    : ex?.payer === viewer
      ? "you paid"
      : `${F} paid`;

  const title = isPay ? "Settle up" : (ex?.merchant ?? "");
  // An expense can settle to nothing — whoever paid also had the whole
  // share. "you owed ${F} −$0.00" would read as a debt; it isn't one.
  const zeroMove = !isPay && dv === 0;
  const moveLine = isPay
    ? "came off the balance"
    : zeroMove
      ? "didn't move the balance"
      : pos
        ? `${F} owed you`
        : `you owed ${F}`;

  // Note block: settlements, percent/manual entries, and reversals.
  const items = ex?.items ?? [];
  const hasItems = !isPay && items.length > 0;
  const note = isPay
    ? st?.from_email === viewer
      ? `You paid ${F} back.`
      : `${F} paid you back.`
    : isReversal
      ? undoesAVoid
        ? `Puts the ${ex?.merchant ?? ""} entry back.`
        : `Reverses the ${ex?.merchant ?? ""} entry.`
      : (ex?.note ?? "No line items recorded.");
  const showNote = isPay || isReversal || !hasItems;

  // Share math for items entries — canonical assigned_to translated to the
  // viewer's labels here at the UI boundary, split via shared integer math.
  let sp: SplitResult | null = null;
  let friendShare = 0;
  let meShare = 0;
  let friendExtra = 0;
  let meExtra = 0;
  if (hasItems && ex) {
    const payerEmail = ex.payer;
    const otherEmail = payerEmail === viewer ? friendEmail : viewer;
    try {
      sp = splitItems(
        items.map((i) => ({ price_cents: i.price_cents ?? 0, assigned_to: i.assigned_to ?? otherEmail })),
        payerEmail,
        otherEmail,
        ex.total_cents,
      );
      const payerIsViewer = payerEmail === viewer;
      friendShare = payerIsViewer ? sp.other_share_cents : sp.payer_share_cents;
      meShare = payerIsViewer ? sp.payer_share_cents : sp.other_share_cents;
      friendExtra = payerIsViewer ? sp.other_extra_cents : sp.payer_extra_cents;
      meExtra = payerIsViewer ? sp.payer_extra_cents : sp.other_extra_cents;
    } catch {
      sp = null; // malformed item data: show the list, hide the breakdown
    }
  }

  const friendDir: CSSProperties = { color: C.fr, fontWeight: 600 };
  const meDir: CSSProperties = { color: C.me, fontWeight: 600 };
  const dottedRule: CSSProperties = {
    flex: 1,
    borderBottom: "1px dotted rgba(0,0,0,.22)",
    margin: "0 8px",
    transform: "translateY(-3px)",
  };

  const itemRow = (i: (typeof items)[number], idx: number) => {
    const kind = i.assigned_to === "half" ? "half" : i.assigned_to === viewer ? "mine" : "theirs";
    const price = i.price_cents ?? 0;
    const noteText =
      kind === "theirs" ? `${F}'s` : kind === "mine" ? "Yours" : `${moneyAbs(divRoundHalfUp(price, 2))} each`;
    return (
      <div key={i.id || idx} style={{ display: "flex", alignItems: "stretch" }}>
        <span
          style={{
            width: 10,
            flex: "none",
            background: kind === "theirs" ? C.fr : kind === "mine" ? C.me : halfBg(C),
          }}
        />
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            padding: "12px 14px",
            borderBottom: "1px solid rgba(0,0,0,.07)",
            background: kind === "theirs" ? "rgba(44,40,35,.05)" : kind === "mine" ? `${C.me}1f` : `${C.me}0d`,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, display: "block" }}>
            <span style={{ display: "block", font: `500 15px ${ARCHIVO}`, color: INK }}>
              {(i.label ?? "Item") + (i.qty ? `  ${i.qty}` : "")}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 3,
                font: `500 11.5px ${MONO}`,
                color: kind === "theirs" ? C.fr : kind === "mine" ? C.me : MUTED_2,
              }}
            >
              {noteText}
            </span>
          </span>
          <span style={{ flex: "none", font: `500 15px ${MONO}`, fontVariantNumeric: "tabular-nums", alignSelf: "center" }}>
            {moneyAbs(price)}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 22px 24px" }}>
        <BackLink onClick={onBack}>‹ Ledger</BackLink>
        <div style={{ marginTop: 22, fontFamily: SERIF, fontSize: 34, lineHeight: 1.08 }}>{title}</div>
        <div style={{ marginTop: 6, font: `500 13px ${MONO}`, color: MUTED_3 }}>
          {longDate(entry.occurred_on)} · {payerLine}
        </div>

        <div style={{ marginTop: 20, display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 38,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: isPay || zeroMove ? MUTED_2 : pos ? C.me : C.fr,
            }}
          >
            {zeroMove ? moneyAbs(0) : moneySigned(dv)}
          </span>
          <span style={{ font: `500 14px ${ARCHIVO}`, color: MUTED_1 }}>{moveLine}</span>
        </div>

        {showNote && (
          <div
            style={{
              marginTop: 20,
              borderLeft: "3px solid rgba(0,0,0,.15)",
              paddingLeft: 14,
              font: `400 14.5px ${ARCHIVO}`,
              lineHeight: 1.5,
              color: MUTED_2,
            }}
          >
            {note}
          </div>
        )}

        {hasItems && ex && (
          <div
            style={{
              marginTop: 22,
              background: CARD,
              border: "1px solid rgba(0,0,0,.09)",
              borderBottom: 0,
              borderRadius: "6px 6px 0 0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "11px 14px 9px",
                borderBottom: "1px dashed rgba(0,0,0,.2)",
                font: `600 9.5px ${ARCHIVO}`,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: MUTED_3,
              }}
            >
              <span>Who got what</span>
              <span>Amount</span>
            </div>
            {items.map(itemRow)}
            {sp && (
              <>
                <div style={{ padding: "13px 14px", borderTop: "1px dashed rgba(0,0,0,.2)", display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "baseline" }}>
                    <span style={{ font: `500 13.5px ${ARCHIVO}`, color: MUTED_1 }}>Tax and tip</span>
                    <span style={dottedRule} />
                    <span style={{ font: `500 13.5px ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{money(sp.extra_cents)}</span>
                  </div>
                  <div style={{ font: `400 12px ${MONO}`, color: MUTED_3, lineHeight: 1.5 }}>
                    Divided in proportion.
                    <br />
                    <span style={friendDir}>
                      {F} {money(friendExtra)}
                    </span>{" "}
                    ·{" "}
                    <span style={meDir}>You {money(meExtra)}</span>
                  </div>
                </div>
                <div style={{ padding: "13px 14px", borderTop: "1px dashed rgba(0,0,0,.2)", display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "baseline" }}>
                    <span style={{ ...friendDir, font: `600 13.5px ${ARCHIVO}`, color: C.fr }}>{F}'s share</span>
                    <span style={dottedRule} />
                    <span style={{ font: `600 14px ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{moneyAbs(friendShare)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline" }}>
                    <span style={{ ...meDir, font: `600 13.5px ${ARCHIVO}`, color: C.me }}>Your share</span>
                    <span style={dottedRule} />
                    <span style={{ font: `600 14px ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{moneyAbs(meShare)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", paddingTop: 4 }}>
                    <span style={{ font: `600 13.5px ${ARCHIVO}`, color: INK }}>Receipt total</span>
                    <span style={dottedRule} />
                    <span style={{ font: `600 14px ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{moneyAbs(ex.total_cents)}</span>
                  </div>
                </div>
              </>
            )}
            <div
              style={{
                height: 14,
                backgroundImage:
                  "linear-gradient(45deg,transparent 33.4%,#f2efe7 33.4% 66.6%,transparent 66.6%),linear-gradient(-45deg,transparent 33.4%,#f2efe7 33.4% 66.6%,transparent 66.6%)",
                backgroundSize: "14px 28px",
              }}
            />
          </div>
        )}

        {/* Who paid, swappable in place — the ledger's one edit. Single tap,
            no arming: unlike a void it undoes itself with another tap. Hidden
            on voids and voided entries, which the server refuses anyway. */}
        {ex && !isReversal && !isVoided && (
          <>
            <button
              onClick={() => onSetPayer(entry.id, ex.payer === viewer ? friendEmail : viewer)}
              style={{
                width: "100%",
                marginTop: 26,
                height: 52,
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,.18)",
                background: "transparent",
                color: INK,
                font: `600 15px ${ARCHIVO}`,
                cursor: "pointer",
              }}
            >
              {ex.payer === viewer ? `Switch to "${F} paid"` : `Switch to "you paid"`}
            </button>
            {ex.amended_at && (
              <div style={{ marginTop: 10, font: `400 12.5px ${MONO}`, color: MUTED_3 }}>
                Payer changed by {ex.amended_by === viewer ? "you" : F} on {longDate(isoDay(ex.amended_at))}.
              </div>
            )}
          </>
        )}

        {/* Void / unvoid affordance (M1, no mockup design — beat-confirm
            pattern). Unvoid aims the same call at the live reversal. */}
        {ex && !isReversal && (
          <>
            {isVoided && (
              <div style={{ marginTop: 26, font: `400 14.5px ${ARCHIVO}`, fontStyle: "italic", color: MUTED_3 }}>
                Voided. It isn't counted in the balance.
              </div>
            )}
            <button
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                // Voided: reverse the live reversal. Live: reverse the entry.
                onVoid(isVoided ? chainTip(entry.id, chain) : entry.id);
              }}
              style={{
                width: "100%",
                marginTop: isVoided ? 12 : 26,
                height: 56,
                borderRadius: 16,
                border: armed ? 0 : "1px solid rgba(0,0,0,.18)",
                background: armed ? "#211f1c" : "transparent",
                color: armed ? "#fff" : INK,
                font: `600 16px ${ARCHIVO}`,
                cursor: "pointer",
              }}
            >
              {isVoided
                ? armed
                  ? "Yes, put it back"
                  : "Unvoid this entry"
                : armed
                  ? "Yes, void it"
                  : "Void this entry"}
            </button>
          </>
        )}
      </div>
      <div style={{ flex: "none", padding: "12px 18px 20px", borderTop: "1px solid rgba(0,0,0,.1)" }}>
        <button
          onClick={onBack}
          style={{
            width: "100%",
            height: 56,
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
    </div>
  );
}
