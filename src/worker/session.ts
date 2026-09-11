// Sessions: a random token in an HttpOnly cookie, its sha256 as the row id
// in D1. The raw token never touches the database, so a DB read can't
// produce a usable cookie. Revocation is a row delete.

export const SESSION_COOKIE = "tally_session";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Sliding renewal: extend when less than this remains. */
export const RENEW_BELOW_MS = 45 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often, so normal use is one read. */
export const TOUCH_EVERY_MS = 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  email: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes (256 bits), cookie-safe. */
export function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(
  token: string,
  secure: boolean,
  maxAgeSeconds: number = SESSION_TTL_MS / 1000,
): string {
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}` +
    (secure ? "; Secure" : "")
  );
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}

export async function createSession(db: D1Database, email: string, now = Date.now()): Promise<string> {
  const token = randomToken();
  const id = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO sessions (id, email, created_at, expires_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?3)`,
    )
    .bind(id, email, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

export async function findSession(db: D1Database, token: string, now = Date.now()): Promise<SessionRow | null> {
  const id = await sha256Hex(token);
  return await db
    .prepare("SELECT * FROM sessions WHERE id = ?1 AND expires_at > ?2")
    .bind(id, now)
    .first<SessionRow>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const id = await sha256Hex(token);
  await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
}

/**
 * Sliding renewal + hourly touch in one write. Returns the new expires_at
 * when the session was renewed (the caller re-emits the cookie), else null.
 */
export async function touchSession(db: D1Database, row: SessionRow, now = Date.now()): Promise<number | null> {
  const renew = row.expires_at - now < RENEW_BELOW_MS;
  const touch = now - row.last_seen_at >= TOUCH_EVERY_MS;
  if (!renew && !touch) return null;
  const expires = renew ? now + SESSION_TTL_MS : row.expires_at;
  await db
    .prepare("UPDATE sessions SET expires_at = ?2, last_seen_at = ?3 WHERE id = ?1")
    .bind(row.id, expires, now)
    .run();
  return renew ? expires : null;
}
