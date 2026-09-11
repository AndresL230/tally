# Tally

A receipt-scanning debt ledger for exactly two people, on Cloudflare Workers.
One person photographs a receipt; the app extracts merchant, date, total, and
line items; the uploader assigns items; the balance updates. Extraction
drafts, never posts — a human confirms every entry.

## Stack

- **One Cloudflare Worker** — Workers Static Assets serves the client,
  `/api/*` is a [Hono](https://hono.dev) app (`src/worker/`).
- **React + Vite + TypeScript** client (`src/client/`), ported from the
  design mockup in `mockup/` (kept for reference).
- **D1** for data (`migrations/`), **R2** for receipt images.
- **Anthropic API through Cloudflare AI Gateway** for extraction. The
  API key is a Worker secret; the client never calls the model.
- **Own sign-in** — a 6-digit code emailed through Resend, sessions in D1
  (`src/worker/auth.ts`, `session.ts`). See "Sign-in" below.
- **Vitest with `@cloudflare/vitest-pool-workers`** — tests run in real
  workerd with real D1/R2 bindings; the only fakes are outbound mail
  (Resend) and the model API (fixture responses).

## Money rules (non-negotiable)

- All money is **integer cents** everywhere, including tests.
- The ledger is **append-only**; voids are reversing entries
  (`expenses.reverses_id`).
- **Penny rule**: compute one side, derive the other by subtraction. For the
  proportional tax/tip ("extra") split, the non-payer's share is rounded and
  the payer absorbs the remainder, so the two shares always sum to the total.
- Balances are **derived** (a window function over the `ledger_entries`
  view), never stored.
- Deltas are stored from `person_a`'s perspective forever (`person_a` is the
  lexicographically smaller email); the UI negates for `person_b`, so both
  viewers see positive = "I'm owed".

## Local development

```sh
npm install
npm run seed          # apply migrations + demo data into local D1
npm run build         # build the client once
npm run dev           # wrangler dev on http://127.0.0.1:8787
```

For a client dev loop with HMR, additionally run `npm run dev:client` (Vite
on :5173, proxying `/api` to wrangler).

No `.dev.vars` is required. Without `RESEND_API_KEY` the Worker prints
sign-in codes and invite mail to the wrangler terminal; sign in as
`alex@example.com` (a seeded ledger member) and copy the six digits from
there. `cp .dev.vars.example .dev.vars` makes alex the owner locally so the
owner settings screen shows.

### Tests

```sh
npm test              # typecheck (worker, client, tests) + vitest
```

Migrations are applied from zero on every run. Auth tests mint real session
rows and, for the code flow, patch outbound `fetch` to capture what Resend
would have sent (`test/helpers/mail.ts`).

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

## PWA

The client ships a manifest + icons and installs to the home screen
(standalone display). The dev-only state gallery — the mockup's demo-jump
sidebar reborn as a QA tool — is served ONLY by `npm run dev:client` at
`http://localhost:5173/#gallery` and is excluded from production bundles.
When the session expires inside the installed app, the client navigates to
`/login`, which renders the sign-in screen in place.

## Repository map

```
migrations/   D1 schema (append-only ledger; view + window fn for balances)
src/worker/   Hono app: session middleware, auth/admin routes, D1 queries, mail
src/client/   React app ported from the mockup
src/shared/   Types, money math, canonical<->viewer translation, formatting
test/         Integration (real workerd/D1) + unit/property tests
seed/         Demo data mirroring the mockup
mockup/       The design mockup (reference only; not built)
```

See `DEVIATIONS.md` for every place the implementation deliberately departs
from the spec or mockup.
