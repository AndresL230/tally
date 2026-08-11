import type { Hono } from "hono";
import type { AppContext } from "./env";
import type { ApiEntry } from "../shared/types";
import { ledgerDetail, ledgerForMember, type LedgerRow } from "./db";
import {
  ValidationError,
  assertDate,
  assertId,
  assertInt,
  assertString,
  optionalNote,
  readJson,
} from "./validate";

/** The just-written (or pre-existing) entry, with fresh running balance. */
async function entryResponse(
  db: D1Database,
  ledger: LedgerRow,
  viewer: string,
  entryId: string,
): Promise<ApiEntry> {
  const detail = await ledgerDetail(db, ledger, viewer);
  const entry = detail.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error(`entry ${entryId} missing after write`);
  return entry;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return err instanceof Error && err.message.includes(constraint);
}

export function registerMutations(app: Hono<AppContext>): void {
  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  app.post("/api/ledgers/:id/expenses", async (c) => {
    const email = c.get("email");
    const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
    if (!ledger) return c.json({ error: "not found" }, 404);

    const body = await readJson(c.req.raw);
    const id = assertId(body.id, "id");
    const occurredOn = assertDate(body.occurred_on, "occurred_on");
    const merchant = assertString(body.merchant, "merchant", { trim: true, max: 200 });
    const totalCents = assertInt(body.total_cents, "total_cents", { min: 0 });
    const payer = assertString(body.payer, "payer").toLowerCase();
    if (payer !== ledger.person_a && payer !== ledger.person_b) {
      throw new ValidationError("payer must be a ledger member");
    }
    const method = body.method;
    if (method !== "percent" && method !== "manual") {
      // 'items' expenses are created through the receipt confirm flow (M2).
      throw new ValidationError("method must be 'percent' or 'manual'");
    }
    const otherShare = assertInt(body.other_share_cents, "other_share_cents", {
      min: 0,
      max: totalCents,
    });
    const note = optionalNote(body.note);

    const result = await c.env.DB.prepare(
      `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
         other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?11, NULL)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(id, ledger.id, occurredOn, merchant, totalCents, payer, otherShare, method, note, email, Date.now())
      .run();

    if (result.meta.changes === 0) {
      // Idempotent repeat. Only echo the entry if it lives in this ledger —
      // an id collision across ledgers must not leak the other row.
      const existing = await c.env.DB.prepare(
        "SELECT ledger_id FROM expenses WHERE id = ?1",
      )
        .bind(id)
        .first<{ ledger_id: string }>();
      if (existing?.ledger_id !== ledger.id) {
        return c.json({ error: "id already used" }, 409);
      }
      return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 200);
    }
    return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 201);
  });

  app.post("/api/ledgers/:id/settlements", async (c) => {
    const email = c.get("email");
    const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
    if (!ledger) return c.json({ error: "not found" }, 404);

    const body = await readJson(c.req.raw);
    const id = assertId(body.id, "id");
    const occurredOn = assertDate(body.occurred_on, "occurred_on");
    const from = assertString(body.from_email, "from_email").toLowerCase();
    const to = assertString(body.to_email, "to_email").toLowerCase();
    const members = [ledger.person_a, ledger.person_b];
    if (!members.includes(from) || !members.includes(to) || from === to) {
      throw new ValidationError("from_email and to_email must be the two ledger members");
    }
    const amount = assertInt(body.amount_cents, "amount_cents", { min: 1 });

    const result = await c.env.DB.prepare(
      `INSERT INTO settlements (id, ledger_id, occurred_on, from_email, to_email, amount_cents, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(id, ledger.id, occurredOn, from, to, amount, Date.now())
      .run();

    if (result.meta.changes === 0) {
      const existing = await c.env.DB.prepare(
        "SELECT ledger_id FROM settlements WHERE id = ?1",
      )
        .bind(id)
        .first<{ ledger_id: string }>();
      if (existing?.ledger_id !== ledger.id) {
        return c.json({ error: "id already used" }, 409);
      }
      return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 200);
    }
    return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 201);
  });

  app.post("/api/ledgers/:id/expenses/:expenseId/void", async (c) => {
    const email = c.get("email");
    const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
    if (!ledger) return c.json({ error: "not found" }, 404);

    const body = await readJson(c.req.raw);
    const id = assertId(body.id, "id");
    const occurredOn = assertDate(body.occurred_on, "occurred_on");

    const originalId = c.req.param("expenseId");
    const original = await c.env.DB.prepare(
      "SELECT * FROM expenses WHERE id = ?1 AND ledger_id = ?2",
    )
      .bind(originalId, ledger.id)
      .first<{
        id: string;
        merchant: string;
        total_cents: number;
        payer: string;
        other_share_cents: number;
        method: string;
        reverses_id: string | null;
      }>();
    if (!original) return c.json({ error: "not found" }, 404);
    if (original.reverses_id) {
      return c.json({ error: "cannot void a void" }, 409);
    }

    try {
      const result = await c.env.DB.prepare(
        `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
           other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'Void', NULL, NULL, ?9, ?10, ?11)
         ON CONFLICT(id) DO NOTHING`,
      )
        .bind(
          id,
          ledger.id,
          occurredOn,
          original.merchant,
          original.total_cents,
          original.payer,
          -original.other_share_cents,
          original.method,
          email,
          Date.now(),
          original.id,
        )
        .run();

      if (result.meta.changes === 0) {
        const existing = await c.env.DB.prepare(
          "SELECT ledger_id, reverses_id FROM expenses WHERE id = ?1",
        )
          .bind(id)
          .first<{ ledger_id: string; reverses_id: string | null }>();
        if (existing?.ledger_id === ledger.id && existing.reverses_id === original.id) {
          // Idempotent repeat of the same void.
          return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 200);
        }
        return c.json({ error: "id already used" }, 409);
      }
    } catch (err) {
      if (isUniqueViolation(err, "expenses.reverses_id")) {
        return c.json({ error: "already voided" }, 409);
      }
      throw err;
    }
    return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 201);
  });
}
