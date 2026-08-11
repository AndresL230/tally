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
