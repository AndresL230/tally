import type { Hono } from "hono";
import type { AppContext } from "./env";
import type { ApiEntry } from "../shared/types";
import { ledgerDetail, ledgerForMember, type LedgerRow } from "./db";
import { splitItems } from "../shared/money";
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

    // Idempotent repeat first, before receipt-state checks: a successful
    // items POST marks its receipt 'posted', which would otherwise 409 the
    // very retry that idempotency exists for. Cross-ledger collision: 409
    // with nothing echoed (DEVIATIONS D7).
    const preExisting = await c.env.DB.prepare(
      "SELECT ledger_id FROM expenses WHERE id = ?1",
    )
      .bind(id)
      .first<{ ledger_id: string }>();
    if (preExisting) {
      if (preExisting.ledger_id !== ledger.id) {
        return c.json({ error: "id already used" }, 409);
      }
      return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 200);
    }

    const occurredOn = assertDate(body.occurred_on, "occurred_on");
    const merchant = assertString(body.merchant, "merchant", { trim: true, max: 200 });
    const totalCents = assertInt(body.total_cents, "total_cents", { min: 0 });
    const payer = assertString(body.payer, "payer").toLowerCase();
    if (payer !== ledger.person_a && payer !== ledger.person_b) {
      throw new ValidationError("payer must be a ledger member");
    }
    const other = payer === ledger.person_a ? ledger.person_b : ledger.person_a;
    const method = body.method;
    if (method !== "items" && method !== "percent" && method !== "manual") {
      throw new ValidationError("method must be 'items', 'percent' or 'manual'");
    }
    const note = optionalNote(body.note);

    let otherShare: number;
    let extraCents: number | null = null;
    let receiptId: string | null = null;
    let itemRows: { label: string; qty: string | null; price_cents: number; assigned_to: string }[] | null =
      null;

    if (method === "items") {
      receiptId = assertId(body.receipt_id, "receipt_id");
      const rawItems = body.items;
      if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
        throw new ValidationError("items must be a list of 1 to 100 items");
      }
      itemRows = rawItems.map((raw, i) => {
        if (typeof raw !== "object" || raw === null) {
          throw new ValidationError(`items[${i}] must be an object`);
        }
        const it = raw as Record<string, unknown>;
        const label = assertString(it.label, `items[${i}].label`, { trim: true, max: 200 });
        const qty =
          it.qty === undefined || it.qty === null
            ? null
            : assertString(it.qty, `items[${i}].qty`, { min: 0, max: 10 });
        const price = assertInt(it.price_cents, `items[${i}].price_cents`, { min: 0 });
        const assigned = it.assigned_to;
        if (assigned !== ledger.person_a && assigned !== ledger.person_b && assigned !== "half") {
          // Viewer-relative junk ("mine"/"theirs") is a client bug (rule D).
          throw new ValidationError(
            `items[${i}].assigned_to must be a member email or 'half'`,
          );
        }
        return { label, qty, price_cents: price, assigned_to: assigned };
      });
      // The server is the authority on the split; any client-sent
      // other_share_cents/extra_cents is ignored (penny rule 3).
      const split = splitItems(
        itemRows.map((it) => ({ price_cents: it.price_cents, assigned_to: it.assigned_to })),
        payer,
        other,
        totalCents,
      );
      otherShare = split.other_share_cents;
      extraCents = split.extra_cents;
    } else {
      otherShare = assertInt(body.other_share_cents, "other_share_cents", {
        min: 0,
        max: totalCents,
      });
      if (body.receipt_id !== undefined && body.receipt_id !== null) {
        receiptId = assertId(body.receipt_id, "receipt_id");
      }
    }

    if (receiptId) {
      // Friendly pre-check for the common single-caller case; the batch
      // below re-enforces every condition transactionally, so a racing
      // second commit cannot double-post a receipt.
      const receipt = await c.env.DB.prepare(
        "SELECT status FROM receipts WHERE id = ?1 AND ledger_id = ?2",
      )
        .bind(receiptId, ledger.id)
        .first<{ status: string }>();
      if (!receipt) throw new ValidationError("receipt not found in this ledger");
      if (receipt.status === "posted") {
        return c.json({ error: "receipt is already posted" }, 409);
      }
      if (receipt.status === "discarded") {
        return c.json({ error: "receipt is discarded" }, 409);
      }
    }

    // D1 batches run as one transaction. For receipt-linked expenses the
    // insert is gated on the receipt still being available INSIDE that
    // transaction, and every follow-up statement is gated on our insert
    // having landed — so of two concurrent commits for one receipt, exactly
    // one writes; the loser falls through to the conflict handling below.
    const now = Date.now();
    const expenseInsert = receiptId
      ? c.env.DB.prepare(
          `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
             other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL
           WHERE EXISTS (
             SELECT 1 FROM receipts r
             WHERE r.id = ?10 AND r.ledger_id = ?2 AND r.status NOT IN ('posted','discarded')
           )
           AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = ?1)`,
        ).bind(
          id, ledger.id, occurredOn, merchant, totalCents, payer,
          otherShare, method, note, receiptId, extraCents, email, now,
        )
      : c.env.DB.prepare(
          `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
             other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, NULL)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          id, ledger.id, occurredOn, merchant, totalCents, payer,
          otherShare, method, note, extraCents, email, now,
        );

    const OURS = "SELECT 1 FROM expenses e WHERE e.id = ?1 AND e.receipt_id = ?2";
    const statements = [expenseInsert];
    if (receiptId && itemRows) {
      // Confirmed values win: replace the extracted items with the posted
      // set and stamp the receipt with what the human approved.
      statements.push(
        c.env.DB.prepare(
          `DELETE FROM receipt_items WHERE receipt_id = ?2 AND EXISTS (${OURS})`,
        ).bind(id, receiptId),
        ...itemRows.map((it) =>
          c.env.DB.prepare(
            `INSERT INTO receipt_items (id, receipt_id, label, qty, price_cents, assigned_to)
             SELECT ?3, ?2, ?4, ?5, ?6, ?7 WHERE EXISTS (${OURS})`,
          ).bind(id, receiptId, crypto.randomUUID(), it.label, it.qty, it.price_cents, it.assigned_to),
        ),
        c.env.DB.prepare(
          `UPDATE receipts SET status = 'posted', merchant = ?3, purchased_on = ?4, total_cents = ?5
           WHERE id = ?2 AND EXISTS (${OURS})`,
        ).bind(id, receiptId, merchant, occurredOn, totalCents),
      );
    } else if (receiptId) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE receipts SET status = 'posted' WHERE id = ?2 AND EXISTS (${OURS})`,
        ).bind(id, receiptId),
      );
    }

    const results = await c.env.DB.batch(statements);
    if (results[0]!.meta.changes === 0) {
      // Our insert didn't land: an identical retry beat us, the id is taken
      // elsewhere, or the receipt got posted/discarded mid-flight.
      const existing = await c.env.DB.prepare(
        "SELECT ledger_id FROM expenses WHERE id = ?1",
      )
        .bind(id)
        .first<{ ledger_id: string }>();
      if (existing?.ledger_id === ledger.id) {
        return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 200);
      }
      if (existing) {
        return c.json({ error: "id already used" }, 409);
      }
      const receiptNow = receiptId
        ? await c.env.DB.prepare("SELECT status FROM receipts WHERE id = ?1")
            .bind(receiptId)
            .first<{ status: string }>()
        : null;
      return c.json(
        { error: `receipt is ${receiptNow?.status ?? "unavailable"}` },
        409,
      );
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
    // Fast path for the common already-voided case (the insert-failure
    // fallback below covers the race).
    const priorReversal = await c.env.DB.prepare(
      "SELECT id FROM expenses WHERE reverses_id = ?1 AND id != ?2",
    )
      .bind(originalId, id)
      .first<{ id: string }>();
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
    // Voiding a reversal is how UNVOID works: the ledger is append-only, so
    // undoing a void appends a reversal OF the void rather than deleting a
    // row. The negation below makes the third entry restore the first
    // exactly, and UNIQUE(reverses_id) still holds because each new reversal
    // targets the chain TIP — a row nothing has reversed yet.
    if (priorReversal) {
      return c.json({ error: "already voided" }, 409);
    }

    // What this row DOES alternates down the chain: reversing a live entry
    // (even depth) voids it, reversing a live void (odd depth) puts it back.
    // "Is the target a reversal?" is not enough — that calls every row from
    // the third onward an unvoid.
    const chain = await c.env.DB.prepare(
      `WITH RECURSIVE up(id, reverses_id, depth) AS (
         SELECT id, reverses_id, 0 FROM expenses WHERE id = ?1
         UNION ALL
         SELECT e.id, e.reverses_id, up.depth + 1
         FROM expenses e JOIN up ON e.id = up.reverses_id
       )
       SELECT MAX(depth) AS depth FROM up`,
    )
      .bind(original.id)
      .first<{ depth: number }>();
    const note = (chain?.depth ?? 0) % 2 === 0 ? "Void" : "Unvoid";

    try {
      const result = await c.env.DB.prepare(
        `INSERT INTO expenses (id, ledger_id, occurred_on, merchant, total_cents, payer,
           other_share_cents, method, note, receipt_id, extra_cents, created_by, created_at, reverses_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?11, ?12)
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
          note,
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
      // Don't trust the driver's error text alone: on any insert failure,
      // check whether a reversal for this original exists — that's the
      // "already voided" race — before rethrowing.
      const reversal = await c.env.DB.prepare(
        "SELECT id FROM expenses WHERE reverses_id = ?1",
      )
        .bind(original.id)
        .first<{ id: string }>();
      if (reversal) {
        return c.json({ error: "already voided" }, 409);
      }
      throw err;
    }
    return c.json({ entry: await entryResponse(c.env.DB, ledger, email, id) }, 201);
  });

  // The ledger's ONE in-place edit. Everything else appends; swapping who
  // paid rewrites the row instead, because void-and-repost would cost two
  // extra ledger rows for what reads as a correction. The row records that
  // it happened (amended_at/amended_by) so the change isn't silent.
  //
  // The body names the TARGET payer rather than asking for a "swap", so a
  // retry can't flip it twice: naming the payer it already has is a no-op.
  app.post("/api/ledgers/:id/expenses/:expenseId/payer", async (c) => {
    const email = c.get("email");
    const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
    if (!ledger) return c.json({ error: "not found" }, 404);

    const body = await readJson(c.req.raw);
    const payer = assertString(body.payer, "payer").toLowerCase();
    if (payer !== ledger.person_a && payer !== ledger.person_b) {
      throw new ValidationError("payer must be a ledger member");
    }

    const expense = await c.env.DB.prepare(
      `SELECT id, total_cents, payer, other_share_cents, method, receipt_id, reverses_id
       FROM expenses WHERE id = ?1 AND ledger_id = ?2`,
    )
      .bind(c.req.param("expenseId"), ledger.id)
      .first<{
        id: string;
        total_cents: number;
        payer: string;
        other_share_cents: number;
        method: string;
        receipt_id: string | null;
        reverses_id: string | null;
      }>();
    if (!expense) return c.json({ error: "not found" }, 404);
    if (expense.reverses_id) {
      return c.json({ error: "cannot change the payer of a void" }, 409);
    }

    // Voided entries are off limits until they're put back — editing one
    // would quietly change what the eventual unvoid restores. Live state is
    // the parity of the reversal chain, same rule the client uses.
    const chain = await c.env.DB.prepare(
      `WITH RECURSIVE down(id, depth) AS (
         SELECT id, 0 FROM expenses WHERE id = ?1
         UNION ALL
         SELECT e.id, down.depth + 1 FROM expenses e JOIN down ON e.reverses_id = down.id
       )
       SELECT MAX(depth) AS depth FROM down`,
    )
      .bind(expense.id)
      .first<{ depth: number }>();
    if ((chain?.depth ?? 0) % 2 === 1) {
      return c.json({ error: "entry is voided" }, 409);
    }

    if (expense.payer === payer) {
      // Already there: no write, no stamp.
      return c.json({ entry: await entryResponse(c.env.DB, ledger, email, expense.id) }, 200);
    }

    const other = payer === ledger.person_a ? ledger.person_b : ledger.person_a;
    // other_share is the NON-payer's share, so flipping the payer flips whose
    // share it names. For percent/manual that's the remainder. For items the
    // server recomputes from the stored assignments — each side's cut of the
    // extra is rounded on its own, so subtraction is not guaranteed to agree.
    let otherShare = expense.total_cents - expense.other_share_cents;
    if (expense.method === "items" && expense.receipt_id) {
      const { results } = await c.env.DB.prepare(
        "SELECT price_cents, assigned_to FROM receipt_items WHERE receipt_id = ?1",
      )
        .bind(expense.receipt_id)
        .all<{ price_cents: number | null; assigned_to: string | null }>();
      if (results.length) {
        try {
          otherShare = splitItems(
            results.map((r) => ({
              price_cents: r.price_cents ?? 0,
              assigned_to: r.assigned_to ?? other,
            })),
            payer,
            other,
            expense.total_cents,
          ).other_share_cents;
        } catch {
          // Malformed item data (an assignment naming neither member): keep
          // the subtraction fallback rather than failing the swap.
        }
      }
    }

    await c.env.DB.prepare(
      `UPDATE expenses SET payer = ?3, other_share_cents = ?4, amended_at = ?5, amended_by = ?6
       WHERE id = ?1 AND ledger_id = ?2`,
    )
      .bind(expense.id, ledger.id, payer, otherShare, Date.now(), email)
      .run();

    return c.json({ entry: await entryResponse(c.env.DB, ledger, email, expense.id) }, 200);
  });
}
