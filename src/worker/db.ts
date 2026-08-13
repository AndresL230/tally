import type {
  ApiEntry,
  ApiItem,
  LedgerDetail,
  LedgerSummary,
} from "../shared/types";

export interface LedgerRow {
  id: string;
  person_a: string;
  person_b: string;
  created_at: number;
}

/** The ledger, only if `email` is a member. Non-members see a plain 404 —
 *  membership is checked here on every ledger-scoped route. */
export async function ledgerForMember(
  db: D1Database,
  ledgerId: string,
  email: string,
): Promise<LedgerRow | null> {
  return await db
    .prepare(
      "SELECT id, person_a, person_b, created_at FROM ledgers WHERE id = ?1 AND (person_a = ?2 OR person_b = ?2)",
    )
    .bind(ledgerId, email)
    .first<LedgerRow>();
}

export async function listLedgers(
  db: D1Database,
  email: string,
): Promise<LedgerSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.person_a, l.person_b,
              CASE WHEN l.person_a = ?1 THEN l.person_b ELSE l.person_a END AS friend_email,
              u.display_name AS friend_name,
              COALESCE((SELECT SUM(v.delta_cents) FROM ledger_entries v WHERE v.ledger_id = l.id), 0) AS balance_cents,
              (SELECT COUNT(*) FROM ledger_entries v WHERE v.ledger_id = l.id) AS entry_count,
              (SELECT MAX(v.occurred_on) FROM ledger_entries v WHERE v.ledger_id = l.id) AS last_entry_on
       FROM ledgers l
       LEFT JOIN users u ON u.email = CASE WHEN l.person_a = ?1 THEN l.person_b ELSE l.person_a END
       WHERE l.person_a = ?1 OR l.person_b = ?1
       ORDER BY l.created_at`,
    )
    .bind(email)
    .all<LedgerSummary>();
  return results;
}

interface ViewRow {
  id: string;
  occurred_on: string;
  created_at: number;
  label: string;
  delta_cents: number;
  running_cents: number;
}

interface ExpenseRow {
  id: string;
  occurred_on: string;
  merchant: string;
  total_cents: number;
  payer: string;
  other_share_cents: number;
  method: "items" | "percent" | "manual";
  note: string | null;
  receipt_id: string | null;
  extra_cents: number | null;
  created_by: string;
  created_at: number;
  reverses_id: string | null;
  reversed_by: string | null;
  amended_at: number | null;
  amended_by: string | null;
}

interface SettlementRow {
  id: string;
  from_email: string | null;
  to_email: string | null;
  amount_cents: number;
}

interface ItemRow extends ApiItem {
  receipt_id: string;
}

export async function ledgerDetail(
  db: D1Database,
  ledger: LedgerRow,
  viewer: string,
): Promise<LedgerDetail> {
  const [view, expenses, settlements, items, members] = await Promise.all([
    db
      .prepare(
        `SELECT id, occurred_on, created_at, label, delta_cents,
                SUM(delta_cents) OVER (ORDER BY occurred_on, created_at, id) AS running_cents
         FROM ledger_entries WHERE ledger_id = ?1
         ORDER BY occurred_on, created_at, id`,
      )
      .bind(ledger.id)
      .all<ViewRow>(),
    db
      .prepare(
        `SELECT e.*, (SELECT r.id FROM expenses r WHERE r.reverses_id = e.id) AS reversed_by
         FROM expenses e WHERE e.ledger_id = ?1`,
      )
      .bind(ledger.id)
      .all<ExpenseRow>(),
    db
      .prepare(
        "SELECT id, from_email, to_email, amount_cents FROM settlements WHERE ledger_id = ?1",
      )
      .bind(ledger.id)
      .all<SettlementRow>(),
    db
      .prepare(
        `SELECT ri.id, ri.receipt_id, ri.label, ri.qty, ri.price_cents, ri.assigned_to
         FROM receipt_items ri
         WHERE ri.receipt_id IN (SELECT e.receipt_id FROM expenses e WHERE e.ledger_id = ?1 AND e.receipt_id IS NOT NULL)
         ORDER BY ri.rowid`,
      )
      .bind(ledger.id)
      .all<ItemRow>(),
    db
      .prepare(
        "SELECT email, display_name, accent_color FROM users WHERE email IN (?1, ?2)",
      )
      .bind(ledger.person_a, ledger.person_b)
      .all<{ email: string; display_name: string | null; accent_color: string | null }>(),
  ]);

  const expenseById = new Map(expenses.results.map((e) => [e.id, e]));
  const settlementById = new Map(settlements.results.map((s) => [s.id, s]));
  const itemsByReceipt = new Map<string, ApiItem[]>();
  for (const row of items.results) {
    const { receipt_id, ...item } = row;
    let list = itemsByReceipt.get(receipt_id);
    if (!list) itemsByReceipt.set(receipt_id, (list = []));
    list.push(item);
  }

  const entries: ApiEntry[] = view.results.map((v) => {
    const base = {
      id: v.id,
      occurred_on: v.occurred_on,
      created_at: v.created_at,
      delta_cents: v.delta_cents,
      running_cents: v.running_cents,
    };
    const e = expenseById.get(v.id);
    if (e) {
      return {
        ...base,
        kind: "expense",
        expense: {
          merchant: e.merchant,
          total_cents: e.total_cents,
          payer: e.payer,
          other_share_cents: e.other_share_cents,
          method: e.method,
          note: e.note,
          receipt_id: e.receipt_id,
          extra_cents: e.extra_cents,
          created_by: e.created_by,
          reverses_id: e.reverses_id,
          reversed_by: e.reversed_by,
          amended_at: e.amended_at,
          amended_by: e.amended_by,
          items: e.receipt_id ? (itemsByReceipt.get(e.receipt_id) ?? null) : null,
        },
      };
    }
    const s = settlementById.get(v.id);
    if (!s) throw new Error(`view row ${v.id} matches no expense or settlement`);
    return {
      ...base,
      kind: "settlement",
      settlement: {
        from_email: s.from_email,
        to_email: s.to_email,
        amount_cents: s.amount_cents,
      },
    };
  });

  const memberMap: LedgerDetail["members"] = {
    [ledger.person_a]: { display_name: null, accent_color: null },
    [ledger.person_b]: { display_name: null, accent_color: null },
  };
  for (const m of members.results) {
    memberMap[m.email] = {
      display_name: m.display_name,
      accent_color: m.accent_color,
    };
  }

  return {
    ledger: { id: ledger.id, person_a: ledger.person_a, person_b: ledger.person_b },
    viewer,
    members: memberMap,
    entries,
  };
}
