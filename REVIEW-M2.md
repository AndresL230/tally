# REVIEW — M2 (receipts)

Independent fresh-context review of the M2 diff (commits `3210ecc..b740b40`)
against the spec and the M2 contract. Findings are the reviewer's;
resolutions record what was done before M3 began.

## What was built

- Receipt upload with SHA-256 dedupe (same bytes twice in a ledger is one
  receipt, one R2 object, and never a second model call), content-type and
  size limits, id-collision 409s.
- Extraction through AI Gateway with a forced `record_receipt` tool call
  AND field-level schema salvage (rule 7): garbage dates null out, one bad
  item drops the whole item list, not-a-receipt/malformed blank everything,
  every path lands in `needs_review` or `failed` — never a crash. Results
  cache in `raw_json`; the live call is gated on the ANTHROPIC_API_KEY
  secret (503 "extraction not configured" until HUMAN_TODO step 6).
- Items-method expenses: the server recomputes the split with `splitItems`
  and ignores client-sent shares; the confirmed item set replaces the
  extracted one; the receipt is stamped posted with the human-approved
  merchant/date/total. Percent/manual expenses can carry a receipt link.
- Client: reading screen (timer-driven steps that never finish ahead of the
  real round-trip), confirm screen (three-state spine/tint toggle via
  shared/assign, single extra line per decision C, add-item, beat-confirm),
  camera/library capture with ~1500px JPEG downscale (rule 8), routing to
  confirm/percent/manual-photofail, discard-on-cancel.
- Seven extraction fixtures + 91 M2 tests, written from the contract before
  the implementation, with the gateway mocked at the fetch boundary using
  armed-interceptor accounting (a worker that skips the model call fails).

## Reviewer findings and resolutions

- **F1 (major)** No `extracting` guard: two members scanning the same paper
  receipt could trigger two model calls (dedupe lands them on one row; the
  second extract sailed past the cache check).
  **Resolution: fixed** — extract now claims the job with a conditional
  write (`status='extracting' WHERE status IN ('uploaded','failed') AND
  raw_json IS NULL`); losers get the current state and the client polls
  until the winner's result lands. Pinned by a no-interceptor-armed test
  (a gateway call would fail it). DEVIATIONS D9.
- **F2 (major)** Receipt-status check sat outside the write batch: two
  concurrent confirms could double-post one receipt.
  **Resolution: fixed** — the expense insert is gated on the receipt still
  being available INSIDE the transactional batch (`INSERT ... SELECT ...
  WHERE EXISTS`), and every follow-up statement is gated on that insert
  having landed; the loser falls through to a 409. DEVIATIONS D9.
- **F3 (major)** A discarded receipt was a permanent dead end: re-picking
  the same photo deduped onto it and every commit 409'd, including the
  manual escape hatch (which blindly attached the receipt id).
  **Resolution: fixed** — re-uploading the bytes resurrects the receipt
  (needs_review if extracted, uploaded if not; items survive), and the
  client no longer attaches posted/discarded receipt ids to manual
  entries. Contract amended; DEVIATIONS D8; tests updated to pin the new
  behavior.
- **F4 (minor)** No M2 DEVIATIONS entries / REVIEW-M2.md at review time.
  **Resolution: fixed** — this file, D8, D9.
- **F5 (minor)** Percent fallback hardwired the viewer as payer; a
  no-items receipt the friend paid was unrecordable.
  **Resolution: fixed** — the payer segment of the percent screen's meta
  line is tappable (the mockup has no payer toggle there; smallest
  faithful addition), and the commit carries the chosen payer.
- **F6 (minor)** Upload races could leave an orphan R2 object or an
  object whose bytes disagree with the row's sha256.
  **Resolution: fixed** — the D1 row (PK + sha UNIQUE) is written before
  the R2 object, so the database decides every race before bytes land; a
  failed put compensates by deleting the row.
- **F7 (nit)** >100 extracted items silently dropped the list without a
  documented rule. **Resolution: fixed** — commented as deliberate.
- **F8 (nit)** Receipt lookup before membership check (no response oracle,
  micro timing channel only). **Resolution: accepted, commented.**
- **F9 (nit)** A non-gateway throw after status='extracting' could strand
  the receipt. **Resolution: fixed** — any failure after the claim
  releases it as 'failed' (re-claimable).

## Reviewer verifications that came back clean

Rule 5: the built client bundle contains no trace of the key, the gateway
URL, `raw_json`, `r2_key`, or `sha256`; API responses whitelist ApiReceipt
fields. Rule 7 request shape asserted from the captured gateway body.
No money floats anywhere new (image downscale floats are pixel math).
st codes never cross the wire; the server 400s viewer-relative junk.
Cross-ledger double extraction (same bytes, two ledgers) is intended,
per-ledger UNIQUE, and tested.

## Gate verdict

- All extraction fixtures pass: **met** (seven fixtures through the real
  route in workerd, HTTP + DB truth asserted).
- Same-bytes-twice is one receipt: **met** (different ids, same id,
  discarded-resurrection, per-ledger boundary, one R2 object).
- Toggle state machine tested: **met** (cycle properties, both translation
  directions, beat truth table).
- Upload → needs_review → posted walk with balance check: **met**
  (hand-derived split cross-checked against splitItems, both members'
  GETs, idempotent repeat).
- `npm test` including typecheck: green (216 tests at M2 close).

## Deliberately not tested

Live extraction end-to-end (needs the real key — HUMAN_TODO step 6 defines
the post-setup verification). Confirm-screen visual QA beyond typecheck
and build (the M4 dev gallery renders it directly for review; the
photo-failure path was walked in a real browser). Timed reclaim of a
crashed extraction claim (documented residual in D9).
