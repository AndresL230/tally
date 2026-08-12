import type { ApiEntry, ApiItem, ApiReceipt, LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";

// Mutation bodies per the M1/M2 contracts. `id` is the client-generated UUID
// idempotency key: one per user intent, reused verbatim on retries.

/** One posted line item, CANONICAL assignment (email or 'half'; st codes
 *  never cross the wire — decision D). */
export interface PostExpenseItem {
  label: string;
  qty?: string | null;
  price_cents: number;
  assigned_to: string;
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
  ) {
    super(message);
  }
}

/** Navigate to /login (Access hosts the PIN there and bounces back into the
 *  app) — but never in a loop: at most once per 15s, else surface the error. */
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
  // redirect: "manual" — no legitimate /api route ever redirects, so ANY
  // redirect is Cloudflare Access bouncing an expired session to its
  // (cross-origin) login page. Following it would make the browser kill
  // the response as a CORS failure before we could observe anything;
  // manual mode surfaces it deterministically as an opaqueredirect.
  const res = await fetch(path, {
    ...init,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (
    res.type === "opaqueredirect" ||
    (res.ok && !contentType.includes("application/json"))
  ) {
    // Expired Access session (or an HTML interloper): reload the document
    // and let Access host login — vital in standalone/PWA mode where
    // nothing else would ever re-trigger it.
    reloadForLogin();
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep statusText
    }
    throw new ApiError(res.status, message);
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
};
