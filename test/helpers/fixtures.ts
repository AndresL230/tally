import { env } from "cloudflare:test";

export const ALEX = "alex@example.com";
export const JORDAN = "jordan@example.com";
export const SAM = "sam@example.com";
export const OUTSIDER = "mallory@example.com";

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${seq}-${crypto.randomUUID()}`;
}

export async function insertLedger(a: string, b: string, id = uid("ledger")): Promise<string> {
  const [pa, pb] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO ledgers (id, person_a, person_b, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(id, pa, pb, Date.now())
    .run();
  return id;
}

export interface ExpenseFixture {
  id?: string;
  ledger_id: string;
  occurred_on: string;
  merchant?: string;
  total_cents: number;
  payer: string;
  other_share_cents: number;
  method?: "items" | "percent" | "manual";
  note?: string | null;
  receipt_id?: string | null;
  extra_cents?: number | null;
  created_by?: string;
  created_at?: number;
  reverses_id?: string | null;
}

export async function insertExpense(f: ExpenseFixture): Promise<string> {
  const id = f.id ?? uid("exp");
  await env.DB.prepare(
    `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
       other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(
      id,
      f.ledger_id,
      f.occurred_on,
      f.merchant ?? "Test Merchant",
      f.total_cents,
      f.payer,
      f.other_share_cents,
      f.method ?? "manual",
      f.note ?? null,
      f.receipt_id ?? null,
      f.extra_cents ?? null,
      f.created_by ?? f.payer,
      f.created_at ?? Date.now(),
      f.reverses_id ?? null,
    )
    .run();
  return id;
}

export interface SettlementFixture {
  id?: string;
  ledger_id: string;
  occurred_on: string;
  from_email: string;
  to_email: string;
  amount_cents: number;
  created_at?: number;
}

export async function insertSettlement(f: SettlementFixture): Promise<string> {
  const id = f.id ?? uid("set");
  await env.DB.prepare(
    `INSERT INTO settlements (id, ledger_id, occurred_on, from_email, to_email, amount_cents, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, f.ledger_id, f.occurred_on, f.from_email, f.to_email, f.amount_cents, f.created_at ?? Date.now())
    .run();
  return id;
}

export interface CodeFixture {
  created_at?: number;
  expires_at?: number;
  attempts?: number;
  consumed_at?: number | null;
}

/** Insert an auth_codes row for a KNOWN code (hashed the way the worker does). */
export async function insertCode(email: string, code: string, f: CodeFixture = {}): Promise<string> {
  const id = uid("code");
  const created = f.created_at ?? Date.now();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}:${code}`));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    `INSERT INTO auth_codes (id, email, code_hash, created_at, expires_at, attempts, consumed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, email, hash, created, f.expires_at ?? created + 10 * 60 * 1000, f.attempts ?? 0, f.consumed_at ?? null)
    .run();
  return id;
}

export interface ReceiptFixture {
  ledger_id: string;
  uploaded_by: string;
  created_at?: number;
  sha256?: string;
  status?: string;
}

/** A bare receipt row (no image, no items) — enough for counting. */
export async function insertReceipt(f: ReceiptFixture): Promise<string> {
  const id = uid("rcpt");
  await env.DB.prepare(
    `INSERT INTO receipts (id, ledger_id, r2_key, sha256, status, uploaded_by, created_at)
     VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, f.ledger_id, f.sha256 ?? uid("sha"), f.status ?? "posted", f.uploaded_by, f.created_at ?? Date.now())
    .run();
  return id;
}
