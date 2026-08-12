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
- **Cloudflare Access (One-Time PIN)** for auth — Access hosts login before
  requests reach the Worker; the Worker verifies the Access JWT against the
  team JWKS on every `/api/*` request.
- **Vitest with `@cloudflare/vitest-pool-workers`** — tests run in real
  workerd with real D1/R2 bindings; the only fakes are Access JWTs (signed
  with a committed test-only key) and the model API (fixture responses).

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
cp .dev.vars.example .dev.vars   # local identity (alex@example.com)
npm run build         # build the client once
npm run dev           # wrangler dev on http://127.0.0.1:8787
```

For a client dev loop with HMR, additionally run `npm run dev:client` (Vite
on :5173, proxying `/api` to wrangler).

`DEV_ALLOW_USER` (from `.dev.vars`) bypasses Access **only for localhost
requests**, because `wrangler dev` has no Access in front of it. Never set it
on a deployed Worker.

### Tests

```sh
npm test              # typecheck (worker, client, tests) + vitest
```

Migrations are applied from zero on every run. Auth tests forge valid JWTs
with the committed test-only keypair in `test/keys/` and exercise the real
verification path (signature, issuer, audience, expiry).

## Cloudflare Access setup (auth)

Access hosts the login screen itself — the app has no sign-in UI and boots
assuming an authenticated request. The shape:

1. **Create an Access application** (Zero Trust → Access → Applications →
   Add → Self-hosted) for the app's hostname.
2. **Login method: One-Time PIN** only (Zero Trust → Settings →
   Authentication). Users enter their email, get a 6-digit code.
3. **Policy**: Allow, with an explicit list of member emails. This list is
   the app's entire user directory.
4. **Session duration: 1 month**, so the PWA doesn't re-prompt constantly.
5. **Disable the `workers.dev` route** for the Worker (the custom domain is
   the only entry, so nothing bypasses Access).
6. Copy the application **AUD tag** into `ACCESS_AUD` and your team domain
   into `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`.

The Worker verifies `Cf-Access-Jwt-Assertion` against
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (keys cached per
isolate). The `Cf-Access-Authenticated-User-Email` header is never trusted —
or read. D1 stores no auth data.

### Adding a friend

Two steps, both required:

1. **Access policy**: add their email to the Access application's Allow
   policy (Zero Trust dashboard) so they can log in at all.
2. **Create the ledger**: in the app, "New ledger" → enter their email.

## PWA

The client ships a manifest + icons and installs to the home screen
(standalone display). The dev-only state gallery — the mockup's demo-jump
sidebar reborn as a QA tool — is served ONLY by `npm run dev:client` at
`http://localhost:5173/#gallery` and is excluded from production bundles.
When the Access session expires inside the installed app, the client
reloads the document so Access can host its login again.

## Repository map

```
migrations/   D1 schema (append-only ledger; view + window fn for balances)
src/worker/   Hono app: Access JWT middleware, routes, D1 queries
src/client/   React app ported from the mockup
src/shared/   Types, money math, canonical<->viewer translation, formatting
test/         Integration (real workerd/D1) + unit/property tests
seed/         Demo data mirroring the mockup
mockup/       The design mockup (reference only; not built)
```

See `DEVIATIONS.md` for every place the implementation deliberately departs
from the spec or mockup.
