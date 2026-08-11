import type { ApiEntry, LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";

// Mutation bodies per the M1 contract. `id` is the client-generated UUID
// idempotency key: one per user intent, reused verbatim on retries.

export interface PostExpenseBody {
  id: string;
  occurred_on: string; // 'YYYY-MM-DD'
  merchant: string;
  total_cents: number;
  payer: string;
  method: "percent" | "manual"; // 'items' arrives in M2
  other_share_cents: number;
  note?: string | null;
}

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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
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

export const api = {
  me: () => request<UserPrefs>("/api/me"),
  ledgers: () => request<{ ledgers: LedgerSummary[] }>("/api/ledgers"),
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
};
