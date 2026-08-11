# REVIEW — M0 (skeleton)

Independent review by a fresh-context reviewer holding only the spec, the
reconciled decisions, the owner's rulings, and the M0 diff. Findings below
are the reviewer's; the "Resolution" lines record what was done in response
before M1 began.

## What was built

Worker + Hono + migration 0001 (full schema, canonical-delta view) + Access
JWT middleware (JWKS verification via jose, committed test-only keypair for
forged-valid JWTs) + Vite React client shell rendering the ledger screen
from seed data mirroring the mockup's demo history in integer cents.

## Reviewer findings and resolutions

- **F1 (major)** No invalid-signature test: every rejected token was either
  malformed or signed by the trusted key; a broken signature check would
  have passed the suite.
  **Resolution: fixed.** Added tests: claims-perfect token signed by an
  untrusted key → 401; token with unknown `kid` → 401; trusted-key token
  without `exp` → 401 (plus `algorithms: ["RS256"]` and
  `requiredClaims: ["exp","email"]` pinned in `jwtVerify`, per F5).
- **F2 (major)** `DEV_ALLOW_USER` bypass had no deliberate tests, and the
  developer's gitignored `.dev.vars` leaked into the test environment.
  **Resolution: fixed.** `DEV_ALLOW_USER` is now bound explicitly in
  vitest.config.ts (hermetic regardless of `.dev.vars`), with four tests:
  localhost → dev identity, 127.0.0.1 → dev identity, non-localhost host →
  401 even with the var set, lookalike host (`localhost.evil.example`) → 401.
- **F3 (major)** `viewerDelta`/`canonicalDelta`, `orderMembers`, and all of
  format.ts shipped untested; fast-check unused.
  **Resolution: fixed across M0/M1.** `test/unit/format.test.ts` added at M0
  close (formatting, zero-sign, parseDollarsToCents edge cases).
  Property tests for money math and sign translation are M1's adversarial
  suite (written from the contract before the implementation).
- **F4 (minor)** No FK on `expenses.receipt_id`; membership of
  payer/from/to not enforceable in SQL.
  **Resolution: fixed/accepted.** Migration reordered so `receipts` exists
  first and `expenses.receipt_id REFERENCES receipts(id)`. Member checks on
  payer/from_email/to_email are route-level validation (SQLite can't
  cross-table CHECK) — implemented and tested in M1's mutation routes.
- **F5 (minor)** Verification not pinned to RS256; `exp` optional.
  **Resolution: fixed** (see F1).
- **F6 (minor)** Test hermeticity vs `.dev.vars`. **Resolution: fixed** (F2).
- **F7 (nit)** `moneySigned(0)` rendered `+$0.00`; mockup renders `−$0.00`.
  **Resolution: fixed** to match the mockup, pinned by test.
- **F8 (nit)** Top-bar wordmark font was Archivo; mockup uses the bar's IBM
  Plex Mono. **Resolution: fixed during M1's client port.**
- **F9 (nit)** Schema hardening beyond the spec DDL wasn't logged.
  **Resolution: fixed** — DEVIATIONS.md D6.
- **F10 (nit)** Dead code (future-milestone helpers) shipped in M0.
  **Resolution: accepted** — they are M1 stock (parseDollarsToCents, percent
  helpers, etc.) and gained tests in F3's resolution; unused variable removed.

## Reviewer verifications that came back clean

Seed penny-rule arithmetic recomputed by hand (all four item receipts);
view sign convention for expenses and settlements; no float leakage; no
display strings feeding math; no viewer-relative storage; same-day ordering
by created_at then id; membership authorization on the ledger routes.

## Gate verdict

- Authed/unauthed integration test: **met** (strengthened per F1/F2).
- Migrations from zero: **met** (applied per run against real D1; asserted).
- Typecheck green: **met** (`tsc` ×3 + 26 tests passing at M0 close).
- Deployed and reachable: **blocked-documented** — needs the Cloudflare
  dashboard (HUMAN_TODO.md steps 1 & 3). Verified locally instead:
  `wrangler dev` serves the seeded API and built client.

## Deliberately not tested

Client markup (owner ruled component tests a judgment call; the shell is
exercised manually via seed + wrangler dev). Deployment (credential-blocked).
