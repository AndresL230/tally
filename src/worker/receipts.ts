import type { Hono } from "hono";
import type { AppContext, Env } from "./env";
import type { ApiItem, ApiReceipt } from "../shared/types";
import { ledgerForMember, type LedgerRow } from "./db";
import { GatewayError, runExtraction, type ExtractionFields } from "./extract";
import { ValidationError, assertId } from "./validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8_000_000;

interface ReceiptRow {
  id: string;
  ledger_id: string;
  r2_key: string | null;
  sha256: string;
  status: ApiReceipt["status"];
  raw_json: string | null;
  merchant: string | null;
  purchased_on: string | null;
  total_cents: number | null;
  uploaded_by: string | null;
  created_at: number | null;
}

function toApi(r: ReceiptRow): ApiReceipt {
  return {
    id: r.id,
    ledger_id: r.ledger_id,
    status: r.status,
    merchant: r.merchant,
    purchased_on: r.purchased_on,
    total_cents: r.total_cents,
    uploaded_by: r.uploaded_by,
    created_at: r.created_at,
  };
}

async function itemsOf(db: D1Database, receiptId: string): Promise<ApiItem[]> {
  const { results } = await db
    .prepare(
      "SELECT id, label, qty, price_cents, assigned_to FROM receipt_items WHERE receipt_id = ?1 ORDER BY rowid",
    )
    .bind(receiptId)
    .all<ApiItem>();
  return results;
}

async function receiptById(db: D1Database, id: string): Promise<ReceiptRow | null> {
  return await db.prepare("SELECT * FROM receipts WHERE id = ?1").bind(id).first<ReceiptRow>();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Receipt + membership, or null (route answers 404 — no existence oracle:
 *  missing and foreign receipts return byte-identical responses; the receipt
 *  lookup happening first leaks nothing observable in the body). */
async function receiptForMember(
  env: Env,
  receiptId: string,
  email: string,
): Promise<{ receipt: ReceiptRow; ledger: LedgerRow } | null> {
  const receipt = await receiptById(env.DB, receiptId);
  if (!receipt) return null;
  const ledger = await ledgerForMember(env.DB, receipt.ledger_id, email);
  if (!ledger) return null;
  return { receipt, ledger };
}

async function persistExtraction(
  env: Env,
  receipt: ReceiptRow,
  raw: string,
  fields: ExtractionFields,
): Promise<void> {
  const statements = [
    env.DB.prepare(
      `UPDATE receipts SET raw_json = ?2, merchant = ?3, purchased_on = ?4,
         total_cents = ?5, status = 'needs_review' WHERE id = ?1`,
    ).bind(receipt.id, raw, fields.merchant, fields.purchased_on, fields.total_cents),
    env.DB.prepare("DELETE FROM receipt_items WHERE receipt_id = ?1").bind(receipt.id),
    ...fields.items.map((item) =>
      env.DB.prepare(
        `INSERT INTO receipt_items (id, receipt_id, label, qty, price_cents, assigned_to)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)`,
      ).bind(crypto.randomUUID(), receipt.id, item.label, item.qty, item.price_cents),
    ),
  ];
  await env.DB.batch(statements);
}

export function registerReceipts(app: Hono<AppContext>): void {
  app.post("/api/ledgers/:id/receipts", async (c) => {
    const email = c.get("email");
    const ledger = await ledgerForMember(c.env.DB, c.req.param("id"), email);
    if (!ledger) return c.json({ error: "not found" }, 404);

    const id = assertId(c.req.query("id"), "id");
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      throw new ValidationError("content-type must be image/jpeg, image/png or image/webp");
    }
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new ValidationError("empty image");
    if (bytes.byteLength > MAX_BYTES) {
      return c.json({ error: "image too large" }, 413);
    }

    const sha = await sha256Hex(bytes);

    // Dedupe: same bytes in this ledger = the existing receipt, whatever
    // its status. No new row, no new R2 object, no re-extraction.
    const existing = await c.env.DB.prepare(
      "SELECT * FROM receipts WHERE ledger_id = ?1 AND sha256 = ?2",
    )
      .bind(ledger.id, sha)
      .first<ReceiptRow>();
    if (existing) {
      // Re-uploading the bytes of a DISCARDED receipt is a clear signal the
      // user wants it back: resurrect instead of dead-ending every later
      // commit on a 409 (DEVIATIONS D8). Extracted state survives.
      if (existing.status === "discarded") {
        await c.env.DB.prepare("UPDATE receipts SET status = ?2 WHERE id = ?1")
          .bind(existing.id, existing.raw_json !== null ? "needs_review" : "uploaded")
          .run();
        const revived = await receiptById(c.env.DB, existing.id);
        return c.json(
          { receipt: toApi(revived!), items: await itemsOf(c.env.DB, existing.id) },
          200,
        );
      }
      return c.json(
        { receipt: toApi(existing), items: await itemsOf(c.env.DB, existing.id) },
        200,
      );
    }

    // Same client id with different bytes is a collision, not a retry.
    const byId = await receiptById(c.env.DB, id);
    if (byId) return c.json({ error: "id already used" }, 409);

    // Row first, THEN the object: if two uploads race, the D1 primary key /
    // sha unique decides the winner before any bytes land in R2, so the
    // stored object can never disagree with the row's sha256 and a losing
    // dedupe race leaves no orphan object.
    const r2Key = `receipts/${ledger.id}/${id}.jpg`;
    try {
      await c.env.DB.prepare(
        `INSERT INTO receipts (id, ledger_id, r2_key, sha256, status, uploaded_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'uploaded', ?5, ?6)`,
      )
        .bind(id, ledger.id, r2Key, sha, email, Date.now())
        .run();
    } catch (err) {
      // Concurrent identical upload: fall back to the dedupe path.
      const raced = await c.env.DB.prepare(
        "SELECT * FROM receipts WHERE ledger_id = ?1 AND sha256 = ?2",
      )
        .bind(ledger.id, sha)
        .first<ReceiptRow>();
      if (raced) {
        return c.json(
          { receipt: toApi(raced), items: await itemsOf(c.env.DB, raced.id) },
          200,
        );
      }
      throw err;
    }

    try {
      await c.env.RECEIPTS.put(r2Key, bytes, {
        httpMetadata: { contentType },
      });
    } catch (err) {
      // Compensate: a row without an object would only fail later at
      // extract time; better to fail loudly now and leave nothing behind.
      await c.env.DB.prepare("DELETE FROM receipts WHERE id = ?1").bind(id).run();
      throw err;
    }

    const receipt = await receiptById(c.env.DB, id);
    return c.json({ receipt: toApi(receipt!), items: [] }, 201);
  });

  app.post("/api/receipts/:rid/extract", async (c) => {
    const email = c.get("email");
    const found = await receiptForMember(c.env, c.req.param("rid"), email);
    if (!found) return c.json({ error: "not found" }, 404);
    const { receipt } = found;

    // Cache: one model call per image, ever.
    if (receipt.raw_json !== null) {
      return c.json(
        { receipt: toApi(receipt), items: await itemsOf(c.env.DB, receipt.id) },
        200,
      );
    }
    if (receipt.status === "posted" || receipt.status === "discarded") {
      return c.json({ error: `receipt is ${receipt.status}` }, 409);
    }
    if (!c.env.ANTHROPIC_API_KEY) {
      // The live path is gated on the secret (HUMAN_TODO step 6). Status
      // stays as-is so extraction can run once the key exists.
      return c.json({ error: "extraction not configured" }, 503);
    }
    if (!receipt.r2_key) {
      return c.json({ error: "receipt has no stored image" }, 500);
    }

    // Claim the job with a conditional write so two members scanning the
    // same paper receipt can't trigger two model calls: only one caller
    // flips the status to 'extracting'; everyone else gets the current
    // state back and polls (the cache branch above serves them once the
    // winner persists). One model call per image, enforced, not assumed.
    const claim = await c.env.DB.prepare(
      `UPDATE receipts SET status = 'extracting'
       WHERE id = ?1 AND status IN ('uploaded', 'failed') AND raw_json IS NULL`,
    )
      .bind(receipt.id)
      .run();
    if (claim.meta.changes === 0) {
      const current = await receiptById(c.env.DB, receipt.id);
      return c.json(
        { receipt: toApi(current!), items: await itemsOf(c.env.DB, receipt.id) },
        200,
      );
    }

    try {
      const object = await c.env.RECEIPTS.get(receipt.r2_key);
      if (!object) {
        await c.env.DB.prepare("UPDATE receipts SET status = 'failed' WHERE id = ?1")
          .bind(receipt.id)
          .run();
        return c.json({ error: "stored image is missing" }, 500);
      }
      const { raw, fields } = await runExtraction(
        c.env,
        await object.arrayBuffer(),
        object.httpMetadata?.contentType ?? "image/jpeg",
      );
      await persistExtraction(c.env, receipt, raw, fields);
    } catch (err) {
      // ANY failure after the claim releases it as 'failed' (raw_json still
      // NULL, so a retry can re-claim); the receipt never sticks at
      // 'extracting' because of a thrown error.
      await c.env.DB.prepare("UPDATE receipts SET status = 'failed' WHERE id = ?1")
        .bind(receipt.id)
        .run();
      const message = err instanceof GatewayError ? err.message : "extraction failed";
      if (!(err instanceof GatewayError)) console.error(err);
      return c.json({ error: message }, 500);
    }

    const fresh = await receiptById(c.env.DB, receipt.id);
    return c.json(
      { receipt: toApi(fresh!), items: await itemsOf(c.env.DB, receipt.id) },
      200,
    );
  });

  app.post("/api/receipts/:rid/discard", async (c) => {
    const email = c.get("email");
    const found = await receiptForMember(c.env, c.req.param("rid"), email);
    if (!found) return c.json({ error: "not found" }, 404);
    const { receipt } = found;
    if (receipt.status === "posted") {
      return c.json({ error: "receipt is posted" }, 409);
    }
    if (receipt.status !== "discarded") {
      await c.env.DB.prepare("UPDATE receipts SET status = 'discarded' WHERE id = ?1")
        .bind(receipt.id)
        .run();
    }
    const fresh = await receiptById(c.env.DB, receipt.id);
    return c.json({ receipt: toApi(fresh!) }, 200);
  });
}
