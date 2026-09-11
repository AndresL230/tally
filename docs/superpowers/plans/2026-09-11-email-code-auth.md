# Email One-Time-Code Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloudflare Access with the app's own sign-in: a 6-digit code emailed through Resend, server-side sessions in D1, self-serve invites, an owner-only settings screen, and a sign-out.

**Architecture:** The Worker gains four D1 tables (`invites`, `auth_codes`, `sessions`, `settings`), two public routes that mint a session (`/api/auth/code`, `/api/auth/verify`), and a session-cookie `requireUser` middleware that replaces the Access-JWT one with the same signature. Mail goes through one `mailer.ts` (Resend when `RESEND_API_KEY` is set, console otherwise). The React client gains a `signin` boot phase (`SignInScreen`), an account area on the picker/rail (`AccountArea`), and an `OwnerScreen`, all ported from `mockup/signin-account.dc.html`.

**Tech Stack:** Cloudflare Workers + Hono 4, D1, React 19, Vite, Vitest with `@cloudflare/vitest-pool-workers` (tests run in real workerd; outbound `fetch` is patched in-test), Resend REST API.

**Spec:** `docs/superpowers/specs/2026-09-11-email-code-auth-design.md` — read it first; every task below argues from it. Visual reference: `mockup/signin-account.dc.html` (artboards 1a sign-in, 1b account area + owner settings, 1c desktop, 2a/2b emails).

## Global Constraints

- All timestamps are epoch **milliseconds** (`Date.now()`), matching the existing tables.
- Money rules are untouched; this plan never touches `expenses`/`settlements`.
- Only `POST /api/auth/code` and `POST /api/auth/verify` are reachable without a session. Everything else under `/api/*` stays behind `requireUser`.
- Codes and session tokens are **never stored in the clear** (sha256 in D1) and **never logged** when `RESEND_API_KEY` is set.
- Copy is verbatim from the spec/design: "Sign in", "We'll email you a six-digit code. There are no passwords.", "Check your email", "Not on the list yet", "That code isn't right. N tries left.", "Only people you or a ledger has added can sign in.", "Anyone can sign in and use your scan budget. Switch back when you're done.", etc.
- Design tokens come from `src/client/theme.ts` (`INK`, `PAPER`, `CARD`, `MUTED_1..6`, `ARCHIVO`, `MONO`, `SERIF`); never re-declare colors inline that the theme exports.
- Every task ends with `npm test` green (typecheck for worker, client, tests + vitest) and a commit. Commit messages: imperative, no prefix tags (match `git log`), ending with the session's Co-Authored-By trailer.
- Run tests with `npm test`; a single file with `npx vitest run test/integration/auth.test.ts`.
- Constants live in one place each: `src/worker/session.ts` (session TTLs), `src/worker/auth.ts` (code TTL, attempts, rate limits), `src/worker/receipts.ts` (scan caps).

---

## File map

**Create**
- `migrations/0003_auth.sql` — the four tables.
- `src/worker/session.ts` — token/cookie helpers + `sessions` table access.
- `src/worker/settings.ts` — `signup_mode` get/set.
- `src/worker/mailer.ts` — `sendMail(env, mail)`.
- `src/worker/emails.ts` — `signInCode(code)`, `invited(name)` templates.
- `src/worker/admin.ts` — `isAdmin`, `registerAdmin(app)`.
- `test/helpers/mail.ts` — Resend fetch patch + outbox + `lastCodeFor`.
- `test/integration/admin.test.ts`
- `src/client/screens/SignInScreen.tsx`
- `src/client/screens/OwnerScreen.tsx`
- `src/client/components/AccountArea.tsx`

**Rewrite**
- `src/worker/auth.ts` — `getUser`, `requireUser`, `registerAuth(app)`.
- `test/helpers/auth.ts` — session-cookie based.
- `test/integration/auth.test.ts`

**Modify**
- `src/worker/env.ts`, `src/worker/index.ts`, `src/worker/prefs.ts`, `src/worker/receipts.ts`
- `src/shared/types.ts`, `src/shared/prefs.ts` (comment only)
- `src/client/api.ts`, `src/client/App.tsx`, `src/client/screens/PickerScreen.tsx`, `src/client/components/DesktopShell.tsx`, `src/client/dev/Gallery.tsx`
- `wrangler.jsonc`, `vitest.config.ts`, `test/env.d.ts`, `test/apply-migrations.ts`, `test/helpers/fixtures.ts`, `test/integration/receipts.test.ts`, `test/integration/prefs.test.ts`, `package.json`, `.dev.vars.example`, `seed/seed.sql` (comment), `README.md`, `DEVIATIONS.md`

**Delete**
- `test/keys/` (three files), the `jose` dependency.

---

### Task 1: Schema, config, and test harness plumbing

**Files:**
- Create: `migrations/0003_auth.sql`
- Modify: `src/worker/env.ts`, `wrangler.jsonc`, `vitest.config.ts`, `test/apply-migrations.ts`, `test/env.d.ts`, `test/integration/schema.test.ts`, `.dev.vars.example`

**Interfaces:**
- Produces: tables `invites`, `auth_codes`, `sessions`, `settings` (DDL below); `Env.ADMIN_EMAIL?`, `Env.MAIL_FROM?`, `Env.RESEND_API_KEY?`. Access fields stay for now (removed in Task 3).

- [ ] **Step 1: Write the failing schema test**

Append to `test/integration/schema.test.ts`, inside the existing `describe("migrations from zero", ...)` block after the first `it(...)`:

```ts
  it("creates the auth tables (0003)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["invites", "auth_codes", "sessions", "settings"]) {
      expect(names).toContain(t);
    }
    // Only the newest code per email is live; the index makes that lookup cheap.
    const idx = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_auth_codes_email'",
    ).first<{ name: string }>();
    expect(idx?.name).toBe("idx_auth_codes_email");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/integration/schema.test.ts`
Expected: FAIL — `expected [...] to include 'invites'`.

- [ ] **Step 3: Write the migration**

Create `migrations/0003_auth.sql`:

```sql
-- Own auth (replaces Cloudflare Access). All timestamps are epoch ms.

-- Explicit invites. "May sign in" is the union of: ADMIN_EMAIL, a users row,
-- membership in any ledger, or a row here. Creating a ledger with a friend's
-- email is therefore already an invite; this table is for inviting someone
-- who has no ledger yet.
CREATE TABLE invites (
  email      TEXT PRIMARY KEY,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One-time codes, append-only; only the NEWEST row per email is live.
-- Stores sha256(id || ':' || code), never the code. Rows older than a day
-- are pruned opportunistically by the code endpoint.
CREATE TABLE auth_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,           -- created_at + 10 minutes
  attempts    INTEGER NOT NULL DEFAULT 0, -- dead at 5
  consumed_at INTEGER
);
CREATE INDEX idx_auth_codes_email ON auth_codes(email, created_at);

-- id = sha256(cookie token). The raw token exists only in the cookie.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_email ON sessions(email);

-- App-wide switches. signup_mode: 'invite' (default when absent) | 'open'.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 4: Clear the new tables between tests**

In `test/apply-migrations.ts`, extend the `beforeEach` batch (order doesn't matter for these — no foreign keys):

```ts
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM receipt_items"),
    env.DB.prepare("DELETE FROM expenses"), // references receipts + ledgers
    env.DB.prepare("DELETE FROM settlements"),
    env.DB.prepare("DELETE FROM receipts"),
    env.DB.prepare("DELETE FROM ledgers"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM invites"),
    env.DB.prepare("DELETE FROM auth_codes"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM settings"),
  ]);
});
```

- [ ] **Step 5: Add the new env fields and bindings**

`src/worker/env.ts` — add to `Env` (keep the Access fields for now; Task 3 removes them):

```ts
  /** The one owner: admin routes, always allowed to sign in. Plain var. */
  ADMIN_EMAIL?: string;
  /** "Tally <sign-in@tally.andresl.dev>"; plain var. */
  MAIL_FROM?: string;
  /** Worker secret. Absent in local dev => codes print to the console. */
  RESEND_API_KEY?: string;
```

`wrangler.jsonc` — in `vars`, after `AI_GATEWAY_ID`:

```jsonc
    // Own auth: the owner (admin routes; always allowed to sign in) and the
    // From header for sign-in / invite mail. RESEND_API_KEY is a secret.
    "ADMIN_EMAIL": "andreslopez.23061@gmail.com",
    "MAIL_FROM": "Tally <sign-in@tally.andresl.dev>"
```

and change the trailing comment to `// Secrets (never in this file): ANTHROPIC_API_KEY, RESEND_API_KEY via \`wrangler secret put\``.

`vitest.config.ts` — inside `miniflare.bindings`, add:

```ts
            // Own auth. RESEND_API_KEY is deliberately NOT bound: the mailer
            // then logs instead of fetching, so no suite touches the network.
            // Auth tests set it via env mutation and patch fetch (helpers/mail).
            ADMIN_EMAIL: "admin@example.com",
            MAIL_FROM: "Tally <sign-in@tally.test>",
```

`.dev.vars.example` — replace the whole file:

```
# Copy to .dev.vars for local development (never committed, never deployed).
#
# Nothing here is required. Without RESEND_API_KEY the Worker prints sign-in
# codes and invite mail to the wrangler terminal instead of sending them.
#
# ADMIN_EMAIL overrides the wrangler.jsonc owner locally so the seeded viewer
# (alex@example.com) sees the owner settings screen.
ADMIN_EMAIL=alex@example.com
# RESEND_API_KEY=re_...
```

- [ ] **Step 6: Run the test to verify it passes, then the whole suite**

Run: `npx vitest run test/integration/schema.test.ts` → PASS.
Run: `npm test` → all green (nothing else changed behavior).

- [ ] **Step 7: Commit**

```bash
git add migrations/0003_auth.sql src/worker/env.ts wrangler.jsonc vitest.config.ts test/apply-migrations.ts test/integration/schema.test.ts .dev.vars.example
git commit -m "Add the auth tables and owner/mail configuration"
```

---

### Task 2: Mailer, email templates, and the signup-mode setting

**Files:**
- Create: `src/worker/mailer.ts`, `src/worker/emails.ts`, `src/worker/settings.ts`, `test/unit/emails.test.ts`, `test/integration/mailer.test.ts`

**Interfaces:**
- Produces:
  - `sendMail(env: Env, mail: { to: string; subject: string; html: string; text: string }): Promise<void>` — throws on a non-2xx from Resend; logs and returns when `RESEND_API_KEY` is unset.
  - `signInCode(code: string): MailContent` and `invited(inviterName: string | null): MailContent` where `MailContent = { subject: string; html: string; text: string }`.
  - `groupCode(code: string): string` → `"482 913"`.
  - `getSignupMode(db: D1Database): Promise<"invite" | "open">`, `setSignupMode(db, mode): Promise<void>`, type `SignupMode`.

- [ ] **Step 1: Write the failing template tests**

Create `test/unit/emails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupCode, invited, signInCode } from "../../src/worker/emails";

describe("sign-in code email", () => {
  it("puts the grouped code in the subject, the html, and the text", () => {
    const m = signInCode("482913");
    expect(m.subject).toBe("Your Tally code: 482 913");
    expect(m.html).toContain("482 913");
    expect(m.text).toContain("Your code: 482 913");
    expect(m.text).toContain("It works for 10 minutes and can be used once.");
  });

  it("has no links — the user types the code", () => {
    const m = signInCode("000001");
    expect(m.html).not.toMatch(/<a\s/i);
    expect(m.text).not.toContain("http");
  });

  it("uses only email-safe fonts and a hosted logo image", () => {
    const m = signInCode("123456");
    expect(m.html).not.toContain("<svg");
    expect(m.html).toContain('src="https://tally.andresl.dev/icon-192.png"');
    expect(m.html).not.toMatch(/Archivo|Instrument Serif|IBM Plex/);
  });
});

describe("invite email", () => {
  it("names the ledger partner when there is one", () => {
    const m = invited("Alex Rivera");
    expect(m.subject).toBe("Alex Rivera started a ledger with you on Tally");
    expect(m.html).toContain("Alex Rivera started a ledger with you.");
    expect(m.text).toContain("Alex Rivera started a ledger with you.");
  });

  it("uses the owner variant when the inviter has no name", () => {
    const m = invited(null);
    expect(m.subject).toBe("You've been invited to Tally");
    expect(m.html).toContain("You've been invited to Tally.");
  });

  it("links to /login exactly once and escapes the inviter's name", () => {
    const m = invited("<b>Mallory</b>");
    expect(m.html.match(/https:\/\/tally\.andresl\.dev\/login/g)?.length).toBe(1);
    expect(m.html).not.toContain("<b>Mallory</b>");
    expect(m.html).toContain("&lt;b&gt;Mallory&lt;/b&gt;");
    expect(m.text).toContain("Open Tally: https://tally.andresl.dev/login");
  });
});

describe("groupCode", () => {
  it("splits six digits as 3 + 3", () => {
    expect(groupCode("482913")).toBe("482 913");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/emails.test.ts`
Expected: FAIL — cannot resolve `../../src/worker/emails`.

- [ ] **Step 3: Write the templates**

Create `src/worker/emails.ts` (ported from artboards 2a/2b; email-safe: inline styles, system fonts, a hosted PNG logo because Gmail strips inline SVG):

```ts
// The two transactional emails, ported from the Claude Design artboards
// (mockup/signin-account.dc.html, 2a/2b). Email-safe on purpose: inline
// styles, system font stacks, no web fonts, and the logo as a hosted PNG —
// Gmail strips inline SVG. Every template has an HTML and a plain-text body.

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const APP_URL = "https://tally.andresl.dev";
const LOGIN_URL = `${APP_URL}/login`;

const SANS = "Helvetica,Arial,sans-serif";
const MONO = "'Courier New',monospace";

const LOGO =
  `<img src="${APP_URL}/icon-192.png" width="24" height="24" alt="" ` +
  `style="display:inline-block;vertical-align:middle;border-radius:5px">` +
  ` <span style="letter-spacing:.08em;color:#0a8a9b;font:600 13px ${MONO};vertical-align:middle">Tally</span>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(inner: string, align: "center" | "left"): string {
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">` +
    `<div style="max-width:480px;margin:0 auto;padding:30px 24px 28px;text-align:${align};` +
    `font-family:${SANS};color:#211f1c">${inner}</div></body></html>`
  );
}

/** "482913" -> "482 913" (the way the code is shown everywhere). */
export function groupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function signInCode(code: string): MailContent {
  const shown = groupCode(code);
  return {
    subject: `Your Tally code: ${shown}`,
    html: shell(
      `<div>${LOGO}</div>` +
        `<div style="margin-top:22px;background:#fbfaf6;border:1px solid rgba(0,0,0,.09);border-radius:6px;` +
        `padding:26px 10px;font:600 40px ${MONO};color:#211f1c;letter-spacing:.04em">${shown}</div>` +
        `<div style="margin-top:16px;font:400 15px ${SANS};line-height:1.5;color:#4a453d">` +
        `This code works for 10 minutes and can be used once.</div>` +
        `<div style="margin-top:26px;font:400 12px ${SANS};line-height:1.5;color:#8a857c">` +
        `If you didn't ask for this, you can ignore it — nobody can sign in without the code.</div>`,
      "center",
    ),
    text:
      `TALLY\n\nYour code: ${shown}\n\nIt works for 10 minutes and can be used once.\n\n` +
      `If you didn't ask for this, you can ignore it —\nnobody can sign in without the code.\n`,
  };
}

export function invited(inviterName: string | null): MailContent {
  const safe = inviterName ? escapeHtml(inviterName) : null;
  const heading = safe ? `${safe} started a ledger with you.` : "You've been invited to Tally.";
  const headingText = inviterName ? `${inviterName} started a ledger with you.` : "You've been invited to Tally.";
  const subject = inviterName ? `${inviterName} started a ledger with you on Tally` : "You've been invited to Tally";
  const pitch = "One ledger, two people. Photograph the receipt, tap what was yours, settle when it suits you.";
  const footer = "You'll sign in with this email address and a one-time code — no password.";
  return {
    subject,
    html: shell(
      `<div>${LOGO}</div>` +
        `<div style="margin-top:24px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#211f1c">${heading}</div>` +
        `<div style="margin-top:14px;font:400 15px ${SANS};line-height:1.55;color:#4a453d">${pitch}</div>` +
        `<div style="margin-top:26px"><a href="${LOGIN_URL}" style="display:inline-block;background:#0a8a9b;` +
        `color:#ffffff;font:600 15px ${SANS};padding:16px 28px;border-radius:14px;text-decoration:none">Open Tally</a></div>` +
        `<div style="margin-top:26px;font:400 12px ${SANS};line-height:1.5;color:#8a857c">${footer}</div>`,
      "left",
    ),
    text: `TALLY\n\n${headingText}\n\n${pitch}\n\nOpen Tally: ${LOGIN_URL}\n\n${footer}\n`,
  };
}
```

- [ ] **Step 4: Run the template tests**

Run: `npx vitest run test/unit/emails.test.ts` → PASS.

- [ ] **Step 5: Write the failing mailer tests**

Create `test/integration/mailer.test.ts` (integration because it needs the real `env` object and `console` of the worker isolate):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { sendMail } from "../../src/worker/mailer";

const mutableEnv = env as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;

afterEach(() => {
  delete mutableEnv["RESEND_API_KEY"];
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const MAIL = { to: "alex@example.com", subject: "Your Tally code: 482 913", html: "<p>482 913</p>", text: "Your code: 482 913" };

describe("sendMail", () => {
  it("without RESEND_API_KEY: logs the subject and text, touches no network", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.fetch = (async () => {
      throw new Error("network must not be used");
    }) as typeof fetch;
    await sendMail(env, MAIL);
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toContain("Your Tally code: 482 913");
    expect(printed).toContain("alex@example.com");
  });

  it("with RESEND_API_KEY: POSTs to Resend with the bearer key and From, and never logs", async () => {
    mutableEnv["RESEND_API_KEY"] = "re_test";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      seen = { url: req.url, auth: req.headers.get("Authorization"), body: (await req.json()) as Record<string, unknown> };
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await sendMail(env, MAIL);
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect(seen!.auth).toBe("Bearer re_test");
    expect(seen!.body).toMatchObject({ from: env.MAIL_FROM, to: ["alex@example.com"], subject: MAIL.subject, html: MAIL.html, text: MAIL.text });
    expect(log).not.toHaveBeenCalled();
  });

  it("with RESEND_API_KEY: a non-2xx from Resend throws", async () => {
    mutableEnv["RESEND_API_KEY"] = "re_test";
    globalThis.fetch = (async () => new Response("nope", { status: 422 })) as typeof fetch;
    await expect(sendMail(env, MAIL)).rejects.toThrow(/resend 422/);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/integration/mailer.test.ts` → FAIL, cannot resolve `mailer`.

- [ ] **Step 7: Write the mailer and the settings module**

Create `src/worker/mailer.ts`:

```ts
import type { Env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Tally <sign-in@tally.andresl.dev>";

/**
 * The one door mail leaves through. With RESEND_API_KEY set it POSTs to
 * Resend and throws on a non-2xx. Without it (local dev only) it prints the
 * message to the terminal and returns — the text body carries the code, and
 * this is the ONLY condition under which a code is ever logged.
 */
export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] ${mail.subject} → ${mail.to}\n${mail.text}`);
    return;
  }
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? DEFAULT_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
```

Create `src/worker/settings.ts`:

```ts
// App-wide switches in the `settings` key/value table.

export type SignupMode = "invite" | "open";

/** 'invite' unless the owner has explicitly opened sign-up. */
export async function getSignupMode(db: D1Database): Promise<SignupMode> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'signup_mode'")
    .first<{ value: string }>();
  return row?.value === "open" ? "open" : "invite";
}

export async function setSignupMode(db: D1Database, mode: SignupMode): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('signup_mode', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`,
    )
    .bind(mode)
    .run();
}
```

- [ ] **Step 8: Run both test files, then the suite**

Run: `npx vitest run test/unit/emails.test.ts test/integration/mailer.test.ts` → PASS.
Run: `npm test` → green.

- [ ] **Step 9: Commit**

```bash
git add src/worker/mailer.ts src/worker/emails.ts src/worker/settings.ts test/unit/emails.test.ts test/integration/mailer.test.ts
git commit -m "Add the mailer, the two email templates, and the signup-mode setting"
```

---

### Task 3: Sessions replace Access — `session.ts`, `requireUser`, test helper, delete jose

This is the cutover inside the test suite: after this task every integration test authenticates with a session cookie instead of a forged JWT. Do it in one task so the suite is never half-migrated.

**Files:**
- Create: `src/worker/session.ts`
- Rewrite: `src/worker/auth.ts`, `test/helpers/auth.ts`, `test/integration/auth.test.ts`
- Modify: `src/worker/env.ts`, `wrangler.jsonc`, `vitest.config.ts`, `test/env.d.ts`, `package.json`, `README.md` (one line, so the build is honest — full rewrite in Task 11)
- Delete: `test/keys/jwk-private.json`, `test/keys/jwks-public.json`, `test/keys/README.md`

**Interfaces:**
- Produces (`src/worker/session.ts`):
  - `SESSION_COOKIE = "tally_session"`, `SESSION_TTL_MS` (90 d), `RENEW_BELOW_MS` (45 d), `TOUCH_EVERY_MS` (1 h)
  - `sha256Hex(text: string): Promise<string>`
  - `randomToken(): string` (32 random bytes, base64url)
  - `cookieValue(cookieHeader: string | null, name: string): string | null`
  - `sessionCookie(token: string, secure: boolean, maxAgeSeconds?: number): string`, `clearedSessionCookie(secure: boolean): string`
  - `createSession(db, email, now?): Promise<string>` → the raw token
  - `findSession(db, token, now?): Promise<SessionRow | null>`
  - `deleteSession(db, token): Promise<void>`
  - `touchSession(db, row, now?): Promise<number | null>` → new `expires_at` when renewed, else `null`
- Produces (`src/worker/auth.ts`): `getUser(request, env): Promise<{ email: string } | null>` (same signature as before), `requireUser: MiddlewareHandler<AppContext>`, `isSecure(request): boolean`.
- Produces (`test/helpers/auth.ts`): `sessionCookieFor(email): Promise<string>` (a `Cookie` header value), `authedFetch(path, email, init?)`, `authedJson<T>(path, email, init?)` — same signatures as today.

- [ ] **Step 1: Write the session module**

Create `src/worker/session.ts`:

```ts
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
```

- [ ] **Step 2: Rewrite the test helper to mint sessions**

Replace `test/helpers/auth.ts` entirely:

```ts
import { env, SELF } from "cloudflare:test";
import { SESSION_COOKIE, createSession } from "../../src/worker/session";

/** Mint a real session row for `email`; returns the Cookie header value. */
export async function sessionCookieFor(email: string): Promise<string> {
  const token = await createSession(env.DB, email.toLowerCase());
  return `${SESSION_COOKIE}=${token}`;
}

/** SELF.fetch as `email`: a fresh, valid session cookie on every call. */
export async function authedFetch(
  path: string,
  email: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await sessionCookieFor(email));
  return await SELF.fetch(`https://tally.test${path}`, { ...init, headers });
}

export async function authedJson<T>(
  path: string,
  email: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(path, email, init);
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Write the new auth tests (sessions half)**

Replace `test/integration/auth.test.ts` entirely (the code/verify tests are added in Tasks 4–5):

```ts
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
```

Note: the root/`/login` tests serve real files from `dist/client`, so Step 6 makes `npm test` build first. If `welcome.html`'s `<title>` changes, update the "a private ledger for two" assertion.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run test/integration/auth.test.ts`
Expected: FAIL — the middleware still verifies Access JWTs, so every session-cookie request is 401.

- [ ] **Step 5: Rewrite `src/worker/auth.ts` (middleware half)**

Replace the file entirely (Task 4 adds `registerAuth` to it):

```ts
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
```

- [ ] **Step 6: Remove Access from config, env, tests, and dependencies**

`src/worker/env.ts` — delete `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_JWKS`, `DEV_ALLOW_USER` and their comments. The interface becomes:

```ts
export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  /** The one owner: admin routes, always allowed to sign in. Plain var. */
  ADMIN_EMAIL?: string;
  /** "Tally <sign-in@tally.andresl.dev>"; plain var. */
  MAIL_FROM?: string;
  /** Worker secret. Absent in local dev => codes print to the console. */
  RESEND_API_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** Worker secret. The client never sees or calls the model directly. */
  ANTHROPIC_API_KEY?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { email: string };
};
```

`wrangler.jsonc` — delete the `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` entries and their two comment lines.

`vitest.config.ts` — delete the `jwks` read (`const jwks = fs.readFileSync(...)`), the `ACCESS_JWKS`, `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `DEV_ALLOW_USER` bindings and their comments, and the whole `onUnhandledError(...)` method (it existed only for jose). Keep `fs` imported — it's still used for `mkdirSync`.

`test/env.d.ts` — remove `ACCESS_JWKS: string;`.

Delete the keys: `git rm -r test/keys`.

Remove jose: `npm uninstall jose` (updates `package.json` and `package-lock.json`). Then `grep -rn "jose" src test vitest.config.ts` must print nothing.

`package.json` — the asset-serving routes are now under test, so build before testing: change the `test` script to `"test": "npm run build && npm run typecheck && vitest run"`.

`README.md` — replace the "Cloudflare Access (One-Time PIN)" stack bullet with:

```md
- **Own sign-in** — a 6-digit code emailed through Resend, sessions in D1
  (`src/worker/auth.ts`, `session.ts`). See "Sign-in" below.
```

and the vitest bullet's "the only fakes are Access JWTs (signed with a committed test-only key) and the model API" with "the only fakes are outbound mail (Resend) and the model API". Task 11 rewrites the rest.

- [ ] **Step 7: Run the auth tests, then the whole suite**

Run: `npm run build && npx vitest run test/integration/auth.test.ts` → PASS.
Run: `npm test` → green (it now builds first). Every other integration file goes through `authedFetch`, which now mints sessions, so nothing else should change. If `receipts.test.ts` fails on "unmocked outbound fetch", that is the fetch patch intercepting a call it shouldn't see — there are none in this task; investigate rather than loosen the patch.

- [ ] **Step 8: Commit**

```bash
git add -A src/worker/session.ts src/worker/auth.ts src/worker/env.ts wrangler.jsonc vitest.config.ts test/env.d.ts test/helpers/auth.ts test/integration/auth.test.ts test/keys package.json package-lock.json README.md
git commit -m "Replace Access JWT verification with D1 sessions"
```

---

### Task 4: `/api/auth/code`, `/api/auth/verify`, `/api/auth/signout`, and `/login`

**Files:**
- Modify: `src/worker/auth.ts` (add `registerAuth`), `src/worker/index.ts`
- Create: `test/helpers/mail.ts`
- Modify: `test/integration/auth.test.ts` (append), `test/helpers/fixtures.ts` (add `insertCode`)

**Interfaces:**
- Produces:
  - `registerAuth(app: Hono<AppContext>): void` — registers the three routes. Must be called **before** `app.use("/api/*", requireUser)`.
  - `randomCode(): string` (6 digits, uniform), constants `CODE_TTL_MS`, `MAX_ATTEMPTS`.
  - `test/helpers/mail.ts`: `installMailPatch(): void`, `removeMailPatch(): void`, `outbox: SentMail[]`, `lastCodeFor(email: string): string`, `failNextSend(status: number): void`.
  - `test/helpers/fixtures.ts`: `insertCode(email, code, opts?: { created_at?: number; expires_at?: number; attempts?: number; consumed_at?: number | null }): Promise<string>` → the row id.
- The allow check and rate limits are **Task 5**; in this task `/api/auth/code` sends to any well-formed email.

- [ ] **Step 1: Write the mail test helper**

Create `test/helpers/mail.ts`:

```ts
// Resend, intercepted. SELF's worker runs in this isolate, so patching
// globalThis.fetch captures its outbound mail. Same shape as the gateway
// patch in receipts.test.ts: anything un-mocked throws.

import { env } from "cloudflare:test";

export interface SentMail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export const outbox: SentMail[] = [];

const RESEND_URL = "https://api.resend.com/emails";
const mutableEnv = env as unknown as Record<string, unknown>;
let realFetch: typeof fetch | null = null;
let failStatus: number | null = null;

/** Set RESEND_API_KEY (so the real send path runs) and capture every send. */
export function installMailPatch(): void {
  mutableEnv["RESEND_API_KEY"] = "re_test";
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as RequestInfo, init);
    if (req.url !== RESEND_URL) throw new Error(`unmocked outbound fetch: ${req.url}`);
    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      return new Response(JSON.stringify({ message: "nope" }), { status });
    }
    const body = (await req.json()) as SentMail;
    outbox.push(body);
    return new Response(JSON.stringify({ id: `msg_${outbox.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

export function removeMailPatch(): void {
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = null;
  failStatus = null;
  delete mutableEnv["RESEND_API_KEY"];
  outbox.length = 0;
}

/** The next send returns this HTTP status instead of succeeding. */
export function failNextSend(status: number): void {
  failStatus = status;
}

/** The six digits from the latest code email sent to `email`. */
export function lastCodeFor(email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to.includes(email));
  if (!mail) throw new Error(`no mail sent to ${email}`);
  const m = /Your code: (\d{3}) (\d{3})/.exec(mail.text);
  if (!m) throw new Error(`no code in mail to ${email}: ${mail.text}`);
  return `${m[1]}${m[2]}`;
}
```

- [ ] **Step 2: Add the code fixture**

Append to `test/helpers/fixtures.ts`:

```ts
export interface CodeFixture {
  created_at?: number;
  expires_at?: number;
  attempts?: number;
  consumed_at?: number | null;
}

/** Insert an auth_codes row for a KNOWN code (hashed the way the worker does). */
export async function insertCode(email: string, code: string, f: CodeFixture = {}): Promise<string> {
  const id = uid("code");
  const created = f.created_at ?? Date.now();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}:${code}`));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    `INSERT INTO auth_codes (id, email, code_hash, created_at, expires_at, attempts, consumed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, email, hash, created, f.expires_at ?? created + 10 * 60 * 1000, f.attempts ?? 0, f.consumed_at ?? null)
    .run();
  return id;
}
```

- [ ] **Step 3: Write the failing endpoint tests**

Append to `test/integration/auth.test.ts` (add the imports at the top of the file: `afterEach, beforeEach` from vitest; `insertCode` from fixtures; `failNextSend, installMailPatch, lastCodeFor, outbox, removeMailPatch` from `../helpers/mail`; `CODE_TTL_MS, MAX_ATTEMPTS` from `../../src/worker/auth`):

```ts
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
  beforeEach(() => installMailPatch());
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
```

Add `vi` to the vitest import at the top of the file.

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run test/integration/auth.test.ts` → the new describes FAIL with 404s (routes don't exist) / the `/login` one gets a 302.

- [ ] **Step 5: Add `registerAuth` to `src/worker/auth.ts`**

Add these imports at the top of `src/worker/auth.ts`:

```ts
import type { Hono } from "hono";
import { looksLikeEmail } from "../shared/prefs";
import { ValidationError, assertString, readJson } from "./validate";
import { sendMail } from "./mailer";
import { signInCode } from "./emails";
import {
  clearedSessionCookie,
  createSession,
  deleteSession,
  sha256Hex,
} from "./session";
```

(merge with the existing `./session` import so each name is imported once), then append:

```ts
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

    // Only the newest row per email is live (rowid breaks same-ms ties).
    const row = await db
      .prepare("SELECT * FROM auth_codes WHERE email = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(email)
      .first<CodeRow>();
    const dead = !row || row.consumed_at !== null || row.expires_at <= now || row.attempts >= MAX_ATTEMPTS;
    if (dead) return c.json({ error: "code expired" }, 400);

    if ((await sha256Hex(`${row.id}:${code}`)) !== row.code_hash) {
      const attempts = row.attempts + 1;
      await db.prepare("UPDATE auth_codes SET attempts = ?2 WHERE id = ?1").bind(row.id, attempts).run();
      if (attempts >= MAX_ATTEMPTS) return c.json({ error: "code expired" }, 400);
      return c.json({ error: "wrong code", tries_left: MAX_ATTEMPTS - attempts }, 400);
    }

    await db.batch([
      db.prepare("UPDATE auth_codes SET consumed_at = ?2 WHERE id = ?1").bind(row.id, now),
      // Housekeeping: expired sessions go when a new one is minted.
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    ]);
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
```

- [ ] **Step 6: Wire `index.ts`**

Replace the top of `src/worker/index.ts` down to `registerPrefs(app);` with:

```ts
import { Hono } from "hono";
import type { AppContext } from "./env";
import { getUser, registerAuth, requireUser } from "./auth";
import { ledgerDetail, ledgerForMember, listLedgers } from "./db";
import { registerMutations } from "./mutations";
import { registerReceipts } from "./receipts";
import { registerPrefs } from "./prefs";

const app = new Hono<AppContext>();

// Order matters: the two routes that MINT a session are registered first,
// so the session check below never sees them (Hono runs a matching route
// before middleware registered after it). Everything else under /api/*
// requires a live session.
registerAuth(app);
app.use("/api/*", requireUser);

registerMutations(app);
registerReceipts(app);
registerPrefs(app);
```

and replace the `/login` handler:

```ts
// /login serves the app shell; the client sees the 401 from /api/me and
// renders the sign-in screen. (welcome.html links here.)
app.get("/login", (c) => {
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)));
});
```

Update the root-route comment from "(Access cookie, verified for real — or the localhost dev bypass)" to "(a live session cookie)".

- [ ] **Step 7: Run the auth tests, then the suite**

Run: `npx vitest run test/integration/auth.test.ts` → PASS.
Run: `npm test` → green.

- [ ] **Step 8: Commit**

```bash
git add src/worker/auth.ts src/worker/index.ts test/helpers/mail.ts test/helpers/fixtures.ts test/integration/auth.test.ts
git commit -m "Mint sessions from an emailed one-time code; add sign-out and /login"
```

---

### Task 5: Who may request a code, and how often

**Files:**
- Modify: `src/worker/auth.ts`, `test/integration/auth.test.ts` (append)

**Interfaces:**
- Produces: `mayRequestCode(env: Env, email: string): Promise<boolean>`; constants `RESEND_COOLDOWN_MS` (60 s), `PER_EMAIL_HOURLY` (5), `GLOBAL_HOURLY` (30).
- `/api/auth/code` now returns `403 { error: "not invited" }` and `429 { error: "slow down", retry_after }` per the spec, checked in the order: global cap → per-email cooldown → per-email hourly cap → allow check.

- [ ] **Step 1: Write the failing tests**

Append to `test/integration/auth.test.ts` (imports: `insertLedger` from fixtures — already imported `insertCode`; `setSignupMode` from `../../src/worker/settings`; `GLOBAL_HOURLY, PER_EMAIL_HOURLY, RESEND_COOLDOWN_MS` from `../../src/worker/auth`):

```ts
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

  it("allows anyone with a users row", async () => {
    await env.DB.prepare("INSERT INTO users (email, display_name, accent_color, created_at) VALUES (?1, 'S', NULL, 1)")
      .bind(STRANGER)
      .run();
    expect((await post("/api/auth/code", { email: STRANGER })).status).toBe(200);
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
  beforeEach(() => installMailPatch());
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
```

Also fix the earlier Task 4 test "a newer code supersedes an older live one": its `insertCode` is 5 minutes old, which is outside the 60 s cooldown, so it still passes. The Task 4 "emails a code…" tests use `ALEX`, who has no ledger yet — after this task they'd get `403`. Update `installMailPatch()` calls in the Task 4 `describe` to also allow ALEX: add to that `beforeEach`:

```ts
  beforeEach(async () => {
    installMailPatch();
    await insertLedger(ALEX, "jordan@example.com"); // ALEX is a ledger member => allowed
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/integration/auth.test.ts` → the allow/rate-limit tests FAIL (200 where 403/429 expected).

- [ ] **Step 3: Implement the allow check and the limits**

In `src/worker/auth.ts`, add the import `import { getSignupMode } from "./settings";`, then add above `registerAuth`:

```ts
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
```

Then in the `/api/auth/code` handler, between the housekeeping `DELETE` and `const code = randomCode();`, insert:

```ts
    const limited = await rateLimited(db, email, now);
    if (limited) return c.json({ error: "slow down", retry_after: limited.retryAfter }, 429);
    if (!(await mayRequestCode(c.env, email))) return c.json({ error: "not invited" }, 403);
```

- [ ] **Step 4: Run the auth tests, then the suite**

Run: `npx vitest run test/integration/auth.test.ts` → PASS.
Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth.ts test/integration/auth.test.ts
git commit -m "Gate code requests: invite-only allow check and send rate limits"
```

---

### Task 6: Scan caps on receipt upload

**Files:**
- Modify: `src/worker/receipts.ts`, `test/helpers/fixtures.ts` (add `insertReceipt`), `test/integration/receipts.test.ts` (append)

**Interfaces:**
- Produces: constants `PER_USER_DAILY_UPLOADS = 30`, `GLOBAL_DAILY_UPLOADS = 200` exported from `receipts.ts`; `insertReceipt(f: { ledger_id: string; uploaded_by: string; created_at?: number; sha256?: string; status?: string }): Promise<string>` in fixtures.

- [ ] **Step 1: Add the receipt fixture**

Append to `test/helpers/fixtures.ts`:

```ts
export interface ReceiptFixture {
  ledger_id: string;
  uploaded_by: string;
  created_at?: number;
  sha256?: string;
  status?: string;
}

/** A bare receipt row (no image, no items) — enough for counting. */
export async function insertReceipt(f: ReceiptFixture): Promise<string> {
  const id = uid("rcpt");
  await env.DB.prepare(
    `INSERT INTO receipts (id, ledger_id, r2_key, sha256, status, uploaded_by, created_at)
     VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, f.ledger_id, f.sha256 ?? uid("sha"), f.status ?? "posted", f.uploaded_by, f.created_at ?? Date.now())
    .run();
  return id;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/integration/receipts.test.ts` (add `insertReceipt` to the fixtures import and `GLOBAL_DAILY_UPLOADS, PER_USER_DAILY_UPLOADS` from `../../src/worker/receipts`):

```ts
describe("daily scan caps", () => {
  it("the 31st upload by one person in 24 h is refused", async () => {
    const ledgerId = await insertLedger(ALEX, JORDAN);
    for (let i = 0; i < PER_USER_DAILY_UPLOADS; i++) {
      await insertReceipt({ ledger_id: ledgerId, uploaded_by: ALEX });
    }
    const res = await uploadReceipt(ledgerId, ALEX, fakeImage("capped"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily scan limit reached" });
    // The other member is unaffected.
    expect((await uploadReceipt(ledgerId, JORDAN, fakeImage("jordan-ok"))).status).toBe(201);
  });

  it("uploads older than 24 h do not count", async () => {
    const ledgerId = await insertLedger(ALEX, JORDAN);
    const old = Date.now() - 25 * 60 * 60 * 1000;
    for (let i = 0; i < PER_USER_DAILY_UPLOADS; i++) {
      await insertReceipt({ ledger_id: ledgerId, uploaded_by: ALEX, created_at: old });
    }
    expect((await uploadReceipt(ledgerId, ALEX, fakeImage("fresh"))).status).toBe(201);
  });

  it("a duplicate of an existing receipt is served even when capped", async () => {
    const ledgerId = await insertLedger(ALEX, JORDAN);
    const bytes = fakeImage("dup");
    const first = await uploadReceipt(ledgerId, ALEX, bytes);
    expect(first.status).toBe(201);
    for (let i = 0; i < PER_USER_DAILY_UPLOADS; i++) {
      await insertReceipt({ ledger_id: ledgerId, uploaded_by: ALEX });
    }
    const again = await uploadReceipt(ledgerId, ALEX, bytes);
    expect(again.status).toBe(200);
  });

  it("the global cap applies across everyone", async () => {
    const ledgerId = await insertLedger(ALEX, JORDAN);
    for (let i = 0; i < GLOBAL_DAILY_UPLOADS; i++) {
      await insertReceipt({ ledger_id: ledgerId, uploaded_by: `u${i}@example.com` });
    }
    const res = await uploadReceipt(ledgerId, ALEX, fakeImage("global"));
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run test/integration/receipts.test.ts -t "daily scan caps"` → FAIL (201 where 429 expected).

- [ ] **Step 4: Implement the caps**

In `src/worker/receipts.ts`, next to `const MAX_BYTES = 8_000_000;` add:

```ts
// Scan caps. Upload is the choke point (extract is once-per-image), and the
// caps exist so that opening sign-up can't turn the model key into a public
// resource. Counted on receipts.uploaded_by / created_at; dedupes never count.
export const PER_USER_DAILY_UPLOADS = 30;
export const GLOBAL_DAILY_UPLOADS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
```

Then in the upload route, after the `if (existing) { ... }` block and before `// Same client id with different bytes is a collision`, insert:

```ts
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
```

- [ ] **Step 5: Run the receipts tests, then the suite**

Run: `npx vitest run test/integration/receipts.test.ts` → PASS.
Run: `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/worker/receipts.ts test/helpers/fixtures.ts test/integration/receipts.test.ts
git commit -m "Cap receipt uploads per person and globally per day"
```

---

### Task 7: Admin routes, `is_admin`, and the invite email on ledger creation

**Files:**
- Create: `src/worker/admin.ts`, `test/integration/admin.test.ts`
- Modify: `src/worker/index.ts` (`/api/me`, register admin), `src/worker/prefs.ts` (invite mail), `src/shared/types.ts`, `test/integration/prefs.test.ts` (append)

**Interfaces:**
- Produces:
  - `isAdmin(env: Env, email: string): boolean`
  - `registerAdmin(app: Hono<AppContext>): void` — `GET /api/admin`, `PUT /api/admin/signup-mode`, `POST /api/admin/invites`, `DELETE /api/admin/invites/:email`; all `403 { error: "forbidden" }` for non-owners.
  - `UserPrefs.is_admin: boolean`; new shared types `SignupMode`, `PendingInvite { email: string; invited_at: number }`, `AdminState { signup_mode: SignupMode; pending: PendingInvite[] }`.
  - `GET /api/me` returns `is_admin`.
  - `POST /api/ledgers` sends `invited(creatorName)` to the friend when the pair is new **and** the friend has no `users` row; a mail failure is logged, never fails the request.

- [ ] **Step 1: Write the failing admin tests**

Create `test/integration/admin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { authedFetch, authedJson } from "../helpers/auth";
import { ALEX, JORDAN } from "../helpers/fixtures";
import { installMailPatch, outbox, removeMailPatch } from "../helpers/mail";
import type { AdminState } from "../../src/shared/types";

const ADMIN = "admin@example.com"; // vitest.config.ts binds ADMIN_EMAIL

function json(method: string, path: string, email: string, body?: unknown): Promise<Response> {
  return authedFetch(path, email, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => installMailPatch());
afterEach(() => removeMailPatch());

describe("/api/me is_admin", () => {
  it("is true only for ADMIN_EMAIL", async () => {
    expect((await authedJson<{ is_admin: boolean }>("/api/me", ADMIN)).is_admin).toBe(true);
    expect((await authedJson<{ is_admin: boolean }>("/api/me", ALEX)).is_admin).toBe(false);
  });
});

describe("admin routes", () => {
  it("are forbidden for everyone but the owner", async () => {
    expect((await json("GET", "/api/admin", ALEX)).status).toBe(403);
    expect((await json("PUT", "/api/admin/signup-mode", ALEX, { mode: "open" })).status).toBe(403);
    expect((await json("POST", "/api/admin/invites", ALEX, { email: JORDAN })).status).toBe(403);
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ALEX)).status).toBe(403);
    expect((await SELF.fetch("https://tally.test/api/admin")).status).toBe(401);
  });

  it("reports the default state", async () => {
    const state = await authedJson<AdminState>("/api/admin", ADMIN);
    expect(state).toEqual({ signup_mode: "invite", pending: [] });
  });

  it("flips signup mode and rejects anything else", async () => {
    const res = await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "open" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signup_mode: "open" });
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).signup_mode).toBe("open");
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "everyone" })).status).toBe(400);
    expect((await json("PUT", "/api/admin/signup-mode", ADMIN, { mode: "invite" })).status).toBe(200);
  });

  it("invites: inserts, emails the owner variant, lists as pending, and is idempotent", async () => {
    const first = await json("POST", "/api/admin/invites", ADMIN, { email: "Mia@Example.com" });
    expect(first.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toEqual(["mia@example.com"]);
    expect(outbox[0]!.subject).toBe("You've been invited to Tally");

    const again = await json("POST", "/api/admin/invites", ADMIN, { email: "mia@example.com" });
    expect(again.status).toBe(200);
    expect(outbox).toHaveLength(2); // re-inviting re-sends

    const state = await authedJson<AdminState>("/api/admin", ADMIN);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]!.email).toBe("mia@example.com");
    expect(typeof state.pending[0]!.invited_at).toBe("number");
  });

  it("an invite stops being pending once the person has onboarded", async () => {
    await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN });
    await env.DB.prepare("INSERT INTO users (email, display_name, accent_color, created_at) VALUES (?1, 'J', NULL, 1)")
      .bind(JORDAN)
      .run();
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).pending).toEqual([]);
  });

  it("removes an invite", async () => {
    await json("POST", "/api/admin/invites", ADMIN, { email: JORDAN });
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ADMIN)).status).toBe(204);
    expect((await authedJson<AdminState>("/api/admin", ADMIN)).pending).toEqual([]);
    expect((await json("DELETE", `/api/admin/invites/${JORDAN}`, ADMIN)).status).toBe(204); // idempotent
  });

  it("validates the invite email and refuses self-invites", async () => {
    expect((await json("POST", "/api/admin/invites", ADMIN, { email: "nope" })).status).toBe(400);
    expect((await json("POST", "/api/admin/invites", ADMIN, { email: ADMIN })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });
});
```

And append to `test/integration/prefs.test.ts` (imports: `beforeEach, afterEach` from vitest; `installMailPatch, outbox, removeMailPatch` from `../helpers/mail`):

```ts
describe("POST /api/ledgers invites the friend", () => {
  beforeEach(() => installMailPatch());
  afterEach(() => removeMailPatch());

  it("emails a partner invite, named after the creator, when the friend is new", async () => {
    await put("/api/me", ALEX, { display_name: "Alex Rivera", accent_color: ACCENT_PALETTE[0] });
    const res = await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: JORDAN });
    expect(res.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toEqual([JORDAN]);
    expect(outbox[0]!.subject).toBe("Alex Rivera started a ledger with you on Tally");
  });

  it("sends nothing when the friend already has an account, or the pair already exists", async () => {
    await put("/api/me", JORDAN, { display_name: "Jordan", accent_color: null });
    expect((await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: JORDAN })).status).toBe(201);
    expect(outbox).toHaveLength(0);
    await put("/api/me", ALEX, { display_name: "Alex", accent_color: null });
    expect((await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: SAM })).status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect((await post("/api/ledgers", ALEX, { id: crypto.randomUUID(), friend_email: SAM })).status).toBe(200);
    expect(outbox).toHaveLength(1);
  });
});
```

(`put`, `post`, `ACCENT_PALETTE`, `SAM` already exist in that file.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/admin.test.ts test/integration/prefs.test.ts` → FAIL (404s / `is_admin` undefined / no outbox).

- [ ] **Step 3: Shared types**

In `src/shared/types.ts`, change `UserPrefs` and add the admin types:

```ts
export interface UserPrefs {
  email: string;
  display_name: string | null;
  accent_color: string | null;
  /** The one owner (ADMIN_EMAIL): sees the owner settings screen. */
  is_admin: boolean;
}

export type SignupMode = "invite" | "open";

export interface PendingInvite {
  email: string;
  invited_at: number;
}

export interface AdminState {
  signup_mode: SignupMode;
  /** Invited people who have not onboarded yet (no users row). */
  pending: PendingInvite[];
}
```

`src/worker/settings.ts`: replace its local `export type SignupMode = ...` with `import type { SignupMode } from "../shared/types"; export type { SignupMode };` so there is one definition.

- [ ] **Step 4: Write `src/worker/admin.ts`**

```ts
import type { Hono, MiddlewareHandler } from "hono";
import type { AppContext, Env } from "./env";
import type { AdminState, PendingInvite } from "../shared/types";
import { looksLikeEmail } from "../shared/prefs";
import { getSignupMode, setSignupMode } from "./settings";
import { sendMail } from "./mailer";
import { invited } from "./emails";
import { ValidationError, assertString, readJson } from "./validate";

export function isAdmin(env: Env, email: string): boolean {
  return !!env.ADMIN_EMAIL && env.ADMIN_EMAIL.toLowerCase() === email;
}

const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!isAdmin(c.env, c.get("email"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** Owner-only routes. Registered after the global session middleware. */
export function registerAdmin(app: Hono<AppContext>): void {
  app.use("/api/admin", requireAdmin);
  app.use("/api/admin/*", requireAdmin);

  app.get("/api/admin", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT i.email, i.created_at AS invited_at
       FROM invites i LEFT JOIN users u ON u.email = i.email
       WHERE u.email IS NULL
       ORDER BY i.created_at DESC`,
    ).all<PendingInvite>();
    const state: AdminState = { signup_mode: await getSignupMode(c.env.DB), pending: results };
    return c.json(state);
  });

  app.put("/api/admin/signup-mode", async (c) => {
    const body = await readJson(c.req.raw);
    if (body.mode !== "invite" && body.mode !== "open") {
      throw new ValidationError("mode must be 'invite' or 'open'");
    }
    await setSignupMode(c.env.DB, body.mode);
    return c.json({ signup_mode: body.mode });
  });

  app.post("/api/admin/invites", async (c) => {
    const body = await readJson(c.req.raw);
    const email = assertString(body.email, "email", { trim: true, max: 254 }).toLowerCase();
    if (!looksLikeEmail(email)) throw new ValidationError("email must be an email address");
    if (email === c.get("email")) throw new ValidationError("you're already here");
    const insert = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO invites (email, invited_by, created_at) VALUES (?1, ?2, ?3)",
    )
      .bind(email, c.get("email"), Date.now())
      .run();
    // Re-inviting re-sends: the row is idempotent, the email is the point.
    await sendMail(c.env, { to: email, ...invited(null) });
    return c.json({ email }, insert.meta.changes === 1 ? 201 : 200);
  });

  app.delete("/api/admin/invites/:email", async (c) => {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase();
    await c.env.DB.prepare("DELETE FROM invites WHERE email = ?1").bind(email).run();
    return c.body(null, 204);
  });
}
```

- [ ] **Step 5: Wire `/api/me` and register admin in `index.ts`**

Add `import { isAdmin, registerAdmin } from "./admin";` and, after `registerPrefs(app);`, `registerAdmin(app);`. Replace the `/api/me` handler:

```ts
app.get("/api/me", async (c) => {
  const email = c.get("email");
  const row = await c.env.DB.prepare(
    "SELECT email, display_name, accent_color FROM users WHERE email = ?1",
  )
    .bind(email)
    .first<{ email: string; display_name: string | null; accent_color: string | null }>();
  return c.json({
    ...(row ?? { email, display_name: null, accent_color: null }),
    is_admin: isAdmin(c.env, email),
  });
});
```

`src/worker/prefs.ts` — the `PUT /api/me` response also gains `is_admin`: change its `return c.json({ email, display_name: displayName, accent_color: accent });` to `return c.json({ email, display_name: displayName, accent_color: accent, is_admin: isAdmin(c.env, email) });` and import `isAdmin` from `./admin`.

- [ ] **Step 6: Invite the friend on ledger creation**

In `src/worker/prefs.ts`, add imports `import { sendMail } from "./mailer"; import { invited } from "./emails";`, update the route comment to:

```ts
  // New ledger = the friend's email. That IS the invite: ledger membership
  // lets them request a sign-in code, and a new friend gets an email saying
  // so. Mail is best-effort here — the ledger exists either way.
```

and after `const pair = ...` / the `if (!pair)` block, before `const summaries = ...`, insert:

```ts
    if (insert.meta.changes === 1) {
      const friendRow = await c.env.DB.prepare("SELECT 1 AS ok FROM users WHERE email = ?1")
        .bind(friend)
        .first<{ ok: number }>();
      if (!friendRow) {
        const me = await c.env.DB.prepare("SELECT display_name FROM users WHERE email = ?1")
          .bind(email)
          .first<{ display_name: string | null }>();
        try {
          await sendMail(c.env, { to: friend, ...invited(me?.display_name ?? null) });
        } catch (err) {
          console.error("invite mail failed", err);
        }
      }
    }
```

- [ ] **Step 7: Run the two test files, then the suite (typecheck now covers `is_admin` everywhere)**

Run: `npx vitest run test/integration/admin.test.ts test/integration/prefs.test.ts` → PASS.
Run: `npm test` → green. The client typecheck passes because nothing in `src/client` constructs a `UserPrefs` literal (verify with `grep -rn "accent_color:" src/client --include=*.tsx --include=*.ts` — only reads).

- [ ] **Step 8: Commit**

```bash
git add src/worker/admin.ts src/worker/index.ts src/worker/prefs.ts src/worker/settings.ts src/shared/types.ts test/integration/admin.test.ts test/integration/prefs.test.ts
git commit -m "Owner routes: signup mode and invites; ledger creation emails the friend"
```

---

### Task 8: Client — API calls, the `signin` boot phase, and `SignInScreen`

No automated UI tests exist in this repo (vitest runs only in the workers pool). Verification for client tasks = `npm run typecheck`, `npm run build`, and a manual pass against `npm run dev` with the steps listed.

**Files:**
- Modify: `src/client/api.ts`, `src/client/App.tsx`
- Create: `src/client/screens/SignInScreen.tsx`

**Interfaces:**
- Produces (`api.ts`): `api.requestCode(email): Promise<{ ok: true }>`, `api.verifyCode(email, code): Promise<{ email: string }>`, `api.signOut(): Promise<void>`, `api.admin(): Promise<AdminState>`, `api.setSignupMode(mode): Promise<{ signup_mode: SignupMode }>`, `api.invite(email): Promise<{ email: string }>`, `api.removeInvite(email): Promise<void>`. `ApiError` gains `body: Record<string, unknown>` (the parsed error JSON, `{}` when none) so screens can read `tries_left` / `retry_after`.
- Produces: `SignInScreen({ desktop, onSignedIn }: { desktop: boolean; onSignedIn: () => void })`.

- [ ] **Step 1: Update `api.ts`**

Replace `ApiError`, `reloadForLogin`, and `request` with:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed error body ({} when there was none) — e.g. tries_left, retry_after. */
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Navigate to /login (the app shell renders the sign-in screen there) —
 *  but never in a loop: at most once per 15s, else surface the error. */
function reloadForLogin(): never {
  const KEY = "tally:last-auth-reload";
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last > 15_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.assign("/login");
  }
  throw new ApiError(401, "session expired");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // keep {}
    }
    const message = typeof body.error === "string" ? body.error : res.statusText;
    // A dead session anywhere but the sign-in screen itself: go sign in.
    // On /login the boot's 401 is the normal case, and the auth endpoints
    // answer 4xx for their own reasons — both are surfaced, not redirected.
    if (res.status === 401 && !path.startsWith("/api/auth/") && window.location.pathname !== "/login") {
      reloadForLogin();
    }
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
}
```

Add to the imports: `AdminState, SignupMode` from `../shared/types`. Add to the `api` object:

```ts
  // ---- Auth ------------------------------------------------------------
  requestCode: (email: string) =>
    request<{ ok: true }>("/api/auth/code", { method: "POST", body: JSON.stringify({ email }) }),
  verifyCode: (email: string, code: string) =>
    request<{ email: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  signOut: () => request<void>("/api/auth/signout", { method: "POST" }),

  // ---- Owner -----------------------------------------------------------
  admin: () => request<AdminState>("/api/admin"),
  setSignupMode: (mode: SignupMode) =>
    request<{ signup_mode: SignupMode }>("/api/admin/signup-mode", { method: "PUT", body: JSON.stringify({ mode }) }),
  invite: (email: string) =>
    request<{ email: string }>("/api/admin/invites", { method: "POST", body: JSON.stringify({ email }) }),
  removeInvite: (email: string) =>
    request<void>(`/api/admin/invites/${encodeURIComponent(email)}`, { method: "DELETE" }),
```

- [ ] **Step 2: Write `SignInScreen.tsx`**

Create `src/client/screens/SignInScreen.tsx` (artboards 1a and 1c D1/D2):

```tsx
// Sign-in: email -> six-digit code -> in. Every state keeps the same
// skeleton so the page reads as changing its mind, not navigating away
// (mockup/signin-account.dc.html, artboard 1a; desktop card in 1c).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, api } from "../api";
import { looksLikeEmail } from "../../shared/prefs";
import { ARCHIVO, CARD, DEFAULT_ACCENT, INK, MONO, MUTED_1, MUTED_3, MUTED_6, SERIF } from "../theme";
import { TallyMark } from "../components/TallyMark";

const ACCENT = DEFAULT_ACCENT;
const ERROR_INK = "#8a4a3f";

type CodeError = { kind: "wrong"; triesLeft: number } | { kind: "expired" } | { kind: "tooMany" } | null;

type Step =
  | { name: "email"; retryAfter: number | null }
  | { name: "code"; email: string; error: CodeError }
  | { name: "notInvited" };

export interface SignInScreenProps {
  desktop: boolean;
  onSignedIn: () => void;
}

const LABEL: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 7,
};

const QUIET: CSSProperties = {
  border: 0,
  background: "transparent",
  padding: 0,
  font: `500 13px ${ARCHIVO}`,
  color: MUTED_3,
  cursor: "pointer",
};

export function SignInScreen({ desktop, onSignedIn }: SignInScreenProps) {
  const [step, setStep] = useState<Step>({ name: "email", retryAfter: null });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // "Slow down": count the cooldown down to zero, then re-enable the button.
  useEffect(() => {
    if (step.name !== "email" || step.retryAfter === null) return;
    if (step.retryAfter <= 0) {
      setStep({ name: "email", retryAfter: null });
      return;
    }
    const t = window.setTimeout(() => {
      setStep((s) => (s.name === "email" && s.retryAfter !== null ? { name: "email", retryAfter: s.retryAfter - 1 } : s));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [step]);

  const cooling = step.name === "email" && step.retryAfter !== null;
  const canSend = looksLikeEmail(email.trim()) && !busy && !cooling;

  const sendCode = async (to: string) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.requestCode(to);
      setCode("");
      setStep({ name: "code", email: to.trim().toLowerCase(), error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setStep({ name: "notInvited" });
      } else if (err instanceof ApiError && err.status === 429) {
        const retry = typeof err.body.retry_after === "number" ? err.body.retry_after : 60;
        setStep({ name: "email", retryAfter: retry });
      } else {
        setFailure("That didn't go through — check the connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (digits: string) => {
    if (busy || step.name !== "code") return;
    setBusy(true);
    setFailure(null);
    try {
      await api.verifyCode(step.email, digits);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        if (err.message === "wrong code") {
          const left = typeof err.body.tries_left === "number" ? err.body.tries_left : 0;
          setStep({ ...step, error: { kind: "wrong", triesLeft: left } });
          window.setTimeout(() => codeInput.current?.select(), 0);
        } else {
          // "code expired" covers expired, consumed, superseded, and the
          // fifth miss; the server can't tell us which, but a fifth miss
          // is the one case we saw coming.
          const tooMany = step.error?.kind === "wrong" && step.error.triesLeft === 1;
          setStep({ ...step, error: tooMany ? { kind: "tooMany" } : { kind: "expired" } });
        }
      } else {
        setFailure("That didn't go through — check the connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  // ---- pieces -------------------------------------------------------------

  const heading = (text: string) => (
    <div style={{ marginTop: desktop ? 24 : 26, fontFamily: SERIF, fontSize: desktop ? 40 : 44, lineHeight: 1.02 }}>{text}</div>
  );
  const body = (node: React.ReactNode) => (
    <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: desktop ? undefined : 280 }}>
      {node}
    </div>
  );
  const primary = (label: string, enabled: boolean, onClick: () => void, dim = false) => (
    <button
      onClick={() => {
        if (enabled) onClick();
      }}
      disabled={!enabled}
      style={{
        marginTop: desktop ? 30 : 36,
        width: "100%",
        height: 58,
        borderRadius: 16,
        border: 0,
        cursor: enabled ? "pointer" : "default",
        font: `600 16px ${ARCHIVO}`,
        background: enabled || dim ? ACCENT : "rgba(0,0,0,.14)",
        color: enabled || dim ? "#fff" : MUTED_3,
        opacity: dim ? 0.85 : 1,
      }}
    >
      {label}
    </button>
  );
  const failureLine = failure && (
    <div style={{ marginTop: 14, font: `400 14px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}>{failure}</div>
  );

  let content: React.ReactNode;
  if (step.name === "notInvited") {
    content = (
      <>
        {heading("Not on the list yet")}
        {body("Tally is invite-only. Ask the person you share a ledger with to add you, then try again.")}
        {primary("Try another email", true, () => {
          setEmail("");
          setStep({ name: "email", retryAfter: null });
        })}
      </>
    );
  } else if (step.name === "email") {
    content = (
      <>
        {heading("Sign in")}
        {body(
          cooling
            ? "You asked for a code a moment ago. Give it a minute, then try again."
            : "We'll email you a six-digit code. There are no passwords.",
        )}
        <label style={{ display: "block", marginTop: desktop ? 30 : 32 }}>
          <span style={LABEL}>Email</span>
          <input
            value={email}
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) void sendCode(email);
            }}
            placeholder="you@example.com"
            style={{
              width: "100%",
              border: 0,
              borderBottom: "1px solid rgba(0,0,0,.2)",
              paddingBottom: 9,
              font: `500 20px ${ARCHIVO}`,
              background: "transparent",
            }}
          />
        </label>
        {cooling && (
          <div style={{ marginTop: 36, marginBottom: -26, textAlign: "center", font: `500 13px ${MONO}`, color: MUTED_3 }}>
            {`${Math.floor(step.retryAfter! / 60)}:${String(step.retryAfter! % 60).padStart(2, "0")}`}
          </div>
        )}
        {primary(busy ? "Sending…" : "Send me a code", canSend, () => void sendCode(email), busy)}
        {failureLine}
      </>
    );
  } else {
    const err = step.error;
    const gone = err?.kind === "expired" || err?.kind === "tooMany";
    const active = Math.min(code.length, 5);
    const slot = (i: number) => (
      <span
        key={i}
        style={{
          flex: 1,
          textAlign: "center",
          font: `500 32px ${MONO}`,
          color: INK,
          minWidth: 30,
          paddingBottom: i === active && !err ? 7 : 8,
          borderBottom: i === active && !err ? `2px solid ${ACCENT}` : "1px solid rgba(0,0,0,.25)",
          background: err?.kind === "wrong" ? "rgba(10,138,155,.16)" : "transparent",
        }}
      >
        {code[i] ?? " "}
      </span>
    );
    content = (
      <>
        {heading("Check your email")}
        {body(
          gone ? (
            err?.kind === "tooMany" ? "Too many tries — that code is no longer valid." : "That code has expired."
          ) : (
            <>
              We sent a 6-digit code to <span style={{ fontWeight: 500, color: INK }}>{step.email}</span>. It works for 10 minutes.
            </>
          ),
        )}
        {!gone && (
          <div style={{ marginTop: desktop ? 30 : 32, position: "relative" }} onClick={() => codeInput.current?.focus()}>
            <span style={{ ...LABEL, marginBottom: 10 }}>Code</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              {[0, 1, 2].map(slot)}
              <span style={{ width: 4 }} />
              {[3, 4, 5].map(slot)}
            </div>
            {/* One real input behind the slots: paste and iOS "From Messages" fill all six. */}
            <input
              ref={codeInput}
              value={code}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              aria-label="Six-digit code"
              onChange={(e) => onCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) void verify(code);
              }}
              style={{ position: "absolute", inset: 0, opacity: 0, border: 0, font: `32px ${MONO}`, caretColor: "transparent" }}
            />
            {err?.kind === "wrong" && (
              <div style={{ marginTop: 10, font: `400 14px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}>
                {`That code isn't right. ${err.triesLeft} ${err.triesLeft === 1 ? "try" : "tries"} left.`}
              </div>
            )}
          </div>
        )}
        {gone
          ? primary(busy ? "Sending…" : "Send a new code", !busy, () => void sendCode(step.email), busy)
          : primary(busy ? "Signing in…" : "Sign in", code.length === 6 && !busy, () => void verify(code), busy)}
        {failureLine}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8 }}>
          {!gone && (
            <>
              <button style={QUIET} onClick={() => void sendCode(step.email)}>
                Send a new code
              </button>
              <span style={{ font: `400 13px ${ARCHIVO}`, color: MUTED_6 }}>·</span>
            </>
          )}
          <button
            style={QUIET}
            onClick={() => {
              setCode("");
              setStep({ name: "email", retryAfter: null });
            }}
          >
            Use a different email
          </button>
        </div>
      </>
    );
  }

  if (desktop) {
    // A centered card on the paper; the logo lives inside it (artboard 1c).
    return (
      <div style={{ height: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto" }}>
        <div style={{ width: 420, marginTop: 96, background: CARD, border: "1px solid rgba(0,0,0,.09)", borderRadius: 6, padding: "30px 34px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TallyMark height={15} accent={ACCENT} />
            <span style={{ letterSpacing: ".08em", color: ACCENT, font: `600 12px ${MONO}` }}>Tally</span>
          </div>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px", overflowY: "auto" }}>
      {content}
    </div>
  );
}
```

- [ ] **Step 3: Add the boot phase to `App.tsx`**

In `App.tsx`:

1. Add `import { SignInScreen } from "./screens/SignInScreen";`.
2. Change the `Boot` type:

```ts
type Boot =
  | { phase: "loading" }
  | { phase: "signin" }
  | { phase: "error"; message: string }
  | { phase: "ready"; me: UserPrefs; ledgers: LedgerSummary[]; detail: LedgerDetail | null };
```

3. Turn the boot effect into a reusable function and treat a 401 as "sign in":

```ts
  const load = async () => {
    setBoot({ phase: "loading" });
    try {
      const [me, { ledgers }] = await Promise.all([api.me(), api.ledgers()]);
      // Exactly one ledger boots straight into it; zero or several boot
      // into the picker (detail stays null until one is opened).
      const only = ledgers.length === 1 ? ledgers[0]! : null;
      const detail = only ? await api.ledger(only.id) : null;
      setBoot({ phase: "ready", me, ledgers, detail });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setBoot({ phase: "signin" });
        return;
      }
      setBoot({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

4. After the `loading` early return, add:

```tsx
  if (boot.phase === "signin") {
    const signIn = (
      <SignInScreen
        desktop={isDesktop}
        onSignedIn={() => {
          // The URL was /login; the app lives at /. Then boot again in place.
          window.history.replaceState(null, "", "/");
          void load();
        }}
      />
    );
    return isDesktop ? signIn : <Shell accent={null}>{signIn}</Shell>;
  }
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build` → clean.

- [ ] **Step 5: Manual pass**

Run `npm run seed && npm run dev` (no `.dev.vars` needed) and in a browser:
1. `http://127.0.0.1:8787/` → the landing page. Click "Sign in" → `/login` renders the sign-in screen in the app shell.
2. Type `alex@example.com` → "Send me a code" → the wrangler terminal prints `[mail] Your Tally code: … → alex@example.com` and the text body.
3. Enter a wrong code → "That code isn't right. 4 tries left." with tinted slots.
4. Paste the right six digits → auto-submits → the URL becomes `/` and the picker/ledger loads.
5. Click "Send me a code" twice quickly (use a different email flow) → the "slow down" copy and a mono countdown.
6. Enter `nobody@example.com` → "Not on the list yet".
7. Widen the window past 900px on `/login` → the centered card.

- [ ] **Step 6: Commit**

```bash
git add src/client/api.ts src/client/App.tsx src/client/screens/SignInScreen.tsx
git commit -m "Sign in inside the app: email, six-digit code, and the states between"
```

---

### Task 9: Client — the account area (identity row, owner row, sign out) on the picker and the rail

**Files:**
- Create: `src/client/components/AccountArea.tsx`
- Modify: `src/client/screens/PickerScreen.tsx`, `src/client/components/DesktopShell.tsx`, `src/client/App.tsx`, `src/client/dev/Gallery.tsx`

**Interfaces:**
- Produces: `AccountArea({ colors, displayName, isAdmin, compact?, onEditPrefs, onOwnerSettings, onSignOut })`.
- `PickerScreenProps` replaces `onEditPrefs?` with required `displayName: string`, `isAdmin: boolean`, `onEditPrefs: () => void`, `onOwnerSettings: () => void`, `onSignOut: () => void`.
- `DesktopRailProps` gains the same five fields (replacing `onEditPrefs?`).
- App: `signOut()` calls `api.signOut()` (errors ignored — the cookie is gone either way after the redirect), then after 700 ms `location.assign("/login")`. `onOwnerSettings` sets `viewingOwner` (state wired in Task 10; here it is a no-op `() => {}` placeholder that Task 10 replaces — see that task's Step 2).

- [ ] **Step 1: Write `AccountArea.tsx`** (artboard 1b A/B/C; D3 for compact)

```tsx
// The account area under the receipt tear at the bottom of "Your ledgers":
// an identity row (name + your color), the owner-only settings row, and the
// quiet centered footer "About Tally · Sign out". Shared by the phone picker
// and the desktop rail (compact) so the two can't drift.

import { useState } from "react";
import type { CSSProperties } from "react";
import { ARCHIVO, INK, MUTED_1, MUTED_3, MUTED_4, MUTED_6, type Colors } from "../theme";

export interface AccountAreaProps {
  colors: Colors;
  displayName: string;
  isAdmin: boolean;
  compact?: boolean;
  onEditPrefs: () => void;
  onOwnerSettings: () => void;
  /** Called once; the label reads "Signed out." while the caller finishes. */
  onSignOut: () => void;
}

function Row({
  dot,
  title,
  subtitle,
  compact,
  onClick,
}: {
  dot: string;
  title: string;
  subtitle: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 11 : 13,
        width: "100%",
        padding: compact ? "10px 12px" : "12px 15px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,.13)",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ width: 11, height: 11, borderRadius: "50%", flex: "none", background: dot }} />
      <span style={{ flex: 1, minWidth: 0, display: "block" }}>
        <span style={{ display: "block", font: `600 ${compact ? 14 : 15}px ${ARCHIVO}`, color: INK }}>{title}</span>
        <span style={{ display: "block", marginTop: compact ? 2 : 3, font: `400 ${compact ? 11 : 12}px ${ARCHIVO}`, color: MUTED_3 }}>
          {subtitle}
        </span>
      </span>
      <span style={{ flex: "none", font: `500 ${compact ? 15 : 16}px ${ARCHIVO}`, color: MUTED_4 }}>›</span>
    </button>
  );
}

export function AccountArea({ colors: C, displayName, isAdmin, compact, onEditPrefs, onOwnerSettings, onSignOut }: AccountAreaProps) {
  const [signedOut, setSignedOut] = useState(false);
  const quiet: CSSProperties = {
    border: 0,
    background: "transparent",
    padding: 0,
    font: `500 ${compact ? 12 : 13}px ${ARCHIVO}`,
    color: MUTED_3,
    cursor: "pointer",
    textDecoration: "none",
  };
  return (
    <div
      style={{
        marginTop: compact ? 20 : 28,
        borderTop: "1px dashed rgba(0,0,0,.2)",
        paddingTop: compact ? 14 : 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <Row dot={C.me} title={displayName} subtitle="Your name and color" compact={compact} onClick={onEditPrefs} />
      {isAdmin && (
        <Row dot={INK} title="Owner settings" subtitle="Who can sign in · invites" compact={compact} onClick={onOwnerSettings} />
      )}
      <div style={{ marginTop: compact ? 10 : 12, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8 }}>
        <a href="/welcome" style={quiet}>
          About Tally
        </a>
        <span style={{ font: `400 ${compact ? 12 : 13}px ${ARCHIVO}`, color: MUTED_6 }}>·</span>
        {signedOut ? (
          <span style={{ ...quiet, color: MUTED_1, cursor: "default" }}>Signed out.</span>
        ) : (
          <button
            style={quiet}
            onClick={() => {
              setSignedOut(true);
              onSignOut();
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Use it in `PickerScreen.tsx`**

Replace the props interface's `onEditPrefs?: () => void;` (and its comment) with:

```ts
  displayName: string;
  isAdmin: boolean;
  /** Reopen the prefs screen (name + color) in edit mode. */
  onEditPrefs: () => void;
  onOwnerSettings: () => void;
  onSignOut: () => void;
```

destructure the new props, import `AccountArea` from `../components/AccountArea`, and replace everything from `{onEditPrefs && (` through the `About Tally ›` anchor's closing `</a>` with:

```tsx
          <AccountArea
            colors={C}
            displayName={displayName}
            isAdmin={isAdmin}
            onEditPrefs={onEditPrefs}
            onOwnerSettings={onOwnerSettings}
            onSignOut={onSignOut}
          />
```

Drop the now-unused `MUTED_3` import if `tsc` flags it.

- [ ] **Step 3: Use it in the desktop rail**

In `DesktopShell.tsx`, change `DesktopRailProps`: replace `onEditPrefs?: () => void;` with

```ts
  displayName: string;
  isAdmin: boolean;
  onEditPrefs: () => void;
  onOwnerSettings: () => void;
  onSignOut: () => void;
```

import `AccountArea`, and replace the `{rail.onEditPrefs && (<button …>Edit your name and color ›</button>)}` block and the `About Tally ›` anchor with:

```tsx
            <AccountArea
              colors={rail.colors}
              displayName={rail.displayName}
              isAdmin={rail.isAdmin}
              compact
              onEditPrefs={rail.onEditPrefs}
              onOwnerSettings={rail.onOwnerSettings}
              onSignOut={rail.onSignOut}
            />
```

Remove the now-unused `MUTED_3` import if flagged.

- [ ] **Step 4: Wire App.tsx**

In `App.tsx`, after `const createLedger = …`, add:

```ts
  const signOut = () => {
    // Best effort: the server row is deleted; the cookie is cleared by the
    // response. Either way the app returns to sign-in after the beat the
    // footer uses to say "Signed out."
    api.signOut().catch(() => {});
    window.setTimeout(() => window.location.assign("/login"), 700);
  };
```

Change `railFor` to include the new fields (the prefs edit is always available, so the `onEditPrefs: startPrefsEdit` spreads at the two call sites go away):

```ts
  const railFor = (C: Colors): DesktopRailProps => ({
    ledgers,
    viewerEmail: me.email,
    colors: C,
    activeLedgerId: detail?.ledger.id ?? null,
    onOpen: openLedger,
    onCreate: createLedger,
    displayName: me.display_name ?? me.email,
    isAdmin: me.is_admin,
    onEditPrefs: startPrefsEdit,
    onOwnerSettings: openOwner,
    onSignOut: signOut,
  });
```

`startPrefsEdit` is currently defined *after* the onboarding/editing blocks; move its definition (and `const colors = colorsFor(me.accent_color);` stays where it is) up to just before `railFor`. Add a stub `const openOwner = () => {};` next to it — Task 10 replaces it.

Replace the two `rail={{ ...railFor(colors), onEditPrefs: startPrefsEdit }}` with `rail={railFor(colors)}`. In `phonePicker`, replace `onEditPrefs={startPrefsEdit}` with:

```tsx
        displayName={me.display_name ?? me.email}
        isAdmin={me.is_admin}
        onEditPrefs={startPrefsEdit}
        onOwnerSettings={openOwner}
        onSignOut={signOut}
```

- [ ] **Step 5: Update the dev gallery**

In `src/client/dev/Gallery.tsx`, the `<PickerScreen …>` at ~line 133 passes `onEditPrefs={log("edit prefs")}`. Add alongside it:

```tsx
        displayName="Alex Rivera"
        isAdmin
        onOwnerSettings={log("owner settings")}
        onSignOut={log("sign out")}
```

- [ ] **Step 6: Typecheck, build, manual pass**

Run: `npm run typecheck && npm run build` → clean.
Manual (`npm run dev`, `.dev.vars` with `ADMIN_EMAIL=alex@example.com`): sign in as alex → "Your ledgers" shows the dashed tear, the "Alex / Your name and color ›" row (opens prefs), the "Owner settings" row (does nothing yet), and "About Tally · Sign out". Tap Sign out → "Signed out." → `/login` after a beat; `/api/me` is now 401 (check in devtools). Widen to desktop → the same rows compact at the bottom of the rail. Sign in as `sam@example.com` (a ledger member) → no owner row.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/AccountArea.tsx src/client/screens/PickerScreen.tsx src/client/components/DesktopShell.tsx src/client/App.tsx src/client/dev/Gallery.tsx
git commit -m "Account area on the picker and rail: identity row, owner row, sign out"
```

---

### Task 10: Client — the owner settings screen

**Files:**
- Create: `src/client/screens/OwnerScreen.tsx`
- Modify: `src/client/App.tsx`

**Interfaces:**
- Produces: `OwnerScreen({ colors, onBack }: { colors: Colors; onBack: () => void })` — loads `api.admin()` on mount and owns its state.
- App: `viewingOwner` boolean rendered exactly like `editingPrefs` (phone: full screen; desktop: in the pane with the rail live), placed **before** the `if (!detail)` branch.

- [ ] **Step 1: Write `OwnerScreen.tsx`** (artboards 1b A2 + D, 1c D3)

```tsx
// Owner settings: who can sign in, invite someone, pending invites.
// mockup/signin-account.dc.html artboards A2 (phone), D (control states),
// D3 (desktop pane).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AdminState, SignupMode } from "../../shared/types";
import { ApiError, api } from "../api";
import { looksLikeEmail } from "../../shared/prefs";
import { shortDate } from "../../shared/format";
import { ARCHIVO, CARD, INK, MONO, MUTED_1, MUTED_2, MUTED_3, MUTED_4, SERIF, type Colors } from "../theme";

const ERROR_INK = "#8a4a3f";

export interface OwnerScreenProps {
  colors: Colors;
  onBack: () => void;
}

const LABEL: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 10,
};

const HELPER: Record<SignupMode, string> = {
  invite: "Only people you or a ledger has added can sign in.",
  open: "Anyone can sign in and use your scan budget. Switch back when you're done.",
};

type InviteState = { name: "idle" } | { name: "sending" } | { name: "sent"; email: string } | { name: "error"; message: string };

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function OwnerScreen({ colors: C, onBack }: OwnerScreenProps) {
  const [state, setState] = useState<AdminState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<InviteState>({ name: "idle" });
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    api
      .admin()
      .then(setState)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load settings."));
  }, []);

  const setMode = async (mode: SignupMode) => {
    if (!state || switching || state.signup_mode === mode) return;
    setSwitching(true);
    try {
      const { signup_mode } = await api.setSignupMode(mode);
      setState({ ...state, signup_mode });
    } catch {
      // The buttons simply stay where they were.
    } finally {
      setSwitching(false);
    }
  };

  const sendInvite = async () => {
    const to = email.trim();
    if (invite.name === "sending") return;
    if (!looksLikeEmail(to)) {
      setInvite({ name: "error", message: "That's not an email address." });
      return;
    }
    setInvite({ name: "sending" });
    try {
      const sent = await api.invite(to);
      setInvite({ name: "sent", email: sent.email });
      setEmail("");
      setState(await api.admin());
    } catch (err) {
      setInvite({
        name: "error",
        message: err instanceof ApiError ? err.message : "That didn't go through — check the connection and try again.",
      });
    }
  };

  const remove = async (target: string) => {
    if (!state) return;
    setState({ ...state, pending: state.pending.filter((p) => p.email !== target) });
    try {
      await api.removeInvite(target);
    } catch {
      setState(await api.admin().catch(() => state));
    }
  };

  const segment = (mode: SignupMode, label: string) => {
    const on = state?.signup_mode === mode;
    return (
      <button
        onClick={() => void setMode(mode)}
        aria-pressed={on}
        disabled={!state || switching}
        style={{
          flex: 1,
          textAlign: "center",
          padding: "9px 14px",
          borderRadius: 10,
          font: `500 14px ${ARCHIVO}`,
          background: on ? INK : "transparent",
          color: on ? CARD : MUTED_1,
          border: `1px solid ${on ? INK : "rgba(0,0,0,.28)"}`,
          cursor: on ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px", overflowY: "auto" }}>
      <button
        onClick={onBack}
        className="navlink"
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "transparent",
          padding: "9px 13px",
          margin: "-9px -13px",
          borderRadius: 10,
          font: `500 14px ${ARCHIVO}`,
          color: MUTED_3,
          cursor: "pointer",
        }}
      >
        ‹ Back
      </button>
      <div style={{ marginTop: 26, fontFamily: SERIF, fontSize: 44, lineHeight: 1.02 }}>Owner settings</div>
      <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: 280 }}>
        Who can sign in, and who's been invited.
      </div>
      {loadError && (
        <div style={{ marginTop: 20, font: `400 14px ${ARCHIVO}`, color: ERROR_INK }}>{loadError}</div>
      )}

      <div style={{ marginTop: 32, maxWidth: 420 }}>
        <span style={LABEL}>Who can sign in</span>
        <div style={{ display: "flex", gap: 8 }}>
          {segment("invite", "Invite only")}
          {segment("open", "Anyone with an email")}
        </div>
        <div style={{ marginTop: 8, font: `400 13px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_2 }}>
          {state ? HELPER[state.signup_mode] : " "}
        </div>
      </div>

      <div style={{ marginTop: 28, maxWidth: 420 }}>
        <span style={LABEL}>Invite someone</span>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <input
            value={email}
            inputMode="email"
            autoCapitalize="none"
            placeholder="friend@example.com"
            onChange={(e) => {
              setEmail(e.target.value);
              if (invite.name === "error") setInvite({ name: "idle" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendInvite();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              borderBottom: "1px solid rgba(0,0,0,.22)",
              paddingBottom: 6,
              font: `500 15px ${MONO}`,
              background: "transparent",
            }}
          />
          <button
            onClick={() => void sendInvite()}
            disabled={invite.name === "sending"}
            style={{
              flex: "none",
              border: 0,
              background: "transparent",
              padding: "0 0 6px",
              font: `600 13px ${ARCHIVO}`,
              color: invite.name === "sending" ? MUTED_3 : C.me,
              cursor: invite.name === "sending" ? "default" : "pointer",
            }}
          >
            {invite.name === "sending" ? "Sending…" : "Send invite"}
          </button>
        </div>
        {invite.name === "sent" && (
          <div style={{ marginTop: 10, borderLeft: `3px solid ${C.me}`, paddingLeft: 14, font: `400 13px ${ARCHIVO}`, lineHeight: 1.5, color: MUTED_1 }}>
            {`Invited ${invite.email} — they'll get an email.`}
          </div>
        )}
        {invite.name === "error" && (
          <div style={{ marginTop: 10, font: `400 13px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}>{invite.message}</div>
        )}
      </div>

      <div style={{ marginTop: 28, maxWidth: 420 }}>
        <span style={LABEL}>Pending invites</span>
        {!state || state.pending.length === 0 ? (
          <div style={{ font: `400 13px ${ARCHIVO}`, color: MUTED_3 }}>No pending invites.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {state.pending.map((p) => (
              <div key={p.email} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0, font: `400 13px ${MONO}`, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.email}
                </span>
                <span style={{ flex: "none", font: `400 11px ${MONO}`, color: MUTED_4 }}>{shortDate(isoDate(p.invited_at))}</span>
                <button
                  onClick={() => void remove(p.email)}
                  style={{ flex: "none", border: 0, background: "transparent", padding: 0, font: `500 12px ${ARCHIVO}`, color: MUTED_3, cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

1. `import { OwnerScreen } from "./screens/OwnerScreen";`
2. Next to `const [editingPrefs, setEditingPrefs] = useState(false);` add `const [viewingOwner, setViewingOwner] = useState(false);`.
3. Replace the Task 9 stub `const openOwner = () => {};` with `const openOwner = () => setViewingOwner(true);`.
4. Directly after the `if (editingPrefs) { … }` block (before `// Logo/wordmark click`), add:

```tsx
  // ---- Owner settings: same shape as prefs editing ------------------------
  if (viewingOwner && me.is_admin) {
    const owner = <OwnerScreen colors={colors} onBack={() => setViewingOwner(false)} />;
    return isDesktop ? (
      <DesktopShell accent={colors.me} rail={railFor(colors)} onHome={goHome}>
        {owner}
      </DesktopShell>
    ) : (
      <Shell accent={colors.me} onHome={goHome}>
        {owner}
      </Shell>
    );
  }
```

`goHome` is defined a few lines below; move its definition above this block.

- [ ] **Step 3: Typecheck, build, manual pass**

Run: `npm run typecheck && npm run build` → clean.
Manual (`.dev.vars` `ADMIN_EMAIL=alex@example.com`): sign in as alex → Owner settings row → the screen loads "Invite only" selected with its helper line. Tap "Anyone with an email" → helper changes; `curl -X POST http://127.0.0.1:8787/api/auth/code -H 'content-type: application/json' -d '{"email":"nobody@example.com"}'` now returns `{"ok":true}` (and the code prints). Switch back → the same curl returns 403. Invite `mia@example.com` → "Invited mia@example.com — they'll get an email.", the invite mail prints, "mia@example.com · <today> · Remove" appears; Remove → "No pending invites.". Type `nope` → "That's not an email address.". Desktop: the screen renders in the pane with the rail live; ‹ Back returns to the empty state / open ledger.

- [ ] **Step 4: Commit**

```bash
git add src/client/screens/OwnerScreen.tsx src/client/App.tsx
git commit -m "Owner settings screen: who can sign in, invites, pending list"
```

---

### Task 11: Docs, deviations, seed comment, and the spec's dev-log line

**Files:**
- Modify: `README.md`, `DEVIATIONS.md`, `seed/seed.sql`, `docs/superpowers/specs/2026-09-11-email-code-auth-design.md`, `src/shared/prefs.ts`

- [ ] **Step 1: README**

Replace the "Local development" paragraph about `DEV_ALLOW_USER` and the `cp .dev.vars.example .dev.vars   # local identity` line with:

```md
No `.dev.vars` is required. Without `RESEND_API_KEY` the Worker prints
sign-in codes and invite mail to the wrangler terminal; sign in as
`alex@example.com` (a seeded ledger member) and copy the six digits from
there. `cp .dev.vars.example .dev.vars` makes alex the owner locally so the
owner settings screen shows.
```

Replace the sentence "Auth tests forge valid JWTs with the committed test-only keypair in `test/keys/` and exercise the real verification path (signature, issuer, audience, expiry)." with "Auth tests mint real session rows and, for the code flow, patch outbound `fetch` to capture what Resend would have sent (`test/helpers/mail.ts`)."

Replace the whole "## Cloudflare Access setup (auth)" section through "### Adding a friend" with:

```md
## Sign-in

Tally signs people in itself: email → a six-digit code by email → a session.
There are no passwords and no third-party identity provider.

- **Codes** (`src/worker/auth.ts`): `POST /api/auth/code` emails a code
  (10 minutes, single use, five wrong tries and it's dead); `POST
  /api/auth/verify` exchanges it for a session cookie. Only the code's hash
  is stored. Requests are rate-limited per address and globally.
- **Sessions** (`src/worker/session.ts`): a 256-bit token in an
  `HttpOnly; SameSite=Lax; Secure` cookie, its sha256 as the D1 row.
  90 days, extended on use; `POST /api/auth/signout` deletes the row.
- **Who can sign in**: invite-only by default — the owner (`ADMIN_EMAIL`),
  anyone with an account, any ledger member, or an explicit invite. The
  owner can invite by email or open sign-up to anyone from the app's
  "Owner settings" screen. Creating a ledger with someone's email is itself
  an invite (they get an email).
- **Mail** (`src/worker/mailer.ts`): Resend, from `MAIL_FROM`. Set the
  `RESEND_API_KEY` secret and verify the sending domain in Resend
  (its DKIM/SPF records go in the Cloudflare zone). Without the key the
  Worker prints mail to the console — local dev only.
- **Scan caps** (`src/worker/receipts.ts`): 30 uploads per person and
  200 overall per 24 h, so opening sign-up can't drain the model key.

### Adding a friend

In the app, "New ledger" → enter their email. That's it — they get an
invite email and can sign in.
```

Update the PWA paragraph's last sentence to "When the session expires inside the installed app, the client navigates to `/login`, which renders the sign-in screen in place." Update the repo map line `src/worker/   Hono app: Access JWT middleware, routes, D1 queries` to `src/worker/   Hono app: session middleware, auth/admin routes, D1 queries, mail`.

- [ ] **Step 2: DEVIATIONS.md**

Replace section D5 with:

```md
## D5. Sign-in is the app's own (was: Cloudflare Access + DEV_ALLOW_USER)

The spec's Cloudflare Access One-Time PIN and the local `DEV_ALLOW_USER`
bypass are gone. The app emails its own six-digit code and keeps sessions in
D1 (`docs/superpowers/specs/2026-09-11-email-code-auth-design.md`). Local
development signs in for real: without `RESEND_API_KEY` the code prints to
the wrangler terminal. There is no longer any identity bypass anywhere.
```

In D10 (the paragraph mentioning "sits unused until that address is added to the Access policy — the policy is the real gatekeeper (rule: adding a friend = policy AND ledger)"), replace that clause with "is itself the invite — ledger membership lets that address request a sign-in code, and a mistyped one simply never signs in".

- [ ] **Step 3: Small comment fixes**

`seed/seed.sql` line 2: `-- Viewer for manual review: alex@example.com (sign in with the console-printed code).`
`src/shared/prefs.ts` `looksLikeEmail` doc: `/** Loose but serviceable e-mail shape check (the allow-list in auth.ts is the real gatekeeper; this catches typos before a dead ledger gets created). */`
Spec, "Local development" section: change the printed-code sentence to: Codes print in the wrangler terminal as the email itself — `[mail] Your Tally code: 482 913 → alex@example.com` followed by the text body.
Spec, "Mail" section: the logo line should say the hosted PNG is the existing `icon-192.png` (no new asset).

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run build` → green. `grep -rn "Access\b" README.md DEVIATIONS.md src | grep -iv "accessibility\|aria"` → only historical mentions in DEVIATIONS D5's title.

```bash
git add README.md DEVIATIONS.md seed/seed.sql src/shared/prefs.ts docs/superpowers/specs/2026-09-11-email-code-auth-design.md
git commit -m "Document the app's own sign-in; retire the Access setup notes"
```

---

### Task 12: Cutover (manual, by the owner — no code)

This is a checklist, run once, in this order, after the branch is reviewed. Order matters: step 3 before step 4 means there is never a moment where `/api` is reachable without *some* valid identity.

- [ ] **1. Resend**: add the domain `tally.andresl.dev` in Resend → copy its DKIM/SPF (and DMARC) records into the `andresl.dev` zone in the Cloudflare dashboard → wait for "Verified". Create an API key scoped to *Sending access* on that one domain. `npx wrangler secret put RESEND_API_KEY`.
- [ ] **2. Migrate**: `npx wrangler d1 migrations apply tally --remote` (additive; the running Worker ignores the new tables).
- [ ] **3. Delete both Access applications** ("tally" and "Tally landing (public)") in Zero Trust → Access → Applications. From this moment the *old* Worker returns 401 to everyone — it still demands an Access JWT no one can obtain — so nothing is exposed.
- [ ] **4. Merge to `main`** → Workers Builds deploys.
- [ ] **5. Sign in** at `https://tally.andresl.dev/login` as the `ADMIN_EMAIL`; confirm the code arrives from `sign-in@tally.andresl.dev` (check spam once). Your friend signs in the same way — they're allowed through the existing ledger.
- [ ] **6. Update the memory note** `~/.claude/projects/-home-andresl-Projects-tally/memory/tally-production-setup.md`: replace the "Auth topology" paragraph with the new one (own sign-in; Access apps deleted; `RESEND_API_KEY` secret; `ADMIN_EMAIL` var; adding a friend = create the ledger).

---

## Self-review

**Spec coverage** — Data (T1) · Configuration (T1, T3) · `/code` & `/verify` & `/signout` (T4) · allow check + rate limits + housekeeping (T4 pruning, T5) · Sessions & middleware incl. Origin check, sliding renewal, `/login` (T3, T4) · Scan caps (T6) · Mail + templates + hosted logo (T2) · Client sign-in states 1–7 + desktop card (T8) · `api.ts` changes (T8) · Account area + sign out (T9) · Owner screen (T10) · Admin routes + `is_admin` + ledger-creation invite (T7) · Local dev (T1, T11) · Tests list (T3–T7; the "no code in logs" test is in T4) · Cutover (T12) · README/DEVIATIONS/memory (T11, T12).

**Deliberate deviations from the spec's test list**: "cookie attributes" and "`Secure` present on https / absent on http" are asserted in T3's renewal tests and T4's verify test rather than a separate case.

**Type consistency** — `authedFetch(path, email, init)` unchanged across suites; `ApiError.body` used by `SignInScreen` (`tries_left`, `retry_after`) matches `request()`; `DesktopRailProps` / `PickerScreenProps` field names match `AccountArea` props; `AdminState.pending[].invited_at` matches `admin.ts`'s `SELECT … AS invited_at` and `OwnerScreen`; `SignupMode` has one definition (`shared/types.ts`).
