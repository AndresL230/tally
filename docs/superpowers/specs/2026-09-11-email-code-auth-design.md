# Own auth: email one-time code, sessions in D1, Resend for mail

Approved in discussion 2026-09-11. Replaces Cloudflare Access as the app's
identity layer. The Access-era topology is described in the README section
this spec obsoletes.

## Goal

Sign-in that belongs to the app: a person types their email on a Tally-styled
screen, gets a 6-digit code by email, types it, and is in. Onboarding becomes
self-serve (creating a ledger with someone's email invites them; the owner can
also invite directly or open sign-up to anyone from inside the app), and there
is a sign-out button. The `/api/*` surface stays exactly as gated as it is
today — a valid identity is required for everything except the two endpoints
that mint one.

Motivations, in the order they were given: self-serve invites, branded sign-in,
control over sessions. Portability off Cloudflare was explicitly *not* a goal,
so the design leans on D1 and Workers freely.

## Not in scope (follow-ups, recorded so they aren't lost)

- "Sign out everywhere" / device list. The sessions table makes this a one-line
  addition later; no UI now.
- Deleting the R2 object when a receipt is discarded, and a "view the original
  receipt" feature. Photos stay in the private bucket, reachable only through
  member-gated Worker routes, as today.
- Field-level encryption in D1. Rejected: email is the primary/join key
  everywhere, and the key would live in the same trust boundary as the data.
  Tokens and codes are hashed, which is the control that matters.
- Cloudflare Email Sending as the mailer. Beta at time of writing; the mailer
  is one file so swapping later is contained.

## Data — `migrations/0003_auth.sql`

```sql
-- Explicit invites. "May sign in" is the union of: ADMIN_EMAIL, membership
-- in any ledger, or a row here. Creating a ledger with a friend's email is
-- therefore already an invite; this table is for inviting someone who has no
-- ledger yet. Switching sign-up back to invite-only deletes the sessions of
-- anyone outside that union, so open mode is reversible.
CREATE TABLE invites (
  email      TEXT PRIMARY KEY,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One-time codes, append-only; only the NEWEST row per email is live.
-- Stores sha256(id || ":" || code), never the code.
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

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- settings.signup_mode: 'invite' (the default when the row is absent) | 'open'
```

All timestamps are epoch milliseconds, matching the existing tables. "Pending
invites" (for the owner's list) is derived — `invites` rows with no `users`
row — not stored.

Housekeeping, opportunistic and cheap: each `/api/auth/code` call first
deletes `auth_codes` rows older than 24 h; each `/api/auth/verify` success
deletes `sessions` rows past `expires_at`. D1 Time Travel keeps 30 days of
history, so deleted rows persist that long at the platform level.

## Configuration

`wrangler.jsonc` vars (public, not secret):

- `ADMIN_EMAIL` — the one owner. Gets the admin routes and is always allowed
  to sign in.
- `MAIL_FROM` — `"Tally <sign-in@tally.andresl.dev>"`.

Secrets (`wrangler secret put`): `RESEND_API_KEY`, scoped in Resend to
sending-only on that one domain.

Removed: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_JWKS`, `DEV_ALLOW_USER`,
the `jose` dependency, `test/keys/`. `.dev.vars` is no longer required for
local development; `ADMIN_EMAIL=alex@example.com` there shows the owner block
against the seed data.

## Public endpoints — `src/worker/auth.ts` (rewritten)

These two are the only `/api` routes reachable without a session. They are
registered *before* `app.use("/api/*", requireUser)`; in Hono, registration
order is what exempts them, and a comment in `index.ts` says so.

### `POST /api/auth/code` — body `{ email }`

1. Lowercase + trim; `looksLikeEmail` or `400`.
2. Rate limits, checked in this order, all from `auth_codes` counts:
   - global: ≤ 30 rows created in the last hour (any mode; protects the mail
     quota) → `429 { error: "slow down", retry_after }`
   - per email: newest row < 60 s old → `429` with `retry_after` seconds
   - per email: ≤ 5 rows in the last hour → `429`
3. Allowed? `signup_mode = 'open'` short-circuits to yes. Otherwise the email
   must be `ADMIN_EMAIL`, or appear as `person_a`/`b` in any ledger, or have
   an `invites` row. Not allowed → `403 { error: "not invited" }`. This is
   deliberately explicit rather than an enumeration-safe "if an account
   exists": the app is private and the owner chose gatekeeping, not secrecy.
   Switching sign-up back to invite-only also revokes the sessions of
   everyone outside that list, so open mode can be undone.
4. Generate a 6-digit code from `crypto.getRandomValues` with rejection
   sampling (all 10⁶ values equally likely). Insert the row; older rows for
   the email are implicitly superseded.
5. `sendMail(...)` the code. On failure delete the row and return
   `502 { error: "couldn't send the email" }`.
6. `200 { ok: true }`.

### `POST /api/auth/verify` — body `{ email, code }`

1. Load the newest `auth_codes` row for the (normalized) email. None, or
   `expires_at` passed, or `consumed_at` set, or `attempts ≥ 5` →
   `400 { error: "code expired" }`. The client shows one "send a new code"
   state for all of these.
2. Compare `sha256(id:code)`. Miss → increment `attempts`; if that reaches 5,
   `400 { error: "code expired" }`, else `400 { error: "wrong code",
   tries_left }`.
3. Hit → set `consumed_at`, create a session (below), `Set-Cookie`,
   `200 { email }`.

### `POST /api/auth/signout` — behind `requireUser`

Delete the session row, clear the cookie, `204`.

## Sessions and the middleware

- Token: 32 random bytes, base64url, in cookie `tally_session`;
  `HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000` (90 days). `Secure` is
  added whenever the request URL is `https:`, so `wrangler dev` over
  `http://localhost` works with no bypass.
- `getUser(request, env)` keeps its signature: cookie → sha256 → `SELECT
  email, expires_at FROM sessions WHERE id = ? AND expires_at > now`. The
  root route in `index.ts` is unchanged.
- Sliding renewal: on an authenticated request with under 45 days left,
  extend `expires_at` to now + 90 days and re-emit the cookie. `last_seen_at`
  is written at most once an hour, so ordinary use is one read.
- CSRF: `SameSite=Lax` already withholds the cookie on cross-site POSTs. As a
  second layer, `requireUser` rejects any non-GET `/api` request whose
  `Origin` header is present and not the request's own origin → `403`.
- `/login` serves the app shell (`index.html`) instead of redirecting; `/` for
  an anonymous visitor still serves `welcome.html`. `run_worker_first`
  already lists both.

## Scan caps — `src/worker/receipts.ts`

On `POST /api/ledgers/:id/receipts`, after the sha256 dedupe (re-uploading the
same bytes never counts), two counts on the existing `receipts.uploaded_by` /
`created_at`: per user ≤ 30 uploads per 24 h, global ≤ 200 per 24 h →
`429 { error: "daily scan limit reached" }`. Upload is the choke point because
`/extract` is already once-per-image. These exist so that flipping sign-up to
"open" can't turn the model key into a public resource.

## Mail — `src/worker/mailer.ts`, `src/worker/emails.ts`

`sendMail(env, { to, subject, html, text })`:

- `RESEND_API_KEY` set → `POST https://api.resend.com/emails` with
  `Authorization: Bearer`, `from: env.MAIL_FROM`. Non-2xx throws.
- Not set (local dev only) → `console.log` the text body, which contains the
  code, and return. **This is the only condition under which a code is ever
  logged.** Nothing else in the Worker prints codes or tokens.

`emails.ts` exports the two templates, ported from the Claude Design work:

- `signInCode(code)` — subject `Your Tally code: 482 913`; the code large in
  the mono face, grouped 3+3; "works for 10 minutes and can be used once";
  no links.
- `invited(inviterName | null)` — subject `<Name> started a ledger with you on
  Tally` (or `You've been invited to Tally` when sent by the owner); one
  "Open Tally" button to `https://tally.andresl.dev/login`.

Both have HTML and plain-text bodies (artboards 2a/2b give the exact
markup and copy). The brand mark is a solid accent banner with a text wordmark — no images
at all, so it survives image blocking and proxying;
invite on an owner invite, and on `POST /api/ledgers` when the friend has no
`users` row yet.

One-time setup: add `tally.andresl.dev` as a Resend domain and put its DKIM /
SPF (+ DMARC) records in the Cloudflare zone.

## Client

Visuals come from the Claude Design project "Sign-in and ledgers screens"
(https://claude.ai/design/p/75b079dd-3f7a-4a09-88a9-6bc746db3ebb), exported to
`mockup/signin-account.dc.html` in this repo so the port has a local
reference. Artboards: 1a sign-in (7 phone states), 1b your-ledgers account
area + owner settings, 1c desktop, 2a/2b emails.

### Sign-in as a boot phase — `src/client/App.tsx`, `screens/SignInScreen.tsx`

`Boot` gains `{ phase: "signin" }`. Boot calls `api.me()`; a `401` lands in
that phase (a visit to `/login` serves the shell and arrives the same way).
On success the screen does `history.replaceState(null, "", "/")` and the boot
effect re-runs in place — no reload.

`SignInScreen` renders inside the existing `Shell` with the default accent
and keeps every state on the same skeleton (artboard 1a):

1. **email** — "Sign in" / "We'll email you a six-digit code. There are no
   passwords." / Email underline input / "Send me a code" (disabled until the
   field looks like an email).
2. **sending** — button reads "Sending…" at 85% opacity.
3. **code** — "Check your email" / "We sent a 6-digit code to **addr**. It
   works for 10 minutes." / six underline slots grouped 3 + 3 in the mono
   face at 32px, the active slot's underline 2px accent; ONE hidden
   `<input inputmode="numeric" autocomplete="one-time-code">` behind them so
   paste and iOS autofill fill all six / "Sign in" / footer "Send a new code ·
   Use a different email".
4. **wrong code** — slots tinted `rgba(10,138,155,.16)` (digits selected for
   retyping); line under them in `#8a4a3f`: "That code isn't right. N tries
   left."
5. **expired / too many tries** — the slots are gone; body reads "That code
   has expired." or "Too many tries — that code is no longer valid."; primary
   button becomes "Send a new code"; footer keeps "Use a different email".
6. **not invited** — "Not on the list yet" / "Tally is invite-only. Ask the
   person you share a ledger with to add you, then try again." / "Try
   another email".
7. **slow down** — email step with body "You asked for a code a moment ago.
   Give it a minute, then try again.", a mono countdown (`0:47`) above the
   disabled button, driven by `retry_after`.

Desktop (≥ 900px, artboard 1c D1/D2): the same content in a centered
`CARD` (420px wide, 96px from the top, padding 30/34/28) on the paper
background, heading at 40px. Nothing else on the page.

### `src/client/api.ts`

Adds `requestCode(email)`, `verifyCode(email, code)`, `signOut()`, and the
admin calls. The `opaqueredirect` / non-JSON detection and its comment are
removed — nothing redirects `/api` anymore. A plain `401` from any call
*after* boot (the session died mid-use) keeps today's throttled
`location.assign("/login")`.

`welcome.html`'s "am I signed in" script works unchanged: a `401` is `!r.ok`,
so the CTAs stay "Sign in".

### The account area — `screens/PickerScreen.tsx` (artboard 1b)

Below "+ New ledger", after a dashed tear (`border-top: 1px dashed
rgba(0,0,0,.2)`, 28px above, 16px below), an account area of bordered rows
(`padding 12px 15px; border-radius 14px; border 1px solid rgba(0,0,0,.13)`,
8px apart), each with an 11px dot, a 15px/600 title, a 12px muted subtitle,
and a trailing "›":

- **Identity row** — dot in the viewer's accent; title = display name;
  subtitle "Your name and color". Opens prefs editing (replaces the old
  "Edit your name and color ›" link).
- **Owner settings row** — owner only (`me.is_admin`); ink dot; subtitle
  "Who can sign in · invites". Opens the owner screen.
- **Footer** — centered, 12px below the rows: "About Tally · Sign out" in
  the quiet-link style with a `#c9c2b6` middot. Tapping Sign out calls
  `api.signOut()`, the label becomes "Signed out." in `#4a453d` for ~700 ms,
  then `location.assign("/login")`. No confirm dialog (artboard C's note:
  cheap to undo, least prominent thing on the page).

On desktop the same rows and footer sit at the bottom of the rail
(`LedgerNav`), at the rail's compact sizes (artboard D3).

### Owner settings — `screens/OwnerScreen.tsx` (artboards A2, D, D3)

A new `Screen` variant `{ name: "owner" }`, rendered like any other screen
(phone: full screen with "‹ Back"; desktop: in the right pane). Loads
`GET /api/admin` on mount.

- **Who can sign in** — label, then two segmented options ("Invite only" /
  "Anyone with an email"; selected = ink fill `#211f1c` with `#fbfaf6` text,
  other = outlined `rgba(0,0,0,.28)`; `padding 9px 14px; radius 10px`),
  then helper copy: invite → "Only people you or a ledger has added can sign
  in."; open → "Anyone can sign in and use your scan budget. Switch back when
  you're done." Tapping calls `PUT /api/admin/signup-mode`.
- **Invite someone** — mono underline input (15px) with an inline "Send
  invite" text action in the accent, 600 13px. States: idle; sending ("Sending…"
  in muted); sent — an accent-left-bordered note "Invited addr — they'll get
  an email."; error — "That's not an email address." in `#8a4a3f`.
- **Pending invites** — rows of email (mono 13px, ellipsized), invited date
  (mono 11px, `#a8a298`, e.g. "Sep 2"), and a "Remove" text action; empty
  state "No pending invites."

## Admin routes — `src/worker/admin.ts`

`GET /api/me` gains `is_admin: boolean` (`email === ADMIN_EMAIL`). Everything
below is behind `requireUser` and returns `403 { error: "forbidden" }` for
anyone else.

| Route | Body | Result |
|---|---|---|
| `GET /api/admin` | — | `{ signup_mode, pending: [{ email, invited_at }] }` |
| `PUT /api/admin/signup-mode` | `{ mode: "invite" \| "open" }` | upsert `settings`; `{ signup_mode }` |
| `POST /api/admin/invites` | `{ email }` | insert (idempotent), send the invite email; `201`/`200` |
| `DELETE /api/admin/invites/:email` | — | `204` |

## Local development

`npm run dev` needs no `.dev.vars`. Codes print in the wrangler terminal as
the email itself — `[mail] Your Tally code: 482 913 → alex@example.com`
followed by the text body. The seeded `alex@example.com` is a
ledger member and therefore allowed. Set `ADMIN_EMAIL=alex@example.com` in
`.dev.vars` to see the owner block; `.dev.vars.example` documents that and the
optional `RESEND_API_KEY` for sending real mail from dev.

## Tests

`test/helpers/auth.ts` keeps the `authedFetch(path, email, init)` and
`authedJson` signatures; they now insert a `sessions` row and send the cookie.
The other integration suites therefore change by at most an import.

Resend is mocked with `fetchMock` (as the extraction tests mock the gateway),
capturing request bodies so a `lastCodeFor(email)` helper can read the code
back. `vitest.config.ts` binds `RESEND_API_KEY: "test"`, `MAIL_FROM`, and
`ADMIN_EMAIL: "admin@example.com"`. `apply-migrations.ts` clears the four new
tables between tests. The `onUnhandledError` workaround for jose is deleted
with jose.

`test/integration/auth.test.ts` (rewritten) covers:

- request → email captured → verify → cookie → `/api/me` works
- five wrong codes kill the code; expired, consumed, and superseded codes
  all yield `code expired`; a superseded code's row is never consulted
- cooldown, per-email hourly cap, global hourly cap, each with `retry_after`
- invite-only: rejected unknown email; allowed via each source (admin, users
  row, ledger member, invite row); open mode admits an unknown email
- sign-out invalidates the row (the same cookie then gets `401`)
- cookie attributes; `Secure` present on https and absent on http
- Origin check: cross-origin POST `403`, same-origin and header-less POSTs pass
- sliding renewal re-emits the cookie inside the 45-day window and not outside
- scan caps: 31st upload in 24 h → `429`; a duplicate upload does not count
- admin routes `403` for a non-admin; each route's happy path; ledger creation
  sends an invite email only when the friend has no `users` row
- no code appears in any log line when `RESEND_API_KEY` is set

## Cutover — no exposure window

1. Resend domain verified; `RESEND_API_KEY` secret set; `ADMIN_EMAIL` and
   `MAIL_FROM` vars in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply tally --remote` — additive, safe before
   the deploy.
3. **Delete both Access applications first.** The old Worker then returns
   `401` to everyone (it still demands an Access JWT no one can obtain), so
   nothing is ever open.
4. Merge to `main` → auto-deploy. Sign in as `ADMIN_EMAIL`; the existing
   friend is allowed through the existing ledger.
5. Rewrite the README's "Cloudflare Access setup" and "Adding a friend"
   sections and DEVIATIONS D5; update the production-setup memory note.

## Standards this maps to

- NIST SP 800-63B out-of-band OTP: CSPRNG 6-digit code, single use, ≤ 10 min
  validity, attempt limiting (5), issuance rate limiting.
- OWASP ASVS v4 §3 sessions: ≥ 64 bits of entropy (256 here), stored hashed,
  `HttpOnly`/`Secure`/`SameSite`, server-side revocation, bounded lifetime.
- Platform: D1 and R2 are encrypted at rest; the account's own 2FA and the
  scoping of the Workers Builds and Resend tokens are the root of trust and
  are configuration, not code.
