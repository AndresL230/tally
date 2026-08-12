// DEV-ONLY fixtures for the state gallery (reconciled decision E). This
// module is only ever reached through main.tsx's `import.meta.env.DEV`
// dynamic import, so production builds drop it entirely.
//
// All money is INTEGER CENTS. Every item entry's other_share / extra /
// delta comes out of the SHARED helpers (splitItems / percentShare), so the
// fixtures satisfy shares-sum-to-total by construction — nothing here is a
// hand-waved number. The data mirrors the mockup's Jordan demo (and the
// seed script), viewed as alex@example.com with the canonical two-person
// shape person_a = alex, person_b = jordan.

import { percentShare, splitItems } from "../../shared/money";
import type { ApiEntry, ApiItem, ApiReceipt, LedgerDetail, LedgerSummary } from "../../shared/types";

export const VIEWER = "alex@example.com"; // person_a (lexicographically smaller)
export const FRIEND = "jordan@example.com"; // person_b

const MEMBERS: LedgerDetail["members"] = {
  [VIEWER]: { display_name: "Alex", accent_color: "#0a8a9b" },
  [FRIEND]: { display_name: "Jordan", accent_color: "#1b6ef3" },
};

const PCT_NOTE = "Halved by percentage — no line items on the photo.";
const HAND_NOTE = "Entered by hand.";

// ---------------------------------------------------------------------------
// Entry builders. Protos carry everything but running_cents; detail() folds
// the running balance exactly the way the SQL window function would.
// ---------------------------------------------------------------------------

type Proto = Omit<ApiEntry, "running_cents">;

interface FixtureItem {
  label: string;
  qty?: string;
  price_cents: number;
  /** Canonical: VIEWER | FRIEND | 'half' (decision D). */
  assigned_to: string;
}

let createdAt = 1000;
let itemSeq = 0;

function apiItems(items: FixtureItem[]): ApiItem[] {
  return items.map((i) => ({
    id: `fx-item-${++itemSeq}`,
    label: i.label,
    qty: i.qty ?? null,
    price_cents: i.price_cents,
    assigned_to: i.assigned_to,
  }));
}

/** Itemized receipt expense: shares come from the shared splitItems. */
function itemsExpense(
  id: string,
  occurredOn: string,
  merchant: string,
  totalCents: number,
  payer: string,
  items: FixtureItem[],
  flags?: { reversed_by?: string },
): Proto {
  const other = payer === VIEWER ? FRIEND : VIEWER;
  const split = splitItems(
    items.map((i) => ({ price_cents: i.price_cents, assigned_to: i.assigned_to })),
    payer,
    other,
    totalCents,
  );
  // Canonical delta: positive = person_b owes person_a more. Viewer is
  // person_a, so alex paying makes the delta +other_share.
  const delta = payer === VIEWER ? split.other_share_cents : -split.other_share_cents;
  return {
    id,
    kind: "expense",
    occurred_on: occurredOn,
    created_at: ++createdAt,
    delta_cents: delta,
    expense: {
      merchant,
      total_cents: totalCents,
      payer,
      other_share_cents: split.other_share_cents,
      method: "items",
      note: null,
      receipt_id: `rcpt-${id}`,
      extra_cents: split.extra_cents,
      created_by: payer,
      reverses_id: null,
      reversed_by: flags?.reversed_by ?? null,
      items: apiItems(items),
    },
  };
}

/** Percent/manual expense split at pctOther percent via percentShare. */
function flatExpense(
  id: string,
  occurredOn: string,
  merchant: string,
  totalCents: number,
  payer: string,
  method: "percent" | "manual",
  note: string,
  pctOther = 50,
): Proto {
  const otherShare = percentShare(totalCents, pctOther);
  const delta = payer === VIEWER ? otherShare : -otherShare;
  return {
    id,
    kind: "expense",
    occurred_on: occurredOn,
    created_at: ++createdAt,
    delta_cents: delta,
    expense: {
      merchant,
      total_cents: totalCents,
      payer,
      other_share_cents: otherShare,
      method,
      note,
      receipt_id: null,
      extra_cents: null,
      created_by: payer,
      reverses_id: null,
      reversed_by: null,
      items: null,
    },
  };
}

function settlementEntry(id: string, occurredOn: string, from: string, to: string, amountCents: number): Proto {
  return {
    id,
    kind: "settlement",
    occurred_on: occurredOn,
    created_at: ++createdAt,
    // person_b paying person_a shrinks what person_b owes.
    delta_cents: from === FRIEND ? -amountCents : amountCents,
    settlement: { from_email: from, to_email: to, amount_cents: amountCents },
  };
}

/** The append-only void: a reversing entry whose delta exactly negates the
 *  original's, so the pair nets to zero on the running balance. */
function reversalOf(id: string, occurredOn: string, original: Proto): Proto {
  const ex = original.expense;
  if (!ex) throw new Error("can only reverse an expense proto");
  return {
    id,
    kind: "expense",
    occurred_on: occurredOn,
    created_at: ++createdAt,
    delta_cents: -original.delta_cents,
    // Mirrors the mutations.ts reversal insert exactly: note 'Void',
    // NEGATED other_share, no receipt link, voider as created_by.
    expense: {
      ...ex,
      note: "Void",
      other_share_cents: -ex.other_share_cents,
      receipt_id: null,
      extra_cents: null,
      items: null,
      reverses_id: original.id,
      reversed_by: null,
    },
  };
}

function detail(ledgerId: string, protos: Proto[]): LedgerDetail {
  let run = 0;
  return {
    ledger: { id: ledgerId, person_a: VIEWER, person_b: FRIEND },
    viewer: VIEWER,
    members: MEMBERS,
    entries: protos.map((p) => ({ ...p, running_cents: (run += p.delta_cents) })),
  };
}

function balanceOf(protos: Proto[]): number {
  return protos.reduce((a, p) => a + p.delta_cents, 0);
}

// ---------------------------------------------------------------------------
// Item lists (the mockup demo's receipts, in cents; assignments are the
// mockup's st codes translated to canonical emails from alex's seat).
// ---------------------------------------------------------------------------

const LARDO_ITEMS: FixtureItem[] = [
  { label: "Muffuletta", price_cents: 1600, assigned_to: VIEWER },
  { label: "Pork belly banh mi", price_cents: 1550, assigned_to: FRIEND },
  { label: "Fries", price_cents: 550, assigned_to: "half" },
  { label: "Lemonade", qty: "×2", price_cents: 590, assigned_to: "half" },
];

const SAFEWAY_ITEMS: FixtureItem[] = [
  { label: "Chicken thighs", price_cents: 1420, assigned_to: FRIEND },
  { label: "Cold brew", price_cents: 1199, assigned_to: FRIEND },
  { label: "Eggs", qty: "×2", price_cents: 998, assigned_to: "half" },
  { label: "Olive oil", price_cents: 1849, assigned_to: "half" },
  { label: "Rice, 5lb", price_cents: 1275, assigned_to: FRIEND },
  { label: "Yogurt", price_cents: 649, assigned_to: VIEWER },
  { label: "Frozen dumplings", qty: "×2", price_cents: 1298, assigned_to: FRIEND },
  { label: "Sparkling water", price_cents: 662, assigned_to: "half" },
];

const KACHKA_ITEMS: FixtureItem[] = [
  { label: "Herring under fur coat", price_cents: 1400, assigned_to: FRIEND },
  { label: "Pelmeni", price_cents: 1900, assigned_to: "half" },
  { label: "Chicken Kiev", price_cents: 3200, assigned_to: FRIEND },
  { label: "Beet salad", price_cents: 1200, assigned_to: VIEWER },
  { label: "Horseradish vodka", qty: "×4", price_cents: 2400, assigned_to: "half" },
];

const FRED_MEYER_ITEMS: FixtureItem[] = [
  { label: "Paper towels", price_cents: 1299, assigned_to: "half" },
  { label: "Dish soap", price_cents: 549, assigned_to: "half" },
  { label: "Trash bags", price_cents: 1027, assigned_to: FRIEND },
];

// ---------------------------------------------------------------------------
// Ledger variants
// ---------------------------------------------------------------------------

/** The mockup's demo history: seven receipts + one settle-up, Jordan ends
 *  owing Alex (positive viewer balance). */
const JORDAN_PROTOS: Proto[] = [
  flatExpense("exp-tj", "2026-06-28", "Trader Joe's", 8240, VIEWER, "percent", PCT_NOTE),
  settlementEntry("set-1", "2026-07-02", FRIEND, VIEWER, 4120),
  itemsExpense("exp-lardo", "2026-07-06", "Lardo", 4680, FRIEND, LARDO_ITEMS),
  itemsExpense("exp-safeway", "2026-07-11", "Safeway", 9635, VIEWER, SAFEWAY_ITEMS),
  flatExpense("exp-pokpok", "2026-07-18", "Pok Pok", 4980, VIEWER, "percent", PCT_NOTE),
  flatExpense("exp-ns", "2026-07-24", "New Seasons", 3680, FRIEND, "manual", HAND_NOTE),
  itemsExpense("exp-kachka", "2026-08-01", "Kachka", 11840, VIEWER, KACHKA_ITEMS),
  itemsExpense("exp-fm", "2026-08-06", "Fred Meyer", 2875, VIEWER, FRED_MEYER_ITEMS),
];

export const jordanDetail = detail("led-jordan", JORDAN_PROTOS);
/** Viewer-relative == canonical here (viewer is person_a). */
export const jordanBalanceCents = balanceOf(JORDAN_PROTOS);

/** Jordan paid for more lately: the viewer owes (negative balance). */
const OWE_PROTOS: Proto[] = [
  itemsExpense("owe-lardo", "2026-07-06", "Lardo", 4680, FRIEND, LARDO_ITEMS),
  flatExpense("owe-pokpok", "2026-07-18", "Pok Pok", 4980, VIEWER, "percent", PCT_NOTE),
  flatExpense("owe-ns", "2026-07-24", "New Seasons", 3680, FRIEND, "manual", HAND_NOTE),
  flatExpense("owe-tusk", "2026-08-03", "Tusk", 7360, FRIEND, "percent", PCT_NOTE),
];

export const oweDetail = detail("led-jordan-owe", OWE_PROTOS);

/** Settled: the demo history plus a settle-up of the exact balance, so the
 *  running balance ends at zero ("Square since Aug 11"). */
const SETTLED_PROTOS: Proto[] = (() => {
  const bal = balanceOf(JORDAN_PROTOS);
  const settle =
    bal >= 0
      ? settlementEntry("set-final", "2026-08-11", FRIEND, VIEWER, bal)
      : settlementEntry("set-final", "2026-08-11", VIEWER, FRIEND, -bal);
  return [...JORDAN_PROTOS.map((p) => ({ ...p })), settle];
})();

export const settledDetail = detail("led-jordan-settled", SETTLED_PROTOS);

/** Brand-new ledger: nothing on it yet. */
export const emptyDetail = detail("led-jordan-empty", []);

/** Voided pair: the Fred Meyer run got entered twice; the duplicate is
 *  reversed by an append-only reversing entry (rule 2). */
const VOID_ORIGINAL = itemsExpense("void-fm", "2026-08-06", "Fred Meyer", 2875, VIEWER, FRED_MEYER_ITEMS, {
  reversed_by: "void-fm-rev",
});
const VOID_PROTOS: Proto[] = [
  flatExpense("void-tj", "2026-06-28", "Trader Joe's", 8240, VIEWER, "percent", PCT_NOTE),
  itemsExpense("void-kachka", "2026-08-01", "Kachka", 11840, VIEWER, KACHKA_ITEMS),
  VOID_ORIGINAL,
  reversalOf("void-fm-rev", "2026-08-09", VOID_ORIGINAL),
];

export const voidedDetail = detail("led-jordan-voided", VOID_PROTOS);

// ---------------------------------------------------------------------------
// Picker summaries (canonical balance_cents; person_a is always the
// lexicographically smaller email)
// ---------------------------------------------------------------------------

export const pickerLedgers: LedgerSummary[] = [
  {
    id: "led-jordan",
    person_a: VIEWER,
    person_b: FRIEND,
    friend_email: FRIEND,
    friend_name: "Jordan",
    balance_cents: jordanBalanceCents,
    entry_count: JORDAN_PROTOS.length,
    last_entry_on: "2026-08-06",
  },
  {
    id: "led-sam",
    person_a: VIEWER,
    person_b: "sam@example.com",
    friend_email: "sam@example.com",
    friend_name: "Sam",
    // Elephants Deli +1500 (alex paid), Market of Choice −2700 (sam paid).
    balance_cents: percentShare(3000, 50) - percentShare(5400, 50),
    entry_count: 2,
    last_entry_on: "2026-06-14",
  },
  {
    id: "led-priya",
    person_a: VIEWER,
    person_b: "priya@example.com",
    friend_email: "priya@example.com",
    friend_name: null,
    balance_cents: 0,
    entry_count: 0,
    last_entry_on: null,
  },
];

// ---------------------------------------------------------------------------
// Receipts for the confirm / percent flows
// ---------------------------------------------------------------------------

/** The Nong's Khao Man Gai 6-item demo. Items subtotal 5925; printed total
 *  7550, so the extra (tax + tip) line reads $16.25. */
const NONGS_ITEMS: { label: string; qty: string | null; price_cents: number }[] = [
  { label: "Khao man gai", qty: "×2", price_cents: 2500 },
  { label: "Fried chicken thigh", qty: null, price_cents: 650 },
  { label: "Papaya salad", qty: null, price_cents: 875 },
  { label: "Thai iced tea", qty: "×2", price_cents: 900 },
  { label: "Sticky rice", qty: null, price_cents: 425 },
  { label: "Fresh spring rolls", qty: null, price_cents: 575 },
];

function nongsApiItems(assigned: (string | null)[]): ApiItem[] {
  return NONGS_ITEMS.map((i, n) => ({
    id: `nongs-${n + 1}-${assigned[n] ?? "unassigned"}`,
    label: i.label,
    qty: i.qty,
    price_cents: i.price_cents,
    assigned_to: assigned[n] ?? null,
  }));
}

export const nongsReceipt: ApiReceipt = {
  id: "rcpt-nongs",
  ledger_id: "led-jordan",
  status: "needs_review",
  merchant: "Nong's Khao Man Gai",
  purchased_on: "2026-08-11",
  total_cents: 7550,
  uploaded_by: VIEWER,
  created_at: 2000,
};

/** Hero state: mixed assignments — half / Jordan's / mine all visible. */
export const nongsItemsMixed: ApiItem[] = nongsApiItems([
  "half", // Khao man gai ×2 — one each
  FRIEND, // Fried chicken thigh
  VIEWER, // Papaya salad
  "half", // Thai iced tea ×2
  FRIEND, // Sticky rice
  FRIEND, // Fresh spring rolls
]);

/** Fresh-from-extraction state: nothing assigned yet (all default to the
 *  other person's) — the beat-confirm precondition. */
export const nongsItemsUntouched: ApiItem[] = nongsApiItems([null, null, null, null, null, null]);

/** Negative-extra variant: the user corrected the total DOWN below the item
 *  subtotal (5925), so extra = −$4.25 (a discount, distributed the same way). */
export const nongsReceiptEditedDown: ApiReceipt = {
  ...nongsReceipt,
  id: "rcpt-nongs-editeddown",
  total_cents: 5500,
};

/** Percent fallback: the total came through, the line items didn't. */
export const percentReceipt: ApiReceipt = {
  id: "rcpt-pinestate",
  ledger_id: "led-jordan",
  status: "needs_review",
  merchant: "Pine State Biscuits",
  purchased_on: "2026-08-09",
  total_cents: 3245,
  uploaded_by: VIEWER,
  created_at: 2001,
};

/** Look an entry up by id (gallery detail states). */
export function entryIn(d: LedgerDetail, id: string): ApiEntry {
  const e = d.entries.find((x) => x.id === id);
  if (!e) throw new Error(`fixture entry ${id} missing from ${d.ledger.id}`);
  return e;
}
