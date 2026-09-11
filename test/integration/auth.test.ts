import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, env } from "cloudflare:test";
import { authedFetch, sessionCookieFor } from "../helpers/auth";
import { ALEX, insertCode, insertLedger } from "../helpers/fixtures";
import { failNextSend, installMailPatch, lastCodeFor, outbox, removeMailPatch } from "../helpers/mail";
import { CODE_TTL_MS, GLOBAL_HOURLY, MAX_ATTEMPTS, PER_EMAIL_HOURLY, RESEND_COOLDOWN_MS } from "../../src/worker/auth";
import { setSignupMode } from "../../src/worker/settings";
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

  it("rejects cross-origin POSTs to the session-minting routes (login-CSRF)", async () => {
    installMailPatch();
    try {
      await insertLedger(ALEX, "jordan@example.com"); // ALEX would otherwise be allowed
      const evil = { "Content-Type": "application/json", Origin: "https://evil.example" };
      const code = await post("/api/auth/code", { email: ALEX }, { headers: evil });
      expect(code.status).toBe(403);
      expect(await code.json()).toEqual({ error: "forbidden" });
      const verify = await post("/api/auth/verify", { email: ALEX, code: "111111" }, { headers: evil });
      expect(verify.status).toBe(403);
      expect(outbox).toHaveLength(0);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_codes").first<{ n: number }>();
      expect(n!.n).toBe(0);
    } finally {
      removeMailPatch();
    }
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

function post(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

/** Cookie value from a verify response. */
function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /tally_session=([^;]+)/.exec(raw);
  if (!m) throw new Error(`no session cookie in: ${raw}`);
  return `tally_session=${m[1]}`;
}

describe("POST /api/auth/code + /api/auth/verify", () => {
  beforeEach(async () => {
    installMailPatch();
    await insertLedger(ALEX, "jordan@example.com"); // ALEX is a ledger member => allowed
  });
  afterEach(() => removeMailPatch());

  it("emails a code, verifies it, and the cookie authenticates", async () => {
    const sent = await post("/api/auth/code", { email: "Alex@Example.com" });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toEqual([ALEX]);
    expect(outbox[0]!.subject).toMatch(/^Your Tally code: \d{3} \d{3}$/);

    const code = lastCodeFor(ALEX);
    const ok = await post("/api/auth/verify", { email: ALEX, code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: ALEX });
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^tally_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure$/);

    const me = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookieOf(ok) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: ALEX });
  });

  it("rejects malformed requests", async () => {
    expect((await post("/api/auth/code", { email: "not-an-email" })).status).toBe(400);
    expect((await post("/api/auth/code", {})).status).toBe(400);
    expect((await post("/api/auth/verify", { email: ALEX, code: "12345" })).status).toBe(400);
    expect((await post("/api/auth/verify", { email: ALEX, code: "abcdef" })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  it("a wrong code counts down and the fifth miss kills it", async () => {
    await insertCode(ALEX, "111111");
    for (let miss = 1; miss < MAX_ATTEMPTS; miss++) {
      const res = await post("/api/auth/verify", { email: ALEX, code: "000000" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "wrong code", tries_left: MAX_ATTEMPTS - miss });
    }
    const fifth = await post("/api/auth/verify", { email: ALEX, code: "000000" });
    expect(await fifth.json()).toEqual({ error: "code expired" });
    // Even the right code is dead now.
    const right = await post("/api/auth/verify", { email: ALEX, code: "111111" });
    expect(await right.json()).toEqual({ error: "code expired" });
  });

  it("counts concurrent wrong guesses in the database, not in JS", async () => {
    const id = await insertCode(ALEX, "111111");
    const misses = await Promise.all(
      Array.from({ length: 20 }, () => post("/api/auth/verify", { email: ALEX, code: "000000" })),
    );
    for (const res of misses) expect(res.status).toBe(400);
    const row = await env.DB.prepare("SELECT attempts FROM auth_codes WHERE id = ?1")
      .bind(id)
      .first<{ attempts: number }>();
    expect(row!.attempts).toBe(MAX_ATTEMPTS); // not 1: every guess is counted
    const right = await post("/api/auth/verify", { email: ALEX, code: "111111" });
    expect(right.status).toBe(400);
    expect(await right.json()).toEqual({ error: "code expired" });
  });

  it("two simultaneous correct submissions mint exactly one session", async () => {
    await insertCode(ALEX, "246813");
    const both = await Promise.all([
      post("/api/auth/verify", { email: ALEX, code: "246813" }),
      post("/api/auth/verify", { email: ALEX, code: "246813" }),
    ]);
    const statuses = both.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400]);
    const loser = both.find((r) => r.status === 400)!;
    expect(await loser.json()).toEqual({ error: "code expired" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("a consumed code cannot be reused", async () => {
    await insertCode(ALEX, "222222");
    expect((await post("/api/auth/verify", { email: ALEX, code: "222222" })).status).toBe(200);
    const again = await post("/api/auth/verify", { email: ALEX, code: "222222" });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "code expired" });
  });

  it("an expired code is refused", async () => {
    await insertCode(ALEX, "333333", { expires_at: Date.now() - 1 });
    const res = await post("/api/auth/verify", { email: ALEX, code: "333333" });
    expect(await res.json()).toEqual({ error: "code expired" });
  });

  it("a newer code supersedes an older live one", async () => {
    await insertCode(ALEX, "444444", { created_at: Date.now() - 5 * 60 * 1000 });
    expect((await post("/api/auth/code", { email: ALEX })).status).toBe(200);
    const old = await post("/api/auth/verify", { email: ALEX, code: "444444" });
    expect(await old.json()).toEqual({ error: "code expired" });
    const fresh = await post("/api/auth/verify", { email: ALEX, code: lastCodeFor(ALEX) });
    expect(fresh.status).toBe(200);
  });

  it("a code for one email does not verify another", async () => {
    await insertCode(ALEX, "555555");
    const res = await post("/api/auth/verify", { email: "jordan@example.com", code: "555555" });
    expect(await res.json()).toEqual({ error: "code expired" });
  });

  it("stores only a hash, never the code", async () => {
    await post("/api/auth/code", { email: ALEX });
    const code = lastCodeFor(ALEX);
    const row = await env.DB.prepare("SELECT code_hash, expires_at, created_at FROM auth_codes WHERE email = ?1")
      .bind(ALEX)
      .first<{ code_hash: string; expires_at: number; created_at: number }>();
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.code_hash).not.toContain(code);
    expect(row!.expires_at - row!.created_at).toBe(CODE_TTL_MS);
  });

  it("a mail failure rolls the code back and reports 502", async () => {
    failNextSend(500);
    const res = await post("/api/auth/code", { email: ALEX });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "couldn't send the email" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_codes").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("never logs a code when a real mailer is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await post("/api/auth/code", { email: ALEX });
    const code = lastCodeFor(ALEX);
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).not.toContain(code);
    expect(printed).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    log.mockRestore();
  });
});

describe("POST /api/auth/signout", () => {
  it("deletes the session and clears the cookie", async () => {
    const cookie = await sessionCookieFor(ALEX);
    const out = await SELF.fetch(`${ORIGIN}/api/auth/signout`, { method: "POST", headers: { Cookie: cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/^tally_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
    const after = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it("requires a session", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/signout`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("does not renew a session it is signing out", async () => {
    // Created 50 days ago => inside the renewal window, so the sliding
    // renewal would otherwise append a fresh cookie over the cleared one.
    const token = await createSession(env.DB, ALEX, Date.now() - 50 * 24 * 60 * 60 * 1000);
    const cookie = `${SESSION_COOKIE}=${token}`;
    const out = await SELF.fetch(`${ORIGIN}/api/auth/signout`, { method: "POST", headers: { Cookie: cookie } });
    expect(out.status).toBe(204);
    const cookies = out.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("Max-Age=0");
    expect((await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

describe("GET /login", () => {
  it("serves the app shell, signed in or not", async () => {
    const anon = await SELF.fetch(`${ORIGIN}/login`);
    expect(anon.status).toBe(200);
    expect(await anon.text()).toContain('<div id="root">');
    const app = await SELF.fetch(`${ORIGIN}/login?next=/x`, { headers: { Cookie: await sessionCookieFor(ALEX) } });
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<div id="root">');
  });
});

describe("who may request a code (invite-only by default)", () => {
  beforeEach(() => installMailPatch());
  afterEach(() => removeMailPatch());

  const STRANGER = "stranger@example.com";

  it("refuses an unknown email with an explicit 'not invited' and sends nothing", async () => {
    const res = await post("/api/auth/code", { email: STRANGER });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not invited" });
    expect(outbox).toHaveLength(0);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_codes").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("allows the owner (ADMIN_EMAIL), case-insensitively", async () => {
    expect((await post("/api/auth/code", { email: "Admin@Example.com" })).status).toBe(200);
  });

  it("a users row alone no longer grants access", async () => {
    await env.DB.prepare("INSERT INTO users (email, display_name, accent_color, created_at) VALUES (?1, 'S', NULL, 1)")
      .bind(STRANGER)
      .run();
    expect((await post("/api/auth/code", { email: STRANGER })).status).toBe(403);
  });

  it("allows a member of any ledger, on either side", async () => {
    await insertLedger(ALEX, "zed@example.com");
    expect((await post("/api/auth/code", { email: "zed@example.com" })).status).toBe(200);
    expect((await post("/api/auth/code", { email: ALEX })).status).toBe(200);
  });

  it("allows an explicit invite", async () => {
    await env.DB.prepare("INSERT INTO invites (email, invited_by, created_at) VALUES (?1, ?2, ?3)")
      .bind(STRANGER, "admin@example.com", Date.now())
      .run();
    expect((await post("/api/auth/code", { email: STRANGER })).status).toBe(200);
  });

  it("open mode admits an unknown email; switching back closes the door again", async () => {
    await setSignupMode(env.DB, "open");
    expect((await post("/api/auth/code", { email: STRANGER })).status).toBe(200);
    await setSignupMode(env.DB, "invite");
    expect((await post("/api/auth/code", { email: "other@example.com" })).status).toBe(403);
  });
});

describe("rate limits on /api/auth/code", () => {
  beforeEach(async () => {
    installMailPatch();
    await insertLedger(ALEX, "jordan@example.com");
  });
  afterEach(() => removeMailPatch());

  it("per-email cooldown: a second request inside 60 s is 429 with retry_after", async () => {
    expect((await post("/api/auth/code", { email: ALEX })).status).toBe(200);
    const res = await post("/api/auth/code", { email: ALEX });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retry_after: number };
    expect(body.error).toBe("slow down");
    expect(body.retry_after).toBeGreaterThan(0);
    expect(body.retry_after).toBeLessThanOrEqual(RESEND_COOLDOWN_MS / 1000);
    expect(outbox).toHaveLength(1);
  });

  it("per-email hourly cap: the sixth code in an hour is refused even after the cooldown", async () => {
    const now = Date.now();
    for (let i = 0; i < PER_EMAIL_HOURLY; i++) {
      await insertCode(ALEX, "000000", { created_at: now - (i + 2) * 2 * 60 * 1000 });
    }
    const res = await post("/api/auth/code", { email: ALEX });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { retry_after: number };
    expect(body.retry_after).toBeGreaterThan(RESEND_COOLDOWN_MS / 1000);
  });

  it("global hourly cap protects the mail quota across all emails", async () => {
    const now = Date.now();
    for (let i = 0; i < GLOBAL_HOURLY; i++) {
      await insertCode(`u${i}@example.com`, "000000", { created_at: now - 5 * 60 * 1000 });
    }
    const res = await post("/api/auth/code", { email: ALEX }); // ALEX is unused so far
    expect(res.status).toBe(429);
    expect(outbox).toHaveLength(0);
  });

  it("limits are checked before the allow check, so a stranger can't probe past them", async () => {
    const now = Date.now();
    for (let i = 0; i < GLOBAL_HOURLY; i++) {
      await insertCode(`u${i}@example.com`, "000000", { created_at: now - 5 * 60 * 1000 });
    }
    const res = await post("/api/auth/code", { email: "stranger@example.com" });
    expect(res.status).toBe(429);
  });

  it("prunes codes older than a day on each request", async () => {
    await insertCode("old@example.com", "000000", { created_at: Date.now() - 25 * 60 * 60 * 1000 });
    await post("/api/auth/code", { email: ALEX });
    const old = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_codes WHERE email = 'old@example.com'").first<{ n: number }>();
    expect(old!.n).toBe(0);
  });
});
