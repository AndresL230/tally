# FINAL REPORT — Tally, M0 through M4

Built straight through with self-enforced gates. Every milestone got an
independent fresh-context review (spec + diff only); every finding was
fixed or explicitly accepted before the next milestone started. The full
review records are REVIEW-M0.md … REVIEW-M4.md; every deviation is in
DEVIATIONS.md (D1–D10).

**Milestone boundaries** (tags exist locally; the git remote refuses tag
refs, so each boundary is also a remote branch you can diff on GitHub):

| Milestone | Commit | Remote branch |
|---|---|---|
| m0 | `e156e1c` | `milestone/m0` |
| m1 | `3210ecc` | `milestone/m1` |
| m2 | `e81a399` | `milestone/m2` |
| m3 | `3bd0f42` | `milestone/m3` |
| m4 | `7c0d5f3` | `milestone/m4` |

`git diff milestone/m1..milestone/m2` etc. shows exactly what a milestone
added.

## What shipped, per milestone

**M0 — skeleton.** One Worker (Hono `/api/*` + Static Assets), migration
0001 (the complete schema: users, ledgers with `person_a < person_b`
enforced, append-only expenses/settlements, receipts with
`UNIQUE(ledger_id, sha256)`, receipt_items with canonical `assigned_to`,
and the `ledger_entries` view producing person_a-perspective deltas),
Access JWT middleware (jose against the team JWKS, RS256 pinned,
exp/email required, cookie + header sources, the
`Cf-Access-Authenticated-User-Email` header never read), Vite React shell
rendering the ledger screen from seed data mirroring the mockup demo in
integer cents. Gate review forced: an invalid-signature test (the suite
couldn't previously detect a broken signature check), hermetic + tested
DEV_ALLOW_USER localhost bypass, receipts FK, mockup-exact zero-sign
formatting.

**M1 — the ledger, no AI.** `src/shared/money.ts` (BigInt integer-cents
split math; half items summed in half-cent units and rounded once; the
non-payer's extra share rounded, payer absorbs the remainder; every
counterpart derived by subtraction), mutation routes (expenses percent/
manual, settlements, void-as-reversal with 409s for double-void and
void-of-void), and the ported screens: manual entry (by-hand + photo-fail
copy variants, tax-region estimate chips per decision C, percentage
split), settle up, entry detail with a beat-confirmed void affordance,
percent screen, app state machine with one idempotency UUID per commit
intent. The adversarial test suite was written from the contract BEFORE
the implementation; first contact found one real contract ambiguity
(cross-ledger id collision → now 409, D7). Gate review forced: a
backdated-entry ordering test (nothing previously could catch an ORDER BY
regression), client error surfacing, robust double-void detection.

**M2 — receipts.** Upload with SHA-256 dedupe (same bytes twice in a
ledger = one receipt, one R2 object, never a second model call),
extraction through AI Gateway with a forced `record_receipt` tool AND
field-level salvage (garbage date → null; one bad item drops the list;
not-a-receipt/malformed → all blank; always `needs_review`/`failed`,
never a crash), result caching in `raw_json`, the live call gated on the
`ANTHROPIC_API_KEY` secret (503 until HUMAN_TODO step 6), items-method
expenses (server recomputes the split and ignores client-sent shares;
printed total wins; extra may be negative), reading + confirm screens
(three-state toggle through `shared/assign`, single extra line per
decision C, add-item, beat-confirm), camera/library capture with ~1500px
JPEG downscale. Gate review forced: claim-based extraction (two members
scanning the same paper receipt can't double-call the model),
transaction-gated posting (two concurrent confirms can't double-post),
discarded-receipt resurrection (D8/D9), upload row-before-object
ordering, a payer toggle on the percent fallback.

**M3 — multiple ledgers.** Picker (viewer-translated balances, mockup
dot/amount vocabulary), new-ledger-by-email (canonical ordering for any
initiator; race-free pair idempotency; the Access policy documented as
the other half of adding a friend), prefs (onboarding minus LinkedIn,
palette validated server-side from a single shared constant, identity
JWT-only). Gate review forced: an always-visible road back to the picker
(new-ledger was unreachable with exactly one ledger), post-onboarding
prefs editing, absent-vs-null accent semantics (D10).

**M4 — PWA + gallery.** Manifest + reproducibly-generated slash-wordmark
icons + install metadata; expired-Access-session handling
(`redirect:"manual"` + opaqueredirect → guarded document reload so the
installed app re-enters hosted login); the dev-only state gallery — 21
states × 6 accents rendered through the real screen components with
penny-consistent fixtures, proven absent from production bundles (single
chunk, no markers). The gallery immediately paid for itself by exposing a
vite dev-proxy bug (`/api` prefix swallowing `/api.ts`). Final
whole-project sweep: no non-negotiable rule violations.

## Test suite (228 tests, all green, `npm test` = typecheck ×3 + vitest in real workerd with real D1/R2)

| File | What it proves |
|---|---|
| unit/money.property.test.ts (23) | See below — the money properties |
| unit/ledger-sign.test.ts (11) | Sign translation round-trips |
| unit/assign.test.ts (28) | Three-state toggle machine, beat rule |
| unit/format.test.ts (9) | Integer-cents formatting/parsing edges |
| integration/auth.test.ts (17) | Real JWT verification incl. forged-key rejection; DEV bypass fencing |
| integration/schema.test.ts (5) | Migrations from zero, view deltas, ordering, membership |
| integration/mutations.test.ts (~57 runtime) | Route validation, authz on every mutation route, idempotency with row counts, void semantics |
| integration/scenario.test.ts (1 big) | The hand-computed 11-entry history |
| integration/receipts.test.ts (~65 runtime) | All seven extraction fixtures through the real route, dedupe, claim, discard/resurrect, items posting, the M2 gate walk |
| integration/prefs.test.ts (12) | New-ledger flow, prefs, cross-ledger isolation, both-viewer signs |

**What the property tests actually assert** (fast-check against
independent BigInt oracles, not restatements of the implementation):

- For ANY integer total 0..10M and ANY item list (0..60 items, prices
  0..1M, assignments payer/other/half): `other_share + payer_share ===
  total` EXACTLY, `other_sub + payer_sub === items_subtotal`,
  `other_extra + payer_extra === extra`, all outputs safe integers.
- The halving rule: half items accumulate in half-cent units and round
  ONCE (killer cases pin that 2×101¢-half = 101, not 51+51=102).
- All-items-to-other ⇒ other_share === total exactly; all-to-payer ⇒ 0.
- Negative extra (total below subtotal — discounts) satisfies the same
  identities and distributes proportionally.
- `divRoundHalfUp` matches a BigInt floor-based oracle on halves toward
  +infinity, including negatives.
- `percentShare(t,p) + (t − percentShare(t,p)) === t`; 0→0, 100→total,
  odd-cent half-up pinned.
- Viewer translation: `canonicalDelta(viewerDelta(x)) === x` for both
  members; person_a's view is exactly the negation of person_b's;
  non-members throw.
- Reversal (integration): voiding any entry restores the prior balance
  exactly, asserted mid-history in the hand-computed scenario.

The 11-entry scenario posts through the real routes, hand-computes every
running balance in comments (odd-cent percent shares), includes a
same-day tie broken by created_at, a mid-history reversal, AND a
backdated entry posted last that must re-rank the whole tail — then
asserts the full sequence from both members' GETs.

## Deviations (full text in DEVIATIONS.md)

- **D1** Half-item rounding: sum in half-cent units, round once, half-up.
- **D2** Seed mirrors the mockup's *computed* values, in cents.
- **D3** Fake phone status bar not ported.
- **D4** Non-member access is 404 (no existence oracle), not 403.
- **D5** DEV_ALLOW_USER localhost-only dev identity (never in prod).
- **D6** Schema hardening beyond the spec DDL (CHECKs, UNIQUEs, FKs).
- **D7** Cross-ledger idempotency-id collision → 409, nothing echoed.
- **D8** Re-uploading a discarded receipt's bytes resurrects it.
- **D9** Extraction/posting are claim-based; residual: a crashed
  extraction leaves 'extracting' until the client's poll gives up (no
  timed reclaim; acceptable for two people).
- **D10** Nav/prefs affordances the mockup never drew (back-to-picker,
  new-ledger form, prefs editing, onboarding copy generalizations).

## HUMAN_TODO state (complete; nothing faked or marked done)

All nine steps remain yours — they need the Cloudflare dashboard or
credentials the repo doesn't have:

1. `wrangler d1 create tally` + paste the id into wrangler.jsonc + remote
   migrations — unblocks deploy (M0 gate's "deployed and reachable").
2. `wrangler r2 bucket create tally-receipts` — unblocks receipt storage.
3. `npm run deploy` — first deploy.
4. Access application: OTP login method, `Members` email-list policy,
   1-month session, custom domain, AUD tag + team domain into
   wrangler.jsonc, redeploy.
5. Disable the workers.dev route.
6. AI Gateway + `wrangler secret put ANTHROPIC_API_KEY` — unblocks live
   extraction (until then upload works and extraction 503s into manual
   entry, by design).
7. Adding a friend = Access policy + New ledger (both, every time).
8. (Optional) demo seed — production needs nothing.
9. The M4 manual phone checklist: OTP login, Add to Home Screen, camera,
   library, live extraction + same-receipt dedupe, expired-session
   reload in standalone, both-viewers sign check.

## The ten-minute path: clone → phone

Prereqs: a Cloudflare account with a zone (for the custom domain), an
Anthropic API key, Node 22+.

```sh
git clone <repo> && cd tally && npm install        # ~2 min
npx wrangler login
npx wrangler d1 create tally                        # paste id into wrangler.jsonc
npx wrangler d1 migrations apply tally --remote
npx wrangler r2 bucket create tally-receipts
npm run deploy                                      # ~1 min
```

Dashboard (~4 min): Workers & Pages → tally → add custom domain
`tally.yourdomain.com`; Zero Trust → Access → add the self-hosted app on
that hostname, session 1 month, policy = your email + your friend's;
copy the AUD tag and team domain into wrangler.jsonc; AI → AI Gateway →
create `tally`, put the account id + gateway name into wrangler.jsonc;
disable the workers.dev route. Then:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy                                      # picks up vars
```

Phone (~2 min): open `https://tally.yourdomain.com`, enter your email,
type the 6-digit code, Add to Home Screen. Tap the tally-slash icon,
"New ledger", your friend's email, "Add receipt", photograph dinner.
Their phone shows what they owe you.

## Where things stand

- 228 tests green, typecheck green, production build green, 22+ commits
  with per-unit messages, five review documents, ten logged deviations.
- Verified locally end to end: wrangler dev + seeded D1 + real browser
  walks of every screen (onboarding → create ledger → manual/settle/
  void/detail → photo flow to the failure path), plus the gallery for
  the confirm-screen states that need extraction to reach.
- NOT verified (impossible without credentials, all queued in
  HUMAN_TODO): a real deploy, real Access OTP, live extraction against
  the real API, and the phone checklist. The live-call path is gated on
  the secret's presence and fails into manual entry until then.
