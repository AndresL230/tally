// Shared between worker and client. All money is INTEGER CENTS.

export type Method = "items" | "percent" | "manual";
/** Canonical item assignment: a member's email, or the literal 'half'. */
export type AssignedTo = string;

export interface UserPrefs {
  email: string;
  display_name: string | null;
  accent_color: string | null;
}

export interface LedgerSummary {
  id: string;
  person_a: string;
  person_b: string;
  friend_email: string;
  friend_name: string | null;
  /** Canonical (person_a-perspective) balance. */
  balance_cents: number;
  entry_count: number;
  last_entry_on: string | null;
}

export type ReceiptStatus =
  | "uploaded"
  | "extracting"
  | "needs_review"
  | "posted"
  | "failed"
  | "discarded";

export interface ApiReceipt {
  id: string;
  ledger_id: string;
  status: ReceiptStatus;
  merchant: string | null;
  purchased_on: string | null;
  total_cents: number | null;
  uploaded_by: string | null;
  created_at: number | null;
}

export interface ApiItem {
  id: string;
  label: string | null;
  qty: string | null;
  price_cents: number | null;
  assigned_to: AssignedTo | null;
}

export interface ApiExpense {
  merchant: string;
  total_cents: number;
  payer: string;
  other_share_cents: number;
  method: Method;
  note: string | null;
  receipt_id: string | null;
  extra_cents: number | null;
  created_by: string;
  reverses_id: string | null;
  /** Set when another entry reverses this one. */
  reversed_by: string | null;
  items: ApiItem[] | null;
}

export interface ApiSettlement {
  from_email: string | null;
  to_email: string | null;
  amount_cents: number;
}

export interface ApiEntry {
  id: string;
  kind: "expense" | "settlement";
  occurred_on: string;
  created_at: number;
  /** Canonical delta: positive = person_b owes person_a more. */
  delta_cents: number;
  /** Canonical running balance after this entry. */
  running_cents: number;
  expense?: ApiExpense;
  settlement?: ApiSettlement;
}

export interface LedgerDetail {
  ledger: { id: string; person_a: string; person_b: string };
  viewer: string;
  members: Record<string, { display_name: string | null; accent_color: string | null }>;
  /** Ordered by occurred_on, created_at, id (the running-balance order). */
  entries: ApiEntry[];
}
