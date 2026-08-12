# HUMAN_TODO — manual steps requiring the Cloudflare dashboard or credentials

Everything here needs the Cloudflare dashboard or credentials the repo does
not have. Nothing below is faked or stubbed in code — the app is fully
verified locally (wrangler dev + `npm test`); these steps take it to
production. Steps are in order.

## 1. Create the D1 database (unblocks deploying M0+)

```sh
npx wrangler d1 create tally
```

Copy the printed `database_id` into `wrangler.jsonc` →
`d1_databases[0].database_id` (replacing the zero placeholder), then:

```sh
npx wrangler d1 migrations apply tally --remote
```

## 2. Create the R2 bucket (unblocks receipt upload in M2)

```sh
npx wrangler r2 bucket create tally-receipts
```

(The binding in `wrangler.jsonc` already points at `tally-receipts`.)

## 3. First deploy

```sh
npm run deploy
```

This publishes the Worker with static assets. Note the `workers.dev` URL —
you will disable it in step 4 once the custom domain + Access are live.

## 4. Cloudflare Access application (auth — REQUIRED before real use)

In the Zero Trust dashboard (`one.dash.cloudflare.com`):

1. **Settings → Authentication → Login methods**: ensure **One-time PIN**
   is enabled (it is by default). No other IdP is needed.
2. **Access → Applications → Add an application → Self-hosted**:
   - Application name: `Tally`
   - Session duration: **1 month**
   - Public hostname: the domain you'll serve Tally on (add the Worker
     custom domain first: Workers & Pages → tally → Settings → Domains &
     Routes → Add → Custom domain, e.g. `tally.yourdomain.com`).
3. **Policy**: name `Members`, action **Allow**, include →
   **Emails**: your email and each friend's email. This list is the app's
   entire user directory — nobody else can even see the login page succeed.
4. After creating, open the application's **Overview** and copy:
   - the **Application Audience (AUD) tag** → `ACCESS_AUD` in `wrangler.jsonc`
   - your team domain (e.g. `yourteam.cloudflareaccess.com`) →
     `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`
5. Redeploy: `npm run deploy`.

## 5. Disable the workers.dev route (so nothing bypasses Access)

Workers & Pages → tally → Settings → Domains & Routes → `workers.dev` →
**Disable**. Access only fronts the custom domain; the workers.dev URL would
otherwise be an unauthenticated side door (requests there carry no valid
Access JWT so the API returns 401, but the login flow only works on the
Access-fronted domain).

## 6. AI Gateway + Anthropic key (unblocks live extraction, M2)

1. Dashboard → **AI → AI Gateway → Create gateway** (name e.g. `tally`).
2. Put your account id into `AI_GATEWAY_ACCOUNT_ID` and the gateway name
   into `AI_GATEWAY_ID` in `wrangler.jsonc`.
3. Set the model key as a Worker secret (never a var, never in git):

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

4. Redeploy.

Until this step, receipt photo upload works but extraction returns a clear
"extraction not configured" failure and the app falls back to manual entry
(this is the gated live-call path — fixtures cover extraction in tests).

### Post-setup verification (live end-to-end extraction test)

Photograph a real receipt on your phone → confirm screen shows extracted
merchant/date/total/items → assign a couple of items → commit → balance
moves. Then photograph the SAME receipt again and confirm the app reuses the
existing receipt (dedupe by SHA-256) instead of re-extracting.

## 7. Adding a friend to the app (repeat per friend)

1. Zero Trust → Access → Applications → Tally → Policies → `Members` →
   add their email.
2. In the app: New ledger → enter the same email.

Both steps are required: the policy gets them through login, the ledger
makes them visible in the app.

## 8. Seeding real data (optional)

`seed/seed.sql` is demo data keyed to `alex@example.com`. For production
just start using the app; there is nothing to seed.

## 9. M4 manual phone checklist (after steps 1-6)

Run through this on a REAL phone against the deployed, Access-fronted URL.
Check each item off:

- [ ] **Access OTP login**: open the app URL in the phone browser; enter
      your email; the 6-digit code arrives and logs you in. (Your email
      must be in the Access policy — step 4.)
- [ ] **Install**: browser menu -> Add to Home Screen. The tally-slash
      icon appears; launching opens standalone (no browser chrome), paper
      background edge to edge.
- [ ] **Camera**: Add receipt -> Take a photo opens the camera directly
      (capture=environment); shooting a receipt lands on the reading
      screen and then confirm.
- [ ] **Library**: Choose from library picks an existing photo.
- [ ] **Live extraction end-to-end** (step 6 done): a real receipt photo
      extracts merchant/date/total/items; assign a couple of items; the
      owed line moves per tap; commit; the balance updates. Photograph the
      SAME receipt again: the app says it's already on the ledger.
- [ ] **Expired session in standalone mode**: Zero Trust -> My Team ->
      Users -> revoke your session (or wait out the 1-month duration).
      Reopen the installed app: it must bounce through the Access login
      and come back working — not hang on a blank screen. (The client
      reloads the document when an API call gets redirected to Access.)
- [ ] **Both-viewers check**: log in as your friend on their phone; the
      same ledger shows the same magnitude with the direction flipped.

---

## Milestone gate status affected by this file

- **M0 gate** "deployed and reachable": blocked on steps 1, 3. Everything
  else in the gate (auth tests, migrations from zero, typecheck) is verified
  locally by `npm test`.
- **M2** live extraction: blocked on step 6 (fixtures fully cover the
  extraction contract in tests; the live path is gated on the secret's
  presence).
- **M4** manual phone checklist (step 9): blocked on steps 3–5 (needs a
  real Access-fronted URL on a phone). Everything else in M4 (manifest,
  icons, camera capture, dev gallery, expired-session reload handling) is
  built and verified locally.
