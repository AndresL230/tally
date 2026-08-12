# REVIEW — M4 (PWA + dev gallery) and final whole-project sweep

Independent fresh-context review of the M4 diff (commits `3bd0f42..4a41b07`
plus PWA commits) with a final whole-project rules sweep. Findings are the
reviewer's; resolutions record what was done before the project was called
done.

## What was built

- PWA: webmanifest (standalone, paper theme), slash-wordmark icons
  (192/512/maskable) generated reproducibly by `scripts/make_icons.py`
  (zero image dependencies; committed PNGs regenerate byte-identically),
  apple/mobile install metadata.
- Expired-Access-session handling in the API client so the installed app
  re-enters the hosted OTP login instead of stranding.
- The dev-only state gallery (decision E): 21 states × 6 accents rendered
  through the REAL screen components with penny-consistent fixtures;
  mounted only under `import.meta.env.DEV && #gallery`; production bundle
  proven byte-identical with zero gallery code.
- Bonus catch: the vite dev proxy key `/api` was swallowing the client's
  own `/api.ts` module; fixed to `/api/`, verified live.
- HUMAN_TODO step 9: the manual phone checklist (OTP, install, camera,
  library, live extraction + dedupe, expired session in standalone,
  both-viewers check).

## Reviewer findings and resolutions

- **F1 (major)** The expired-session detection handled the redirect the
  fetch spec describes, not what browsers deliver: Access's cross-origin
  302 makes `fetch` (follow mode) reject with a TypeError before any
  response is observable, so the reload branch was likely dead code.
  **Resolution: fixed** — API fetches now use `redirect: "manual"`; no
  legitimate `/api` route ever redirects, so `res.type ===
  "opaqueredirect"` deterministically means "Access wants login" and
  triggers the reload. Real-deployment verification remains on the phone
  checklist.
- **F2 (minor)** `location.reload()` had no loop guard (a captive portal
  or cached-HTML corner could reload forever). **Resolution: fixed** —
  at most one auth reload per 15s (sessionStorage timestamp), after which
  the error surfaces instead.
- **F3 (minor)** The gallery's reversal fixture drifted from the server's
  actual void shape (note/share-sign/created_by). **Resolution: fixed** —
  mirrors the mutations.ts insert exactly.
- **F4 (nit)** Comment/code drift ×3 in make_icons.py. **Resolution:
  fixed.**
- **F5 (nit)** Maskable icon glyph unnecessarily small inside the safe
  zone. **Resolution: fixed** — padding 0.28 → 0.22, regenerated.
- **F6 (nit)** The gallery's beat-state auto-arm matched button copy and
  would degrade silently if it changed. **Resolution: fixed** —
  `data-testid="confirm-commit"` on the real button; the gallery matches
  the testid.
- **F7 (nit)** Missing modern `mobile-web-app-capable` meta companion.
  **Resolution: fixed.**

## Reviewer verifications that came back clean

Manifest fields vs actual PNG dimensions (IHDR-parsed); icons decode and
regenerate byte-identically; gallery renders real components and its
fixture money flows through the shared split functions (Safeway entry
re-verified numerically); prod bundle contains no gallery markers and a
single JS chunk; camera capture + 1500px downscale intact from M2; vite
proxy fix verified against a live worker.

**Whole-project sweep: no non-negotiable rule violations found.**
Integer cents throughout; append-only voids; penny rule verified;
idempotency tested; the Anthropic key unreachable from the client;
JWT verification + membership checks on every route; DEV_ALLOW_USER
restricted to loopback and absent from production config; no debris.

## Gate verdict

- Manifest / camera capture / install metadata: **met**.
- Dev state gallery route, excluded from production: **met, proven**.
- Manual checklist (Access OTP on a real phone, camera, expired-session
  in standalone): **blocked-documented** — HUMAN_TODO step 9, runnable
  the moment steps 1–6 are done. Everything locally verifiable was
  verified locally.
- `npm test` including typecheck: green (228 tests at project close).
