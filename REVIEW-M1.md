# REVIEW — M1 (the ledger, no AI)

Independent fresh-context review of the M1 diff (commits `e156e1c..f7255fd`)
against the spec and the M1 contract. Findings are the reviewer's;
resolutions record what was done before M2 began.

## What was built

- `src/shared/money.ts`: integer-cents split math (BigInt internally).
  Half items accumulate in half-cent units and round once; the non-payer's
  extra share is rounded, the payer absorbs the remainder; every
  counterpart is derived by subtraction so shares sum to the total exactly.
- Mutation routes: POST expenses / settlements / void with validation,
  member-only 404s, client-UUID idempotency, void-as-reversal.
- Adversarial test suite written from the contract BEFORE implementation
  (independent BigInt oracles, property tests, route tests, the
  hand-computed scenario) — 89/90 passed on first contact; the one failure
  was a genuine contract ambiguity (below).
- Client: manual entry (by-hand + photo-failed copy variants, tax-region
  estimate chips per decision C, percentage split), percent fallback
  screen (navigation lands in M2), settle up, entry detail with void
  affordance, add-receipt sheet, App state machine with one idempotency
  UUID per commit intent.

## Contract amendment found by the tests

Cross-ledger id collision: the contract said "no-op returning the
original"; the implementation returns **409 with nothing echoed** because
echoing another ledger's row leaks data. The amendment won; DEVIATIONS.md
D7. (The same-ledger repeat stays a 200 no-op per spec rule 4.)

## Reviewer findings and resolutions

- **F1 (major)** The 409 amendment was documented nowhere in the repo
  (this file didn't exist yet; DEVIATIONS untouched).
  **Resolution: fixed** — this file + DEVIATIONS D7.
- **F2 (major)** Ordering assertions couldn't fail against a wrong ORDER
  BY: view order always equaled insertion order, so `ORDER BY created_at`
  alone would pass, and nothing exercised occurred_on outranking
  created_at. **Resolution: fixed** — the scenario now posts an 11th,
  BACKDATED entry last (occurred_on between entries 3 and 4); it must slot
  fourth and shift every later running balance (+250), which an
  insertion-ordered view cannot reproduce.
- **F3 (minor)** Cross-ledger 409 implemented on all three routes but
  tested on one. **Resolution: fixed** — settlement cross-ledger test and
  void reversal-id-collision test added, with row-count and balance
  assertions.
- **F4 (minor)** Client swallowed mutation failures silently; a stale
  intent id could eat fresh edits if the POST landed but the refresh threw.
  **Resolution: fixed** — failures surface as a notice line (mockup's
  border-left vocabulary); the intent id is released the moment the POST
  succeeds.
- **F5 (minor)** "already voided" detection string-matched the D1 driver
  error. **Resolution: fixed** — explicit pre-check plus a re-query
  fallback on any insert failure; no reliance on error text.
- **F6 (minor)** Latent tie flake: the same-day tie assertion tolerated
  equal created_at, which would fall to random-UUID ordering.
  **Resolution: fixed** — strictly-less assertion so any flake surfaces
  legibly.
- **F7 (minor)** Settled line counted voided originals and reversals as
  "receipts". **Resolution: fixed** — voided pairs excluded from the
  count.
- **F8 (nit)** parseDollarsToCents truncates a third decimal ("12.999" →
  1299) and strips minus signs. **Resolution: accepted** — both fields are
  positive-amount inputs; truncation beats float rounding; pinned by test.
- **F9 (nit)** splitItems accepted a negative total. **Resolution: fixed**
  — throws, matching percentShare.

## Reviewer verifications that came back clean

Float hunt across the client (parseFloat/toFixed/Math.round on money):
only color shading. pct semantics match the contract in both payer cases.
Settle direction correct for both balance signs. Nothing viewer-relative
crosses the wire. Property oracles are genuinely independent (different
formulation than the implementation) with per-item-rounding killer cases.
The reviewer recomputed the full scenario arithmetic by hand and matched
every value; idempotency tests assert row counts and balances, not just
statuses.

## Gate verdict

- Property tests on money math: **met**.
- Hand-computed scenario (same-day tie + mid-history reversal): **met**,
  strengthened with the backdated-entry ordering case.
- Authorization on every route: **met** (non-member 404 with row-count
  assertions, unauthenticated 401, no existence oracle).
- `npm test` including typecheck: green (124 tests at M1 close).
- "Owner uses the app for real": deferred to post-deploy
  (credential-blocked; HUMAN_TODO.md). Local stand-in: seeded wrangler dev
  walked through every M1 screen with Playwright screenshots verified
  against the mockup.

## Deliberately not tested

Component-level markup tests (owner ruled judgment call — visual review
done manually via screenshots). Deployment (credential-blocked).
