# DEVIATIONS — running log of departures from the spec or mockup

Each entry says what deviates, from what, and why. Newest at the bottom.

## D1. Half-item rounding (mockup float math → integer cents)

The mockup computes a half item's share as `price / 2` in floats. In integer
cents an odd price doesn't halve. Rule implemented: the other person's item
subtotal is accumulated in **half-cent units** and rounded **once** at the
end (round-half-up), rather than rounding each half item individually —
one rounding step keeps the distortion under a cent regardless of item
count. The payer's side is derived by subtraction (penny rule), so shares
always sum to the total. Consequence: item entries can display a cent off
from the mockup's float demo values (e.g. seed Safeway is $71.59 where the
mockup showed $71.58).

## D2. Mockup demo entries' stored deltas are ignored where items exist

The mockup's `deltaOf()` recomputes item entries' deltas from items and
ignores the hardcoded `delta` fields (e.g. Lardo is listed as −33.75 but
renders as −23.67). The seed mirrors the *computed* behavior, in cents.

## D3. Phone-frame chrome is not ported

The mockup renders a fake phone status bar ("8:14 / Tally / 84%") and a
desktop demo frame. The real app keeps the slim top bar with the wordmark
only; the device supplies its own status bar.

## D4. Non-member ledger access returns 404, not 403

Authorization on ledger-scoped routes returns 404 for both "doesn't exist"
and "not yours", so the API doesn't confirm which ledger ids exist.

## D5. DEV_ALLOW_USER local bypass

`wrangler dev` has no Access in front of it, so a `.dev.vars`-only variable
supplies a local identity. It is honored only for localhost/127.0.0.1
requests, documented as never-deploy, and does not exist in production
config. The spec's "the app boots assuming an authenticated request" is
preserved in production; this is the local stand-in.

## D6. Schema is stricter than the spec's verbatim DDL

Hardening added beyond the spec's column list: `CHECK (person_a < person_b)`
on ledgers (enforces the canonical ordering the spec states in prose),
`CHECK` enums on `expenses.method` and `receipts.status`, `UNIQUE` on
`expenses.reverses_id` (an entry can be voided exactly once), NOT NULLs on
required columns, and foreign keys (including `expenses.receipt_id ->
receipts(id)`). Same data model, fewer representable corruptions.

## D7. Cross-ledger idempotency-id collision is a 409, not a no-op

Rule 4 says a repeat POST with the same client id is a no-op. Repeating the
same request is: the server returns the existing entry with a 200. But the
same id arriving at a DIFFERENT ledger is a collision, not a repeat —
echoing the original row from another ledger's endpoint would leak data to
a caller who may not be a member there. All three mutation routes answer
409 { error } with nothing written and nothing echoed. (Found at first
contact between the contract-written tests and the implementation.)
