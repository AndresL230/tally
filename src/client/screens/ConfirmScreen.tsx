import { useMemo, useState } from "react";
import { BackLink } from "../components/BackLink";
import type { CSSProperties } from "react";
import type { ApiItem } from "../../shared/types";
import { divRoundHalfUp, splitItems } from "../../shared/money";
import { money, moneyAbs, parseDollarsToCents } from "../../shared/format";
import {
  type ItemState,
  assignedToState,
  cycleState,
  needsBeatConfirm,
  stateToAssigned,
} from "../../shared/assign";
import { expandQtyItems } from "../../shared/units";
import { ARCHIVO, CARD, INK, MONO, MUTED_1, MUTED_2, MUTED_3, MUTED_4, PAPER, SERIF, halfBg, type Colors } from "../theme";
import { isISODate, todayISO } from "../util";

// The hero: the mockup's confirm screen (sc-if isConfirm), ported
// faithfully except for decision C — no tax-region chips here, and the
// mockup's separate Tax/Tip rows collapse into ONE "Extra (tax and tip)"
// dotted row. Item st codes (0/1/2) live only inside this component;
// canonical assigned_to crosses the boundary in both directions
// (assignedToState on load, stateToAssigned at commit).

interface ConfirmItem {
  key: string;
  label: string;
  qty: string | null;
  price_cents: number;
  st: ItemState;
}

export interface ConfirmCommit {
  merchant: string;
  occurred_on: string;
  total_cents: number;
  /** Email of whoever paid. */
  payer: string;
  /** CANONICAL assignment (email or 'half'). */
  items: { label: string; qty: string | null; price_cents: number; assigned_to: string }[];
}

export interface ConfirmScreenProps {
  colors: Colors;
  friendName: string;
  viewerEmail: string;
  friendEmail: string;
  receipt: { merchant: string | null; purchased_on: string | null; total_cents: number | null };
  /** Extracted items; assigned_to NULL renders as the other person's. */
  initialItems: ApiItem[];
  busy?: boolean;
  onCancel: () => void;
  onCommit: (payload: ConfirmCommit) => void;
  /** The zero-items escape hatch: split by percentage instead. */
  onFallbackPercent: () => void;
}

const capsLabel: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 4,
};

export function ConfirmScreen({
  colors: C,
  friendName: F,
  viewerEmail,
  friendEmail,
  receipt,
  initialItems,
  busy,
  onCancel,
  onCommit,
  onFallbackPercent,
}: ConfirmScreenProps) {
  // Quantity lines ("Boba Tea ×3", priced for the whole line) arrive here
  // expanded into one row per unit so each unit can be assigned separately
  // — visibly, while the user can still see and undo it. The posted items
  // are then already unit rows, so the server's split math is untouched.
  // Unit prices sum back to the line exactly (shared/units.ts).
  const [items, setItems] = useState<ConfirmItem[]>(() =>
    expandQtyItems(initialItems).map((it) => ({
      key: it.id,
      label: it.label ?? "Item",
      qty: it.qty || null,
      price_cents: it.price_cents ?? 0,
      st: assignedToState(it.assigned_to, viewerEmail, friendEmail),
    })),
  );
  const initialSubtotal = useMemo(
    () => initialItems.reduce((a, it) => a + (it.price_cents ?? 0), 0),
    [initialItems],
  );

  const [merchant, setMerchant] = useState(receipt.merchant ?? "");
  const [date, setDate] = useState(receipt.purchased_on ?? todayISO());
  // Items keep their prices no matter what; editing the total only moves
  // the extra line (extra = total - subtotal, possibly negative).
  const [totalCents, setTotalCents] = useState<number>(receipt.total_cents ?? initialSubtotal);
  const [totalText, setTotalText] = useState<string>(moneyAbs(receipt.total_cents ?? initialSubtotal));
  const [payer, setPayer] = useState<"me" | "friend">("me");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [beat, setBeat] = useState(false);

  const disarm = () => setBeat(false);

  const payerEmail = payer === "me" ? viewerEmail : friendEmail;
  const otherEmail = payer === "me" ? friendEmail : viewerEmail;

  // ALL live money comes out of splitItems — never local arithmetic.
  const split = splitItems(
    items.map((i) => ({ price_cents: i.price_cents, assigned_to: stateToAssigned(i.st, viewerEmail, friendEmail) })),
    payerEmail,
    otherEmail,
    totalCents,
  );
  const friendExtra = payer === "me" ? split.other_extra_cents : split.payer_extra_cents;
  const meExtra = payer === "me" ? split.payer_extra_cents : split.other_extra_cents;
  const friendShare = payer === "me" ? split.other_share_cents : split.payer_share_cents;
  const meShare = totalCents - friendShare;
  const owedCents = split.other_share_cents; // the non-payer's share
  const barPct = (share: number) =>
    `${Math.max(0, Math.min(100, divRoundHalfUp(share * 100, Math.max(1, totalCents))))}%`;

  const hasItems = items.length > 0;
  const needsBeat = needsBeatConfirm(items.map((i) => i.st));
  const valid = hasItems && merchant.trim().length > 0 && isISODate(date);

  const tapItem = (key: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, st: cycleState(i.st) } : i)));
    disarm();
  };

  const newPriceCents = parseDollarsToCents(newPrice);
  const canAddItem = newName.trim().length > 0 && newPriceCents !== null && newPriceCents > 0;
  const addItem = () => {
    if (!canAddItem || newPriceCents === null) return;
    setItems((prev) =>
      prev.concat([
        { key: crypto.randomUUID(), label: newName.trim(), qty: null, price_cents: newPriceCents, st: 0 },
      ]),
    );
    setNewName("");
    setNewPrice("");
    setAdding(false);
    disarm();
  };

  const commitTotal = () => {
    const cents = parseDollarsToCents(totalText);
    if (cents === null) {
      setTotalText(moneyAbs(totalCents)); // revert an unparseable edit
      return;
    }
    setTotalCents(cents);
    setTotalText(moneyAbs(cents));
    disarm();
  };

  // The extra (tax and tip) line is editable too: typing an amount re-derives
  // the total as items + extra, the inverse of editing the total. While the
  // field isn't focused it renders the derived split.extra_cents, so item
  // adds and total edits keep it honest.
  const subtotalCents = items.reduce((a, i) => a + i.price_cents, 0);
  const [extraFocused, setExtraFocused] = useState(false);
  const [extraText, setExtraText] = useState("");
  const commitExtra = () => {
    setExtraFocused(false);
    const cents = parseDollarsToCents(extraText);
    if (cents === null) return; // unparseable: fall back to the derived value
    const nextTotal = subtotalCents + cents;
    setTotalCents(nextTotal);
    setTotalText(moneyAbs(nextTotal));
    disarm();
  };

  const commit = () => {
    if (!valid || busy) return;
    if (needsBeat && !beat) {
      setBeat(true); // first tap arms; the second one commits
      return;
    }
    onCommit({
      merchant: merchant.trim(),
      occurred_on: date,
      total_cents: totalCents,
      payer: payerEmail,
      items: items.map((i) => ({
        label: i.label,
        qty: i.qty,
        price_cents: i.price_cents,
        assigned_to: stateToAssigned(i.st, viewerEmail, friendEmail),
      })),
    });
  };

  const payBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    height: 52,
    borderRadius: 14,
    cursor: "pointer",
    font: `600 16px ${ARCHIVO}`,
    border: active ? 0 : "1px solid rgba(0,0,0,.16)",
    background: active ? C.me : "transparent",
    color: active ? "#fff" : MUTED_2,
  });

  const dir = (color: string): CSSProperties => ({ color, fontWeight: 600 });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", padding: "4px 22px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <BackLink onClick={onCancel}>Cancel</BackLink>
          <span style={{ font: `600 10px ${ARCHIVO}`, letterSpacing: ".16em", textTransform: "uppercase", color: MUTED_3 }}>
            Check the receipt
          </span>
        </div>
        <input
          value={merchant}
          onChange={(e) => {
            setMerchant(e.target.value);
            disarm();
          }}
          placeholder="Merchant"
          style={{
            width: "100%",
            border: 0,
            borderBottom: "1px solid rgba(0,0,0,.18)",
            padding: "0 0 6px",
            fontFamily: SERIF,
            fontSize: 34,
            lineHeight: 1.1,
          }}
        />
        <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
          <label style={{ flex: 1, display: "block" }}>
            <span style={capsLabel}>Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                disarm();
              }}
              style={{
                width: "100%",
                height: 30,
                border: 0,
                borderBottom: "1px solid rgba(0,0,0,.18)",
                paddingBottom: 5,
                font: `500 15px ${MONO}`,
              }}
            />
          </label>
          <label style={{ width: 118, display: "block" }}>
            <span style={capsLabel}>Total</span>
            <input
              value={totalText}
              inputMode="decimal"
              onChange={(e) => setTotalText(e.target.value)}
              onBlur={commitTotal}
              style={{
                width: "100%",
                height: 30,
                border: 0,
                borderBottom: "1px solid rgba(0,0,0,.18)",
                paddingBottom: 5,
                font: `600 15px ${MONO}`,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            />
          </label>
        </div>
      </div>

      <div style={{ flex: "none", padding: "0 22px 14px" }}>
        <div style={{ ...capsLabel, marginBottom: 7 }}>Who paid</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setPayer("me");
              disarm();
            }}
            style={payBtn(payer === "me")}
          >
            You
          </button>
          <button
            onClick={() => {
              setPayer("friend");
              disarm();
            }}
            style={payBtn(payer === "friend")}
          >
            {F}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 22px 20px" }}>
        <div
          style={{
            background: CARD,
            border: "1px solid rgba(0,0,0,.09)",
            borderBottom: 0,
            borderRadius: "6px 6px 0 0",
            overflow: "hidden",
            animation: "tapeIn .35s ease both",
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
            <span>{items.length} items — tap to assign</span>
            <span>Amount</span>
          </div>

          {items.map((i) => (
            <button
              key={i.key}
              onClick={() => tapItem(i.key)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "stretch",
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 10,
                  flex: "none",
                  background: i.st === 0 ? C.fr : i.st === 1 ? C.me : halfBg(C),
                }}
              />
              <span
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  padding: "13px 14px",
                  minHeight: 62,
                  borderBottom: "1px solid rgba(0,0,0,.07)",
                  background: i.st === 0 ? "rgba(44,40,35,.05)" : i.st === 1 ? `${C.me}1f` : `${C.me}0d`,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, display: "block" }}>
                  <span style={{ display: "block", font: `500 16px ${ARCHIVO}`, color: INK }}>
                    {i.label}
                    {i.qty ? `  ${i.qty}` : ""}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      font: `500 11.5px ${MONO}`,
                      color: i.st === 0 ? C.fr : i.st === 1 ? C.me : MUTED_2,
                    }}
                  >
                    {i.st === 0
                      ? `${F}'s`
                      : i.st === 1
                        ? "Yours"
                        : `${moneyAbs(divRoundHalfUp(i.price_cents, 2))} each`}
                  </span>
                </span>
                <span
                  style={{
                    flex: "none",
                    width: 56,
                    borderBottom: "1px dotted rgba(0,0,0,.22)",
                    alignSelf: "center",
                    height: 1,
                    margin: "0 10px",
                  }}
                />
                <span
                  style={{
                    flex: "none",
                    font: `500 15px ${MONO}`,
                    fontVariantNumeric: "tabular-nums",
                    alignSelf: "center",
                  }}
                >
                  {moneyAbs(i.price_cents)}
                </span>
              </span>
            </button>
          ))}

          {adding && (
            <div
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid rgba(0,0,0,.07)",
                background: "rgba(0,0,0,.03)",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Item"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 0,
                  borderBottom: "1px solid rgba(0,0,0,.22)",
                  paddingBottom: 6,
                  font: `500 15px ${ARCHIVO}`,
                }}
              />
              <input
                value={newPrice}
                inputMode="decimal"
                onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                style={{
                  width: 66,
                  border: 0,
                  borderBottom: "1px solid rgba(0,0,0,.22)",
                  paddingBottom: 6,
                  font: `500 15px ${MONO}`,
                  textAlign: "right",
                }}
              />
              <button
                onClick={addItem}
                style={{
                  flex: "none",
                  height: 36,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: 0,
                  cursor: "pointer",
                  font: `600 13px ${ARCHIVO}`,
                  background: canAddItem ? C.me : "rgba(0,0,0,.14)",
                  color: canAddItem ? "#fff" : MUTED_3,
                }}
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAdding(false);
                  setNewName("");
                  setNewPrice("");
                }}
                style={{ border: 0, background: "transparent", padding: "0 2px", font: `500 13px ${ARCHIVO}`, color: MUTED_3, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          )}

          <button
            onClick={() => setAdding(true)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "13px 14px",
              border: 0,
              borderBottom: "1px solid rgba(0,0,0,.07)",
              background: "transparent",
              font: `500 14px ${ARCHIVO}`,
              color: MUTED_2,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                border: "1px solid rgba(0,0,0,.3)",
                borderRadius: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                lineHeight: 1,
                color: MUTED_2,
              }}
            >
              +
            </span>
            Add an item the scan missed
          </button>

          <div style={{ padding: "13px 14px", borderTop: "1px dashed rgba(0,0,0,.2)", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <label htmlFor="confirm-extra" style={{ font: `500 13.5px ${ARCHIVO}`, color: MUTED_1 }}>
                Extra (tax and tip)
              </label>
              <span style={{ flex: 1, borderBottom: "1px dotted rgba(0,0,0,.22)", margin: "0 8px", transform: "translateY(-3px)" }} />
              <input
                id="confirm-extra"
                value={extraFocused ? extraText : money(split.extra_cents)}
                inputMode="decimal"
                onFocus={(e) => {
                  setExtraFocused(true);
                  setExtraText(money(split.extra_cents));
                  e.target.select();
                }}
                onChange={(e) => setExtraText(e.target.value)}
                onBlur={commitExtra}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                style={{
                  width: 76,
                  border: 0,
                  borderBottom: "1px dashed rgba(0,0,0,.3)",
                  paddingBottom: 2,
                  font: `500 13.5px ${MONO}`,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              />
            </div>
            <div style={{ font: `400 12px ${MONO}`, color: MUTED_3, lineHeight: 1.5 }}>
              Divided in proportion to what each of you ate.
              <br />
              <span style={dir(C.fr)}>
                {F} {money(friendExtra)}
              </span>{" "}
              ·{" "}
              <span style={dir(C.me)}>
                You {money(meExtra)}
              </span>
            </div>
          </div>
          <div
            style={{
              height: 14,
              backgroundImage: `linear-gradient(45deg,transparent 33.4%,${PAPER} 33.4% 66.6%,transparent 66.6%),linear-gradient(-45deg,transparent 33.4%,${PAPER} 33.4% 66.6%,transparent 66.6%)`,
              backgroundSize: "14px 28px",
            }}
          />
        </div>
        <div style={{ marginTop: 14, font: `400 12.5px ${MONO}`, color: MUTED_4, lineHeight: 1.65 }}>
          How assigning works: every item starts as {F}'s. Tap it once to make
          it yours, twice to split it half-and-half (you each cover half its
          price), and a third time to hand it back to {F}. The colored edge
          shows whose it is; tax and tip divide themselves in proportion to
          what each of you took.
        </div>
      </div>

      <div style={{ flex: "none", padding: "12px 18px 20px", borderTop: "1px solid rgba(0,0,0,.1)", background: PAPER }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span style={{ font: `500 15px ${ARCHIVO}`, color: MUTED_1 }}>
            {payer === "me" ? `${F} owes` : "You owe"}
          </span>
          <span style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {money(owedCents)}
          </span>
          <span style={{ font: `500 15px ${ARCHIVO}`, color: MUTED_1 }}>of {moneyAbs(totalCents)}</span>
        </div>
        <div style={{ marginTop: 10, height: 8, borderRadius: 4, overflow: "hidden", display: "flex", background: "rgba(0,0,0,.07)" }}>
          <div style={{ width: barPct(friendShare), background: C.fr }} />
          <div style={{ width: barPct(meShare), background: C.me }} />
        </div>
        {beat && (
          <div style={{ marginTop: 10, font: `500 13px ${ARCHIVO}`, color: C.deep, lineHeight: 1.4 }}>
            Nothing here is marked yours. The whole {moneyAbs(totalCents)} goes to {F}.
          </div>
        )}
        {!hasItems && (
          <button
            onClick={onFallbackPercent}
            style={{
              display: "block",
              marginTop: 10,
              border: 0,
              background: "transparent",
              padding: 0,
              font: `400 13px ${MONO}`,
              color: MUTED_3,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            No line items — split it by percentage instead
          </button>
        )}
        <button
          onClick={commit}
          data-testid="confirm-commit"
          disabled={!valid || busy}
          style={{
            width: "100%",
            height: 58,
            marginTop: 12,
            borderRadius: 16,
            border: 0,
            cursor: valid ? "pointer" : "default",
            font: `600 16px ${ARCHIVO}`,
            background: !valid ? "rgba(0,0,0,.14)" : beat ? "#211f1c" : C.me,
            color: !valid ? MUTED_3 : "#fff",
          }}
        >
          {beat ? `Yes, all of it is ${F}'s` : "Add to ledger"}
        </button>
      </div>
    </div>
  );
}
