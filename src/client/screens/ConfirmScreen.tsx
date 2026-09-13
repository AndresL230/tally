import { useMemo, useState } from "react";
import { BackLink } from "../components/BackLink";
import type { CSSProperties } from "react";
import type { ApiItem } from "../../shared/types";
import { divRoundHalfUp, percentShare, splitItems } from "../../shared/money";
import { money, moneyAbs, parseDollarsToCents } from "../../shared/format";
import {
  type ItemState,
  assignedToCustom,
  assignedToState,
  centsToPercent,
  customToAssigned,
  cycleState,
  needsBeatConfirm,
  stateToAssigned,
} from "../../shared/assign";
import { expandQtyItems } from "../../shared/units";
import {
  extraFromTotal,
  includedItems,
  subtotalOf,
  toggleExcluded,
  totalFromExtra,
} from "../../shared/items";
import { ARCHIVO, CARD, INK, MONO, MUTED_1, MUTED_2, MUTED_3, MUTED_4, PAPER, SERIF, customBg, halfBg, type Colors } from "../theme";
import { isISODate, todayISO } from "../util";

// The hero: the mockup's confirm screen (sc-if isConfirm), ported
// faithfully except for decision C — no tax-region chips here, and the
// mockup's separate Tax/Tip rows collapse into ONE "Extra (tax and tip)"
// dotted row. Item st codes (0/1/2) live only inside this component;
// canonical assigned_to crosses the boundary in both directions
// (assignedToState on load, stateToAssigned at commit).
//
// The scan is a draft: every row can be repriced here, or crossed out —
// struck through in place, never deleted, so the user can see what the
// scan read and put it back. Only the rows that still count reach the
// split. That makes the ITEM LIST what the user edits and the total a
// derived number: the extra (tax and tip) is the held quantity and
// total = subtotal + extra (DEVIATIONS D15). Typing over the total pins
// it by re-deriving the extra, the inverse; both derivations live in
// shared/items.ts.
//
// A row can also be split by a custom amount: the ÷ button opens an editor
// under the row where the viewer's share is typed as a percent or as
// dollars (each field derives the other). That share is held here as the
// VIEWER's cents, ephemeral like the st codes, and crosses the boundary
// through customToAssigned / assignedToCustom. It overrides the tap state
// while set; tapping the label clears it and cycles as usual.

interface ConfirmItem {
  key: string;
  label: string;
  qty: string | null;
  price_cents: number;
  st: ItemState;
  /** A custom split: the VIEWER's cents of this item. Overrides st. */
  custom: number | null;
  /** Crossed out: still shown, out of every number. */
  excluded: boolean;
}

export interface ConfirmCommit {
  merchant: string;
  occurred_on: string;
  total_cents: number;
  /** Email of whoever paid. */
  payer: string;
  /** CANONICAL assignment (email or 'half'), plus the anchored member's
   *  exact cents when the row is custom-split. */
  items: { label: string; qty: string | null; price_cents: number; assigned_to: string; share_cents: number | null }[];
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
      custom: assignedToCustom(it.assigned_to, it.share_cents, it.price_cents ?? 0, viewerEmail, friendEmail),
      excluded: false,
    })),
  );
  const initialSubtotal = useMemo(
    () => initialItems.reduce((a, it) => a + (it.price_cents ?? 0), 0),
    [initialItems],
  );

  const [merchant, setMerchant] = useState(receipt.merchant ?? "");
  const [date, setDate] = useState(receipt.purchased_on ?? todayISO());
  // The extra (tax and tip) is HELD and the total derives from the items,
  // so removing or repricing a row moves the total by that much. What the
  // scan read off the paper sets the opening extra.
  const [extraCents, setExtraCents] = useState<number>(() =>
    extraFromTotal(receipt.total_cents ?? initialSubtotal, initialSubtotal),
  );
  const [payer, setPayer] = useState<"me" | "friend">("me");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [beat, setBeat] = useState(false);
  // Only one price is ever mid-edit; while it is, the field shows the raw
  // keystrokes and every other row shows its stored price.
  const [editingPrice, setEditingPrice] = useState<{ key: string; text: string } | null>(null);
  const [totalFocused, setTotalFocused] = useState(false);
  const [totalText, setTotalText] = useState("");
  // The row whose custom-split editor is open, and the raw keystrokes of
  // whichever of its two fields is mid-edit (the other shows the derived
  // value).
  const [splitOpen, setSplitOpen] = useState<string | null>(null);
  const [splitText, setSplitText] = useState<{ field: "pct" | "amt"; text: string } | null>(null);

  // UI -> canonical, one place for both the live split and the commit.
  const wireOf = (i: ConfirmItem): { assigned_to: string; share_cents: number | null } =>
    i.custom !== null
      ? customToAssigned(i.custom, viewerEmail, friendEmail)
      : { assigned_to: stateToAssigned(i.st, viewerEmail, friendEmail), share_cents: null };

  // Crossed-out rows are still rendered; from here down, only the included
  // ones exist. Nothing crossed out reaches the subtotal, the split, or the
  // ledger.
  const included = includedItems(items);
  const subtotalCents = subtotalOf(included);
  const totalCents = totalFromExtra(subtotalCents, extraCents);

  const disarm = () => setBeat(false);

  const payerEmail = payer === "me" ? viewerEmail : friendEmail;
  const otherEmail = payer === "me" ? friendEmail : viewerEmail;

  // ALL live money comes out of splitItems — never local arithmetic.
  const split = splitItems(
    included.map((i) => ({ price_cents: i.price_cents, ...wireOf(i) })),
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

  const hasItems = included.length > 0;
  // A custom-split row breaks the beat the way a half row does: the user
  // has plainly touched it, so it counts as state 2 for the check.
  const needsBeat = needsBeatConfirm(included.map((i) => (i.custom !== null ? 2 : i.st)));
  const valid = hasItems && merchant.trim().length > 0 && isISODate(date);

  const tapItem = (key: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, st: cycleState(i.st), custom: null } : i)));
    if (splitOpen === key) setSplitOpen(null);
    disarm();
  };

  // ÷ opens the editor (starting at an even split when the row has no
  // custom share yet) and closes it again; closing keeps the share.
  const toggleSplit = (key: string) => {
    if (splitOpen === key) {
      setSplitOpen(null);
      setSplitText(null);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.key === key && i.custom === null ? { ...i, custom: percentShare(i.price_cents, 50) } : i,
      ),
    );
    setSplitOpen(key);
    setSplitText(null);
    disarm();
  };

  const setCustom = (key: string, cents: number) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, custom: cents } : i)));
    disarm();
  };

  const newPriceCents = parseDollarsToCents(newPrice);
  const canAddItem = newName.trim().length > 0 && newPriceCents !== null && newPriceCents > 0;
  const addItem = () => {
    if (!canAddItem || newPriceCents === null) return;
    setItems((prev) =>
      prev.concat([
        {
          key: crypto.randomUUID(),
          label: newName.trim(),
          qty: null,
          price_cents: newPriceCents,
          st: 0,
          custom: null,
          excluded: false,
        },
      ]),
    );
    setNewName("");
    setNewPrice("");
    setAdding(false);
    disarm();
  };

  // ✕ crosses the row out, ↺ puts it back — the same toggle in the same
  // box, so a
  // mis-tap costs one tap and the scan's own reading stays on screen.
  const toggleItem = (key: string) => {
    setItems(toggleExcluded(items, key));
    if (editingPrice?.key === key) setEditingPrice(null);
    if (splitOpen === key) setSplitOpen(null);
    disarm();
  };

  // Repricing a row is the other half of fixing a bad scan: the subtotal
  // follows the typed price, and so does the total. An unparseable edit
  // reverts to the stored price rather than guessing.
  const commitPrice = (key: string) => {
    const edit = editingPrice;
    setEditingPrice(null);
    if (!edit || edit.key !== key) return;
    const cents = parseDollarsToCents(edit.text);
    if (cents === null) return;
    // A custom share can never exceed what the row now costs.
    setItems((prev) =>
      prev.map((i) =>
        i.key === key
          ? { ...i, price_cents: cents, custom: i.custom === null ? null : Math.min(i.custom, cents) }
          : i,
      ),
    );
    disarm();
  };

  // Typing a total PINS it: the extra absorbs the difference, which is the
  // inverse of the items -> total derivation. An unparseable edit falls back
  // to the derived total.
  const commitTotal = () => {
    setTotalFocused(false);
    const cents = parseDollarsToCents(totalText);
    if (cents === null) return;
    setExtraCents(extraFromTotal(cents, subtotalCents));
    disarm();
  };

  // The extra (tax and tip) line is editable directly too. Unfocused it
  // renders split.extra_cents rather than the held value, so a total clamped
  // at zero (a discount larger than what the remaining items cost) shows the
  // extra the split math actually used.
  const [extraFocused, setExtraFocused] = useState(false);
  const [extraText, setExtraText] = useState("");
  const commitExtra = () => {
    setExtraFocused(false);
    const cents = parseDollarsToCents(extraText);
    if (cents === null) return; // unparseable: fall back to the derived value
    setExtraCents(cents);
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
      items: included.map((i) => ({
        label: i.label,
        qty: i.qty,
        price_cents: i.price_cents,
        ...wireOf(i),
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
              value={totalFocused ? totalText : moneyAbs(totalCents)}
              inputMode="decimal"
              onFocus={(e) => {
                setTotalFocused(true);
                setTotalText(moneyAbs(totalCents));
                e.target.select();
              }}
              onChange={(e) => setTotalText(e.target.value)}
              onBlur={commitTotal}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
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
            <span>{included.length} items — tap to assign</span>
            <span>Amount</span>
          </div>

          {/* The row is no longer one big button: tapping the label cycles
              the assignment, the amount is an input, and ✕ crosses the row
              out (↺, in its place, brings it back). Nesting those inside
              a button would be invalid, so the row is a div and the tap
              target is the label half. A crossed-out row keeps its place,
              greyed and struck through, and stops responding to everything
              but Undo. */}
          {items.map((i) => (
            <div key={i.key} className="receipt-row" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <span
                style={{
                  width: 10,
                  flex: "none",
                  background: i.excluded
                    ? "rgba(0,0,0,.10)"
                    : i.custom !== null
                      ? customBg(C, centsToPercent(i.custom, i.price_cents))
                      : i.st === 0
                        ? C.fr
                        : i.st === 1
                          ? C.me
                          : halfBg(C),
                }}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "13px 14px",
                  minHeight: 62,
                  borderBottom: "1px solid rgba(0,0,0,.07)",
                  background: i.excluded
                    ? "rgba(0,0,0,.02)"
                    : i.custom !== null
                      ? `${C.me}0d`
                      : i.st === 0
                        ? "rgba(44,40,35,.05)"
                        : i.st === 1
                          ? `${C.me}1f`
                          : `${C.me}0d`,
                }}
              >
                <button
                  onClick={() => tapItem(i.key)}
                  disabled={i.excluded}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "block",
                    alignSelf: "stretch",
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    cursor: i.excluded ? "default" : "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      font: `500 16px ${ARCHIVO}`,
                      color: i.excluded ? MUTED_3 : INK,
                      textDecoration: i.excluded ? "line-through" : "none",
                    }}
                  >
                    {i.label}
                    {i.qty ? `  ${i.qty}` : ""}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      font: `500 11.5px ${MONO}`,
                      color: i.excluded ? MUTED_4 : i.custom !== null ? MUTED_2 : i.st === 0 ? C.fr : i.st === 1 ? C.me : MUTED_2,
                    }}
                  >
                    {i.excluded
                      ? "Not on this split"
                      : i.custom !== null
                        ? `You ${moneyAbs(i.custom)} · ${F} ${moneyAbs(i.price_cents - i.custom)}`
                        : i.st === 0
                          ? `${F}'s`
                          : i.st === 1
                            ? "Yours"
                            : `${moneyAbs(divRoundHalfUp(i.price_cents, 2))} each`}
                  </span>
                </button>
                <span
                  style={{
                    flex: "0 1 40px",
                    minWidth: 10,
                    borderBottom: "1px dotted rgba(0,0,0,.22)",
                    alignSelf: "center",
                    height: 1,
                    margin: "0 8px",
                    opacity: i.excluded ? 0.4 : 1,
                  }}
                />
                <input
                  value={editingPrice?.key === i.key ? editingPrice.text : moneyAbs(i.price_cents)}
                  inputMode="decimal"
                  disabled={i.excluded}
                  aria-label={`Price of ${i.label}`}
                  onFocus={(e) => {
                    setEditingPrice({ key: i.key, text: moneyAbs(i.price_cents) });
                    e.target.select();
                  }}
                  onChange={(e) => setEditingPrice({ key: i.key, text: e.target.value })}
                  onBlur={() => commitPrice(i.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  style={{
                    flex: "none",
                    width: 68,
                    border: 0,
                    borderBottom: i.excluded ? "1px solid transparent" : "1px dashed rgba(0,0,0,.28)",
                    background: "transparent",
                    padding: "0 0 2px",
                    alignSelf: "center",
                    font: `500 15px ${MONO}`,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                    color: i.excluded ? MUTED_3 : INK,
                    textDecoration: i.excluded ? "line-through" : "none",
                    // A disabled input is dimmed by the UA (iOS Safari most
                    // of all); the crossed-out row states its own greying.
                    WebkitTextFillColor: i.excluded ? MUTED_3 : undefined,
                    opacity: 1,
                  }}
                />
                <button
                  onClick={() => toggleSplit(i.key)}
                  disabled={i.excluded}
                  aria-label={`Split ${i.label} by amount`}
                  aria-pressed={splitOpen === i.key}
                  title="Split by a custom amount"
                  style={{
                    flex: "none",
                    width: 30,
                    height: 30,
                    marginLeft: 4,
                    alignSelf: "center",
                    border: 0,
                    borderRadius: 8,
                    background: splitOpen === i.key ? `${C.me}1f` : "transparent",
                    font: `500 16px/1 ${ARCHIVO}`,
                    color: i.excluded ? MUTED_4 : i.custom !== null ? C.me : MUTED_3,
                    cursor: i.excluded ? "default" : "pointer",
                  }}
                >
                  ÷
                </button>
                <button
                  onClick={() => toggleItem(i.key)}
                  aria-label={i.excluded ? `Put ${i.label} back` : `Cross out ${i.label}`}
                  title={i.excluded ? `Put ${i.label} back` : `Cross out ${i.label}`}
                  style={{
                    // Same box in both states: a wider "Undo" would squeeze
                    // the dotted leader and slide every amount sideways as
                    // rows are crossed out.
                    flex: "none",
                    width: 30,
                    height: 30,
                    marginLeft: 4,
                    alignSelf: "center",
                    border: 0,
                    borderRadius: 8,
                    background: "transparent",
                    font: i.excluded ? `500 17px/1 ${ARCHIVO}` : `500 14px/1 ${ARCHIVO}`,
                    color: i.excluded ? C.me : MUTED_3,
                    cursor: "pointer",
                  }}
                >
                  {i.excluded ? "↺" : "✕"}
                </button>
              </div>
            </div>
            {splitOpen === i.key && !i.excluded && i.custom !== null && (
              <div
                style={{
                  padding: "10px 14px 12px 24px",
                  borderBottom: "1px solid rgba(0,0,0,.07)",
                  background: `${C.me}0d`,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px 10px",
                }}
              >
                <span style={{ ...capsLabel, flex: "none", marginRight: 2 }}>Your share</span>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
                  <input
                    value={splitText?.field === "pct" ? splitText.text : String(centsToPercent(i.custom, i.price_cents))}
                    inputMode="numeric"
                    aria-label={`Your percent of ${i.label}`}
                    onFocus={(e) => {
                      setSplitText({ field: "pct", text: String(centsToPercent(i.custom ?? 0, i.price_cents)) });
                      e.target.select();
                    }}
                    onChange={(e) => {
                      const text = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                      setSplitText({ field: "pct", text });
                      const pct = text === "" ? null : parseInt(text, 10);
                      if (pct !== null && pct >= 0 && pct <= 100) setCustom(i.key, percentShare(i.price_cents, pct));
                    }}
                    onBlur={() => setSplitText(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    style={{
                      width: 40,
                      border: 0,
                      borderBottom: "1px dashed rgba(0,0,0,.28)",
                      background: "transparent",
                      padding: "0 0 2px",
                      font: `500 15px ${MONO}`,
                      fontVariantNumeric: "tabular-nums",
                      textAlign: "right",
                    }}
                  />
                  <span style={{ font: `500 13px ${MONO}`, color: MUTED_2 }}>%</span>
                </span>
                <span style={{ font: `500 13px ${MONO}`, color: MUTED_3 }}>or</span>
                <input
                  value={splitText?.field === "amt" ? splitText.text : moneyAbs(i.custom)}
                  inputMode="decimal"
                  aria-label={`Your dollars of ${i.label}`}
                  onFocus={(e) => {
                    setSplitText({ field: "amt", text: moneyAbs(i.custom ?? 0) });
                    e.target.select();
                  }}
                  onChange={(e) => {
                    const text = e.target.value;
                    setSplitText({ field: "amt", text });
                    const cents = parseDollarsToCents(text);
                    if (cents !== null && cents <= i.price_cents) setCustom(i.key, cents);
                  }}
                  onBlur={() => setSplitText(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  style={{
                    width: 68,
                    border: 0,
                    borderBottom: "1px dashed rgba(0,0,0,.28)",
                    background: "transparent",
                    padding: "0 0 2px",
                    font: `500 15px ${MONO}`,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                />
                <span style={{ flex: 1, minWidth: 90, font: `500 12px ${MONO}`, color: C.fr }}>
                  {F} {moneyAbs(i.price_cents - i.custom)}
                </span>
                <button
                  onClick={() => toggleSplit(i.key)}
                  style={{
                    flex: "none",
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: 0,
                    cursor: "pointer",
                    font: `600 13px ${ARCHIVO}`,
                    background: C.me,
                    color: "#fff",
                  }}
                >
                  Done
                </button>
              </div>
            )}
            </div>
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
          <br />
          <br />
          If the scan got a line wrong, type over its amount, or cross it out
          with ✕ to leave it off the split — the total follows the items,
          keeping tax and tip where they are, and ↺ on the crossed-out row brings
          it back. Type over the total instead to pin it to what the
          paper says.
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
