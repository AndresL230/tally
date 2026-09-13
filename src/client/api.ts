import type {
  AdminState,
  ApiEntry,
  ApiItem,
  ApiReceipt,
  LedgerDetail,
  LedgerSummary,
  SignupMode,
  UserPrefs,
} from "../shared/types";

// Mutation bodies per the M1/M2 contracts. `id` is the client-generated UUID
// idempotency key: one per user intent, reused verbatim on retries.

/** One posted line item, CANONICAL assignment (email or 'half'; st codes
 *  never cross the wire — decision D). */
export interface PostExpenseItem {
  label: string;
  qty?: string | null;
  price_cents: number;
  assigned_to: string;
  /** Custom split: the member in assigned_to pays exactly this many cents. */
  share_cents?: number | null;
}

interface PostExpenseBase {
  id: string;
  occurred_on: string; // 'YYYY-MM-DD'
  merchant: string;
  total_cents: number;
  payer: string;
  note?: string | null;
}

export type PostExpenseBody = PostExpenseBase &
  (
    | {
        method: "items";
        /** Required for 'items': the receipt this confirm screen came from. */
        receipt_id: string;
        items: PostExpenseItem[];
        // other_share_cents intentionally absent: the server recomputes it
        // with splitItems and ignores anything the client might send.
      }
    | {
        method: "percent" | "manual";
        other_share_cents: number;
        /** Optional: percent/manual entries that started from a photo keep
         *  the receipt link (the server marks it posted). */
        receipt_id?: string | null;
      }
  );

export interface PostSettlementBody {
  id: string;
  occurred_on: string;
  from_email: string;
  to_email: string;
  amount_cents: number;
}

export interface VoidExpenseBody {
  /** UUID for the new reversing entry. */
  id: string;
  occurred_on: string;
}

export interface ReceiptResponse {
  receipt: ApiReceipt;
  items: ApiItem[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed error body ({} when there was none) — e.g. tries_left, retry_after. */
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Navigate to /login (the app shell renders the sign-in screen there) —
 *  but never in a loop: at most once per 15s, else surface the error. */
function reloadForLogin(): never {
  const KEY = "tally:last-auth-reload";
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last > 15_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.assign("/login");
  }
  throw new ApiError(401, "session expired");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // keep {}
    }
    const message = typeof body.error === "string" ? body.error : res.statusText;
    // A dead session anywhere but the sign-in screen itself: go sign in.
    // On /login the boot's 401 is the normal case, and the auth endpoints
    // answer 4xx for their own reasons — both are surfaced, not redirected.
    if (res.status === 401 && !path.startsWith("/api/auth/") && window.location.pathname !== "/login") {
      reloadForLogin();
    }
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
}

export interface UpdateMeBody {
  display_name: string;
  /** Must be one of ACCENT_PALETTE (shared/prefs) or null. */
  accent_color: string | null;
}

export interface CreateLedgerBody {
  /** Client-generated UUID (contract rule 4). */
  id: string;
  friend_email: string;
}

export const api = {
  me: () => request<UserPrefs>("/api/me"),
  updateMe: (body: UpdateMeBody) =>
    request<UserPrefs>("/api/me", { method: "PUT", body: JSON.stringify(body) }),
  ledgers: () => request<{ ledgers: LedgerSummary[] }>("/api/ledgers"),
  /** 201 new / 200 existing pair — both return the ledger to land on. */
  createLedger: (body: CreateLedgerBody) =>
    request<{ ledger: LedgerSummary }>("/api/ledgers", { method: "POST", body: JSON.stringify(body) }),
  ledger: (id: string) => request<LedgerDetail>(`/api/ledgers/${id}`),
  postExpense: (ledgerId: string, body: PostExpenseBody) =>
    request<{ entry: ApiEntry }>(`/api/ledgers/${ledgerId}/expenses`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  postSettlement: (ledgerId: string, body: PostSettlementBody) =>
    request<{ entry: ApiEntry }>(`/api/ledgers/${ledgerId}/settlements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Swap who paid, in place. Names the TARGET payer, so a retry can't flip
   *  it twice; the server recomputes the share and stamps the amendment. */
  setPayer: (ledgerId: string, expenseId: string, payer: string) =>
    request<{ entry: ApiEntry }>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/payer`, {
      method: "POST",
      body: JSON.stringify({ payer }),
    }),
  /** Correct when an entry happened, in place. Names the TARGET date, so a
   *  retry can't walk it down the calendar; the server stamps the amendment
   *  and moves the linked receipt's purchase date with it. */
  setDate: (ledgerId: string, expenseId: string, occurredOn: string) =>
    request<{ entry: ApiEntry }>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/date`, {
      method: "POST",
      body: JSON.stringify({ occurred_on: occurredOn }),
    }),
  voidExpense: (ledgerId: string, expenseId: string, body: VoidExpenseBody) =>
    request<{ entry: ApiEntry }>(`/api/ledgers/${ledgerId}/expenses/${expenseId}/void`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Raw image bytes up; the client-minted UUID is the receipt PK. Returns
   *  the (possibly deduped, possibly already-extracted) receipt + items. */
  uploadReceipt: (ledgerId: string, id: string, blob: Blob) =>
    request<ReceiptResponse>(`/api/ledgers/${ledgerId}/receipts?id=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    }),
  extractReceipt: (receiptId: string) =>
    request<ReceiptResponse>(`/api/receipts/${receiptId}/extract`, { method: "POST" }),
  discardReceipt: (receiptId: string) =>
    request<{ receipt: ApiReceipt }>(`/api/receipts/${receiptId}/discard`, { method: "POST" }),

  // ---- Auth ------------------------------------------------------------
  requestCode: (email: string) =>
    request<{ ok: true }>("/api/auth/code", { method: "POST", body: JSON.stringify({ email }) }),
  verifyCode: (email: string, code: string) =>
    request<{ email: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  signOut: () => request<void>("/api/auth/signout", { method: "POST" }),

  // ---- Owner -----------------------------------------------------------
  admin: () => request<AdminState>("/api/admin"),
  setSignupMode: (mode: SignupMode) =>
    request<{ signup_mode: SignupMode }>("/api/admin/signup-mode", { method: "PUT", body: JSON.stringify({ mode }) }),
  invite: (email: string) =>
    request<{ email: string }>("/api/admin/invites", { method: "POST", body: JSON.stringify({ email }) }),
  removeInvite: (email: string) =>
    request<void>(`/api/admin/invites/${encodeURIComponent(email)}`, { method: "DELETE" }),
};
