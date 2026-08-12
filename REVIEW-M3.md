# REVIEW — M3 (multiple ledgers)

Independent fresh-context review of the M3 diff (commits `e81a399..4e4b7d7`)
against the spec. Findings are the reviewer's; resolutions record what was
done before M4 began.

## What was built

- POST /api/ledgers: new ledger by friend email, canonical member ordering
  for any initiator, race-free pair idempotency (recreating an existing
  pair lands on it), id-reuse 409.
- PUT /api/me: display name + accent color upsert; palette validated
  server-side from the shared constant; identity comes only from the JWT
  (a spoofed body email is proven ignored).
- Client: picker ported from the mockup with viewer-translated balances,
  inline new-ledger form (owner-ruled addition), onboarding minus LinkedIn
  with live accent preview, multi-ledger boot routing.
- Gate tests: exact-id cross-ledger isolation for a member of two ledgers;
  canonical-wire/sign-flip verification from both viewers.

## Reviewer findings and resolutions

- **F1 (major)** With exactly one ledger the picker was unreachable, so
  "+ New ledger" dead-ended at ledger #2 (the design said no back button
  at one ledger; the reviewer flagged the design's consequence).
  **Resolution: fixed by ruling** — the "‹ Ledgers" affordance now shows
  always; with one ledger it is the only road to the picker. DEVIATIONS
  D10.
- **F2 (minor)** ACCENT_PALETTE defined twice (theme + shared).
  **Resolution: fixed** — theme re-exports the shared constant the server
  validates against.
- **F3 (minor)** PUT /api/me with accent_color absent silently nulled a
  stored accent. **Resolution: fixed** — absent keeps, explicit null
  clears; pinned by a test.
- **F4 (minor)** The typo'd-email dead-ledger consequence lived only in a
  code comment. **Resolution: fixed** — documented in DEVIATIONS D10 (the
  Access policy is the real gatekeeper; no ledger deletion by design).
- **F5 (minor)** Prefs were write-once (onboarding only).
  **Resolution: fixed by ruling** — the picker gains a muted "Edit your
  name and color ›" link reopening the onboarding screen in edit mode
  (prefill, Save, Back).
- **F6 (nit)** `as LedgerSummary` cast masked a possible undefined.
  **Resolution: fixed** — loud runtime error instead.
- **F7 (nit)** Onboarding copy adaptations undocumented.
  **Resolution: fixed** — DEVIATIONS D10.

## Reviewer verifications that came back clean

Picker translates canonical balances through viewerDelta before dot color
and amount (zero = hollow dot + "even"). PUT /api/me identity is
JWT-only. The pair-idempotent insert is race-free by construction (single
atomic statement; UNIQUE + CHECK backstop). Email normalization matches
the JWT lowercasing end to end. The friend renders as the fixed dark
neutral regardless of their own accent pref (members' accent_color is
never read for coloring). LinkedIn absent; palette byte-identical to the
mockup. Isolation tests assert exact id lists and exact cents.

## Gate verdict

- Cross-ledger isolation proven: **met** (exact entry-id lists per ledger
  for a two-ledger member, walled summaries, non-member 404s, outsider
  empty list; cross-ledger void 404 from M1 reinforces).
- Sign convention verified from both viewers: **met** at three layers
  (summaries from both members, the 11-entry scenario from both members,
  and the M1 property suite).
- `npm test` including typecheck: green (228 tests at M3 close).

## Deliberately not tested

Component markup for picker/onboarding (visual QA via browser walk:
onboarding → create ledger → empty ledger, screenshots verified). Ledger
deletion (doesn't exist, by design).
