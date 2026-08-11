import type { LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";

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
};
