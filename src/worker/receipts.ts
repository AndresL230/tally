import type { Hono } from "hono";
import type { AppContext, Env } from "./env";
import { MAX_RECEIPT_PAGES, type ApiItem, type ApiReceipt } from "../shared/types";
import { ledgerForMember, type LedgerRow } from "./db";
import { GatewayError, runExtraction, type ExtractionFields, type ReceiptPage } from "./extract";
import { ValidationError, assertId } from "./validate";

// What a receipt can arrive as: the three photo codecs, plus PDF — an
// emailed or downloaded receipt is a document, not a photograph, and the
// model reads both through the same extraction call.
const PDF_TYPE = "application/pdf";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", PDF_TYPE]);
// One cap for both kinds. Base64 inflates by 4/3 on the way to the model,
// so 8 MB of stored bytes stays well inside the Messages API's 32 MB
// request ceiling. (A PDF past its page limit fails at the gateway and
// lands on 'failed' like any other unreadable receipt.)
const MAX_BYTES = 8_000_000;

// A receipt can be several files, sent together as multipart/form-data
// (one `page` part each, in reading order): a long receipt photographed in
// parts, the front and back of one. Each part keeps the 8 MB cap above; the
// whole set is capped so the base64 request (4/3 inflation) still clears
// the Messages API's 32 MB ceiling.
const MAX_TOTAL_BYTES = 20_000_000;

interface UploadedPage {
  bytes: ArrayBuffer;
  contentType: string;
}

function normalizedType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0]!.trim().toLowerCase();
}

function assertAllowedType(contentType: string): void {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new ValidationError(
      "content-type must be image/jpeg, image/png, image/webp or application/pdf",
    );
  }
}

/** The pages of an upload, in order, type-checked and non-empty. A raw
 *  body is one page; multipart/form-data carries one `page` part per file.
 *  Size caps are the caller's (they answer 413, not 400). */
async function readPages(req: Request): Promise<UploadedPage[]> {
  const contentType = normalizedType(req.headers.get("content-type"));
  if (contentType !== "multipart/form-data") {
    assertAllowedType(contentType);
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength === 0) throw new ValidationError("empty upload");
    return [{ bytes, contentType }];
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("malformed multipart body");
  }
  const parts = form.getAll("page");
  if (parts.length === 0) throw new ValidationError("no pages in upload");
  if (parts.length > MAX_RECEIPT_PAGES) {
    throw new ValidationError(`at most ${MAX_RECEIPT_PAGES} pages per receipt`);
  }
  const pages: UploadedPage[] = [];
  for (const part of parts) {
    if (typeof part === "string") throw new ValidationError("each page must be a file");
    const pageType = normalizedType(part.type);
    assertAllowedType(pageType);
    const bytes = await part.arrayBuffer();
    if (bytes.byteLength === 0) throw new ValidationError("empty upload");
    pages.push({ bytes, contentType: pageType });
  }
  return pages;
}

/** The dedupe key. One page hashes exactly as it always has, so a one-file
 *  upload still dedupes against every receipt stored before pages existed.
 *  Several pages hash their ordered per-page digests under a prefix no raw
 *  file digest can collide with. */
async function receiptSha(pages: UploadedPage[]): Promise<string> {
  const digests = await Promise.all(pages.map((p) => sha256Hex(p.bytes)));
  if (digests.length === 1) return digests[0]!;
  return await sha256Hex(new TextEncoder().encode(`pages:${digests.join(",")}`));
}

/** Where page n (1-based) of a receipt lives. Page 1 keeps the contract's
 *  key; later pages add a -n suffix. Photos keep the .jpg suffix whatever
 *  their codec; a PDF says so, since the stored content type is what
 *  extract reads back. */
function pageKey(ledgerId: string, id: string, page: number, contentType: string): string {
  const suffix = page === 1 ? "" : `-${page}`;
  return `receipts/${ledgerId}/${id}${suffix}.${contentType === PDF_TYPE ? "pdf" : "jpg"}`;
}

// Scan caps. Upload is the choke point (extract is once-per-image), and the
// caps exist so that opening sign-up can't turn the model key into a public
// resource. Counted on receipts.uploaded_by / created_at; dedupes never count.
export const PER_USER_DAILY_UPLOADS = 30;
export const GLOBAL_DAILY_UPLOADS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

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
      "SELECT id, label, qty, price_cents, assigned_to, share_cents FROM receipt_items WHERE receipt_id = ?1 ORDER BY rowid",
    )
    .bind(receiptId)
    .all<ApiItem>();
  return results;
}

async function receiptById(db: D1Database, id: string): Promise<ReceiptRow | null> {
  return await db.prepare("SELECT * FROM receipts WHERE id = ?1").bind(id).first<ReceiptRow>();
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
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
    const pages = await readPages(c.req.raw);
    const totalBytes = pages.reduce((sum, p) => sum + p.bytes.byteLength, 0);
    if (pages.some((p) => p.bytes.byteLength > MAX_BYTES) || totalBytes > MAX_TOTAL_BYTES) {
      return c.json({ error: "receipt too large" }, 413);
    }

    const sha = await receiptSha(pages);

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

    const dayAgo = Date.now() - DAY_MS;
    const counts = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM receipts WHERE uploaded_by = ?1 AND created_at > ?2) AS mine,
              (SELECT COUNT(*) FROM receipts WHERE created_at > ?2) AS total`,
    )
      .bind(email, dayAgo)
      .first<{ mine: number; total: number }>();
    if (counts && (counts.mine >= PER_USER_DAILY_UPLOADS || counts.total >= GLOBAL_DAILY_UPLOADS)) {
      return c.json({ error: "daily scan limit reached" }, 429);
    }

    // Same client id with different bytes is a collision, not a retry.
    const byId = await receiptById(c.env.DB, id);
    if (byId) return c.json({ error: "id already used" }, 409);

    // Rows first, THEN the objects: if two uploads race, the D1 primary key
    // / sha unique decides the winner before any bytes land in R2, so the
    // stored objects can never disagree with the row's sha256 and a losing
    // dedupe race leaves no orphan object. The receipt row and its extra
    // page rows go in one batch, so they land together or not at all.
    const keys = pages.map((p, i) => pageKey(ledger.id, id, i + 1, p.contentType));
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO receipts (id, ledger_id, r2_key, sha256, status, uploaded_by, created_at)
           VALUES (?1, ?2, ?3, ?4, 'uploaded', ?5, ?6)`,
        ).bind(id, ledger.id, keys[0]!, sha, email, Date.now()),
        ...keys.slice(1).map((key, i) =>
          c.env.DB.prepare(
            "INSERT INTO receipt_pages (receipt_id, page, r2_key) VALUES (?1, ?2, ?3)",
          ).bind(id, i + 2, key),
        ),
      ]);
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
      for (const [i, page] of pages.entries()) {
        await c.env.RECEIPTS.put(keys[i]!, page.bytes, {
          httpMetadata: { contentType: page.contentType },
        });
      }
    } catch (err) {
      // Compensate: a row without its objects would only fail later at
      // extract time; better to fail loudly now and leave nothing behind.
      await c.env.RECEIPTS.delete(keys).catch(() => undefined);
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM receipt_pages WHERE receipt_id = ?1").bind(id),
        c.env.DB.prepare("DELETE FROM receipts WHERE id = ?1").bind(id),
      ]);
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
      // The live path is gated on the secret (see README: AI Gateway setup). Status
      // stays as-is so extraction can run once the key exists.
      return c.json({ error: "extraction not configured" }, 503);
    }
    if (!receipt.r2_key) {
      return c.json({ error: "receipt has no stored file" }, 500);
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
      const { results: extra } = await c.env.DB.prepare(
        "SELECT r2_key FROM receipt_pages WHERE receipt_id = ?1 ORDER BY page",
      )
        .bind(receipt.id)
        .all<{ r2_key: string }>();
      const pages: ReceiptPage[] = [];
      for (const key of [receipt.r2_key, ...extra.map((p) => p.r2_key)]) {
        const object = await c.env.RECEIPTS.get(key);
        if (!object) {
          await c.env.DB.prepare("UPDATE receipts SET status = 'failed' WHERE id = ?1")
            .bind(receipt.id)
            .run();
          return c.json({ error: "stored receipt is missing" }, 500);
        }
        pages.push({
          bytes: await object.arrayBuffer(),
          mediaType: object.httpMetadata?.contentType ?? "image/jpeg",
        });
      }
      const { raw, fields } = await runExtraction(c.env, pages);
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
