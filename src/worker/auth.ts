import type { MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import {
  SESSION_COOKIE,
  cookieValue,
  findSession,
  sessionCookie,
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
