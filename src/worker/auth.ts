import type { Hono, MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import { looksLikeEmail } from "../shared/prefs";
import { ValidationError, assertString, readJson } from "./validate";
import { sendMail } from "./mailer";
import { signInCode } from "./emails";
import { getSignupMode } from "./settings";
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  cookieValue,
  createSession,
  deleteSession,
  findSession,
  sessionCookie,
  sha256Hex,
  touchSession,
} from "./session";

// base64url of 32 bytes is 43 chars; anything else is not ours.
const TOKEN_RE = /^[\w-]{43}$/;

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function tokenFrom(request: Request): string | null {
  const token = cookieValue(request.headers.get("Cookie"), SESSION_COOKIE);
  return token && TOKEN_RE.test(token) ? token : null;
}

/**
 * Resolve the signed-in user from a request. All identity flows through
 * here: the session cookie's token is hashed and looked up in D1. No header
 * is trusted, and there is no local-dev bypass — dev signs in for real with
 * a console-printed code.
 */
export async function getUser(request: Request, env: Env): Promise<{ email: string } | null> {
  const token = tokenFrom(request);
  if (!token) return null;
  const row = await findSession(env.DB, token);
  return row ? { email: row.email } : null;
}

/** Hono middleware: 401 unless the request carries a live session. */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  // CSRF, second layer behind SameSite=Lax: a browser always sends Origin on
  // cross-site non-GET requests, and it must be our own origin.
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  const token = tokenFrom(c.req.raw);
  const row = token ? await findSession(c.env.DB, token) : null;
  if (!token || !row) return c.json({ error: "unauthenticated" }, 401);
  c.set("email", row.email);
  await next();
  // Sliding renewal / hourly touch after the handler, so the response
  // carries the refreshed cookie when the row was extended.
  const renewed = await touchSession(c.env.DB, row);
  if (renewed !== null) {
    c.header("Set-Cookie", sessionCookie(token, isSecure(c.req.raw)), { append: true });
  }
};

// ---- Codes ------------------------------------------------------------------

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
}

/** Six digits from the CSPRNG, uniform: 2^32 isn't a multiple of 10^6, so
 *  the top sliver of the 32-bit range is rejected instead of wrapped. */
export function randomCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

function normalizeEmail(value: unknown): string {
  const email = assertString(value, "email", { trim: true, max: 254 }).toLowerCase();
  if (!looksLikeEmail(email)) throw new ValidationError("email must be an email address");
  return email;
}

export const RESEND_COOLDOWN_MS = 60 * 1000;
export const PER_EMAIL_HOURLY = 5;
export const GLOBAL_HOURLY = 30;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Invite-only unless the owner opened sign-up: the owner, anyone with a
 * users row, any ledger member, or an explicit invite may request a code.
 */
export async function mayRequestCode(env: Env, email: string): Promise<boolean> {
  if (env.ADMIN_EMAIL && env.ADMIN_EMAIL.toLowerCase() === email) return true;
  if ((await getSignupMode(env.DB)) === "open") return true;
  const known = await env.DB.prepare(
    `SELECT 1 AS ok
     WHERE EXISTS (SELECT 1 FROM users WHERE email = ?1)
        OR EXISTS (SELECT 1 FROM invites WHERE email = ?1)
        OR EXISTS (SELECT 1 FROM ledgers WHERE person_a = ?1 OR person_b = ?1)`,
  )
    .bind(email)
    .first<{ ok: number }>();
  return known !== null;
}

interface Limited {
  retryAfter: number;
}

function secondsUntil(t: number, now: number): number {
  return Math.max(1, Math.ceil((t - now) / 1000));
}

/** Global cap, then per-email cooldown, then per-email hourly cap. */
async function rateLimited(db: D1Database, email: string, now: number): Promise<Limited | null> {
  const since = now - HOUR_MS;
  const all = await db
    .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM auth_codes WHERE created_at > ?1")
    .bind(since)
    .first<{ n: number; oldest: number | null }>();
  if (all && all.n >= GLOBAL_HOURLY) {
    return { retryAfter: secondsUntil((all.oldest ?? now) + HOUR_MS, now) };
  }
  const mine = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest
       FROM auth_codes WHERE email = ?1 AND created_at > ?2`,
    )
    .bind(email, since)
    .first<{ n: number; oldest: number | null; newest: number | null }>();
  if (mine && mine.newest !== null && now - mine.newest < RESEND_COOLDOWN_MS) {
    return { retryAfter: secondsUntil(mine.newest + RESEND_COOLDOWN_MS, now) };
  }
  if (mine && mine.n >= PER_EMAIL_HOURLY) {
    return { retryAfter: secondsUntil((mine.oldest ?? now) + HOUR_MS, now) };
  }
  return null;
}

/**
 * The public half of auth. Registered BEFORE `app.use("/api/*", requireUser)`
 * in index.ts — in Hono, a route registered earlier answers before later
 * middleware runs, which is what exempts these two from the session check.
 */
export function registerAuth(app: Hono<AppContext>): void {
  app.post("/api/auth/code", async (c) => {
    const body = await readJson(c.req.raw);
    const email = normalizeEmail(body.email);
    const now = Date.now();
    const db = c.env.DB;
    // Housekeeping: dead codes are worthless after a day.
    await db.prepare("DELETE FROM auth_codes WHERE created_at < ?1").bind(now - DAY_MS).run();

    const limited = await rateLimited(db, email, now);
    if (limited) return c.json({ error: "slow down", retry_after: limited.retryAfter }, 429);
    if (!(await mayRequestCode(c.env, email))) return c.json({ error: "not invited" }, 403);

    const code = randomCode();
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO auth_codes (id, email, code_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(id, email, await sha256Hex(`${id}:${code}`), now, now + CODE_TTL_MS)
      .run();
    try {
      await sendMail(c.env, { to: email, ...signInCode(code) });
    } catch (err) {
      console.error("sign-in mail failed", err);
      await db.prepare("DELETE FROM auth_codes WHERE id = ?1").bind(id).run();
      return c.json({ error: "couldn't send the email" }, 502);
    }
    return c.json({ ok: true });
  });

  app.post("/api/auth/verify", async (c) => {
    const body = await readJson(c.req.raw);
    const email = normalizeEmail(body.email);
    const code = assertString(body.code, "code", { trim: true }).replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw new ValidationError("code must be six digits");
    const now = Date.now();
    const db = c.env.DB;

    // Every code for this email, newest first: only the first row is live
    // (rowid breaks same-ms ties). The rest are kept around only so a real
    // but superseded code can be told apart from a guess, below.
    const { results: rows } = await db
      .prepare("SELECT * FROM auth_codes WHERE email = ?1 ORDER BY created_at DESC, rowid DESC")
      .bind(email)
      .all<CodeRow>();
    const row = rows[0];
    const dead = !row || row.consumed_at !== null || row.expires_at <= now || row.attempts >= MAX_ATTEMPTS;
    if (dead) return c.json({ error: "code expired" }, 400);

    if ((await sha256Hex(`${row.id}:${code}`)) !== row.code_hash) {
      // A real but superseded code reads as "expired", not a wrong guess —
      // it shouldn't burn an attempt against the code that's actually live.
      for (const stale of rows.slice(1)) {
        if ((await sha256Hex(`${stale.id}:${code}`)) === stale.code_hash) {
          return c.json({ error: "code expired" }, 400);
        }
      }
      // Count in the database, not in JS: concurrent guesses that all read
      // the same `attempts` would otherwise all write the same value back,
      // giving a guesser unlimited tries for the price of one.
      const bump = await db
        .prepare("UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?1 AND attempts < ?2")
        .bind(row.id, MAX_ATTEMPTS)
        .run();
      if (bump.meta.changes === 0) return c.json({ error: "code expired" }, 400);
      const after = await db
        .prepare("SELECT attempts FROM auth_codes WHERE id = ?1")
        .bind(row.id)
        .first<{ attempts: number }>();
      const attempts = after?.attempts ?? MAX_ATTEMPTS;
      if (attempts >= MAX_ATTEMPTS) return c.json({ error: "code expired" }, 400);
      return c.json({ error: "wrong code", tries_left: MAX_ATTEMPTS - attempts }, 400);
    }

    // Single use, enforced by the database: the row goes from unconsumed to
    // consumed exactly once, so two simultaneous correct submissions mint
    // one session, not two.
    const consumed = await db
      .prepare("UPDATE auth_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL")
      .bind(row.id, now)
      .run();
    if (consumed.meta.changes !== 1) return c.json({ error: "code expired" }, 400);
    // Housekeeping: expired sessions go when a new one is minted.
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now).run();
    const token = await createSession(db, email, now);
    c.header("Set-Cookie", sessionCookie(token, isSecure(c.req.raw)));
    return c.json({ email });
  });

  // Gates itself: registered before the global middleware, so it must ask.
  app.post("/api/auth/signout", requireUser, async (c) => {
    const token = tokenFrom(c.req.raw);
    if (token) await deleteSession(c.env.DB, token);
    c.header("Set-Cookie", clearedSessionCookie(isSecure(c.req.raw)));
    return c.body(null, 204);
  });
}
