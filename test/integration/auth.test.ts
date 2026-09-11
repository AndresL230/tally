import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { authedFetch, sessionCookieFor } from "../helpers/auth";
import { ALEX } from "../helpers/fixtures";
import {
  RENEW_BELOW_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  TOUCH_EVERY_MS,
  createSession,
  sha256Hex,
} from "../../src/worker/session";

const ORIGIN = "https://tally.test";

async function sessionRow(token: string) {
  return await env.DB.prepare("SELECT * FROM sessions WHERE id = ?1")
    .bind(await sha256Hex(token))
    .first<{ email: string; expires_at: number; last_seen_at: number }>();
}

describe("session cookie on /api/*", () => {
  it("rejects requests with no cookie", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("rejects garbage and unknown tokens", async () => {
    for (const cookie of ["tally_session=nope", "tally_session=", `tally_session=${"a".repeat(43)}`]) {
      const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } });
      expect(res.status, cookie).toBe(401);
    }
  });

  it("never trusts the old Access headers", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/me`, {
      headers: { "Cf-Access-Authenticated-User-Email": ALEX, "Cf-Access-Jwt-Assertion": "x.y.z" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid session and reports its email", async () => {
    const res = await authedFetch("/api/me", "Alex@Example.COM");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: ALEX });
  });

  it("rejects an expired session", async () => {
    const token = await createSession(env.DB, ALEX, Date.now() - SESSION_TTL_MS - 1000);
    const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(401);
  });

  it("authenticates a normal API round-trip", async () => {
    const res = await authedFetch("/api/ledgers", ALEX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ledgers: [] });
  });
});

describe("CSRF: Origin check on non-GET /api requests", () => {
  it("rejects a cross-origin POST even with a valid cookie", async () => {
    const res = await authedFetch("/api/ledgers", ALEX, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ id: crypto.randomUUID(), friend_email: "jordan@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("allows same-origin and header-less POSTs", async () => {
    const body = () => JSON.stringify({ id: crypto.randomUUID(), friend_email: "jordan@example.com" });
    const same = await authedFetch("/api/ledgers", ALEX, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: body(),
    });
    expect(same.status).toBe(201);
    const bare = await authedFetch("/api/ledgers", ALEX, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body(),
    });
    expect(bare.status).toBe(200); // same pair => existing ledger
  });
});

describe("sliding renewal", () => {
  it("re-emits the cookie and extends the row when under 45 days remain", async () => {
    const now = Date.now();
    // Created 50 days ago => 40 days left => inside the renewal window.
    const token = await createSession(env.DB, ALEX, now - 50 * 24 * 60 * 60 * 1000);
    const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=${token}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure"); // https origin
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    const row = await sessionRow(token);
    expect(row!.expires_at).toBeGreaterThan(now + SESSION_TTL_MS - RENEW_BELOW_MS);
    expect(row!.last_seen_at).toBeGreaterThanOrEqual(now);
  });

  it("does not touch the row or the cookie on a fresh session", async () => {
    const token = await createSession(env.DB, ALEX);
    const before = await sessionRow(token);
    const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await sessionRow(token)).toEqual(before);
  });

  it("writes last_seen_at once an hour without renewing", async () => {
    const now = Date.now();
    const token = await createSession(env.DB, ALEX, now - 2 * TOUCH_EVERY_MS);
    const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const row = await sessionRow(token);
    expect(row!.last_seen_at).toBeGreaterThanOrEqual(now);
    expect(row!.expires_at).toBe(now - 2 * TOUCH_EVERY_MS + SESSION_TTL_MS);
  });

  it("omits Secure over plain http (wrangler dev)", async () => {
    const token = await createSession(env.DB, ALEX, Date.now() - 50 * 24 * 60 * 60 * 1000);
    const res = await SELF.fetch(`http://localhost/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });
});

describe("root and /login routes", () => {
  it("serves the landing page to anonymous visitors and the app to a session", async () => {
    const anon = await SELF.fetch(`${ORIGIN}/`);
    expect(anon.status).toBe(200);
    expect(await anon.text()).toContain("a private ledger for two");
    const app = await SELF.fetch(`${ORIGIN}/`, { headers: { Cookie: await sessionCookieFor(ALEX) } });
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<div id="root">');
  });
});
