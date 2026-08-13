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

## D8. Re-uploading a discarded receipt's bytes resurrects it

The M2 contract's first draft said dedupe returns a discarded receipt
as-is, which made a cancelled photo a permanent dead end: the same bytes
always deduped onto a receipt every commit would 409. Now an upload that
dedupes onto a discarded receipt flips it back to 'needs_review' (if it
was extracted; items survive) or 'uploaded' (if not). Re-picking the same
photo is an unambiguous signal the user wants it back. Found by the M2
review.

## D9. Extraction and posting are claim-based, not check-then-act

Two members can scan the same paper receipt seconds apart (dedupe lands
them on one row). Two guarantees are enforced with conditional writes
rather than pre-checks: (a) extract claims the job with
UPDATE ... SET status='extracting' WHERE status IN ('uploaded','failed')
AND raw_json IS NULL — losers get the current state back and the client
polls, so one image is never sent to the model twice in one ledger; (b)
the items-expense batch gates its insert on the receipt still being
available inside the transaction, so two concurrent confirms produce
exactly one expense (the loser gets a 409). Residual known gap: a worker
that dies mid-extraction leaves 'extracting' until the client's poll
gives up and offers manual entry; there is no timed reclaim (no
updated_at column). Judged acceptable for a two-person app.

## D10. Navigation and prefs affordances the mockup never drew

The mockup has no route back to the picker, no new-ledger flow, and no
way to edit prefs after onboarding. Rulings made while building M3 (all
in the mockup's visual vocabulary): the ledger screen always shows a
"‹ Ledgers" back button (with exactly one ledger it is the only road to
"+ New ledger"); the picker carries the inline new-ledger email form and
a muted "Edit your name and color ›" link that reopens the onboarding
screen in edit mode. Onboarding copy generalizes the mockup's
friend-specific lines ("what your friends see", "Their item") because at
onboarding no friend exists yet. A ledger created with a mistyped email
sits unused until that address is added to the Access policy — the
policy is the real gatekeeper (rule: adding a friend = policy AND
ledger); there is no ledger deletion, deliberately, in an append-only
system.

## D11. Quantity lines expand into per-unit rows on the confirm screen

Extraction records "Boba Tea ×3 … $15.00" as ONE line priced for the
whole line, which made the three teas a single indivisible assignment —
no way to say two are mine and one is Kenny's. The confirm screen now
expands a line whose qty display string parses as a count (bare "3",
"×3"/"3x"/"*3" either side, "3 @ $5.00") into n one-unit rows before the
user assigns anything: unit prices are trunc(line/n) with the leftover
cents landing one each on the first units, so the units always sum back
to the line exactly (penny rule, integer math in shared/units.ts). The
qty suffix is dropped from unit rows (three rows each reading "×3" would
lie) and the label repeats; because expansion happens where the list is
built, the posted items are already unit rows and the server's split
math is untouched. Guardrails: counts outside 2..20 pass through
unchanged (a bigger count is more likely a weight or a mis-read than
20+ units anyone assigns one by one), weights like "2 lb" never parse,
and expansion walks left to right only as far as keeps the whole list
within the API's 100-item cap — later lines simply stay unexpanded
rather than blowing the POST. Entries posted before this change keep
their stored "×n" rows and render as before.

## D12. Manual entry states the balance movement before it is committed

The manual screen took "who paid" and "the friend's share percent" as two
independent controls and committed without ever saying who ended up owing
whom. Those two have to be read TOGETHER, and the pairing that moves nothing
— you paid, 0% theirs ("All yours") — is one tap away from the pairing that
records a debt you owe. A real $0.25 entry was recorded that way: total 25,
other_share 0, a row that renders "−$0.00" and moves no balance. The screen
now carries the outcome line its sibling PercentScreen always had ("Kenny
will owe you $0.25 of $0.25" / "You'll owe Kenny …"), and the zero case is
called out in the accent color rather than passing silently. The commit is
NOT blocked: a bill you paid that is entirely your own share is a legal, if
inert, entry — it just may no longer be committed by accident. The direction
math is shared/tested (`expenseEffect`) rather than inlined per screen.

## D13. Unvoid exists, and it is a void of the void (supersedes "cannot void a void")

Voiding was one-way: the route answered 409 "cannot void a void" and the
detail screen showed a dead "Voided." label. Undo is now supported without
breaking the append-only rule — unvoid appends a reversal OF the reversal, so
nothing is ever updated or deleted. Because the reversal's other_share is the
negation of its target's, the third row restores the first exactly, and the
chain can be stacked indefinitely: E, E←R1 (voided), E←R1←R2 (live again),
E←R1←R2←R3 (voided). UNIQUE(reverses_id) survives untouched because each new
reversal targets the chain TIP, a row nothing has reversed yet; targeting a
spent mid-chain row still answers 409 "already voided". The consequence
everywhere else is that a row's live state is the PARITY of its chain, not
the presence of reversed_by — resolved once in shared/voids.ts and used by
the detail screen, the ledger rows, and the settled-summary receipt count.
Reversal rows carry note 'Void' or 'Unvoid' so the ledger reads honestly, at
the cost of three visible rows for one net entry.

## D14. Swapping who paid edits the row in place — the ledger's one exception

Everything else in this schema appends; this does not. Recording the wrong
payer was unfixable in the app (it took hand-written SQL against production
twice), and the append-only correction — void the entry, repost it — costs
two extra ledger rows every time, which is exactly the noise voids were
already generating. So `POST /expenses/:id/payer` updates `payer` and
`other_share_cents` on the existing row. The row is not silent about it:
migration 0002 adds nullable `amended_at`/`amended_by`, stamped with the
CALLER (not the new payer), and the detail screen prints "Payer changed by
you on Aug 13, 2026" so the other member can see the entry was edited.

The body names the TARGET payer rather than requesting a "swap", so a retry
is a no-op instead of flipping twice; naming the payer a row already has
writes nothing and stamps nothing.

`other_share_cents` is the NON-payer's share, so flipping the payer changes
whose share the number describes. For percent/manual that is the remainder.
For items the server recomputes through `splitItems` from the stored
assignments rather than subtracting, because each side's cut of the extra is
rounded independently and subtraction is not guaranteed to agree. Consequence
worth knowing: shares stay attached to PEOPLE, not to sides. Flipping an
entry where the payer also had the entire share yields a zero-delta row (you
paid for your own thing, nobody owes anybody) — correct, and the detail
screen now says "didn't move the balance" instead of rendering "−$0.00" next
to the words "you owed".

Refused: voids (`cannot change the payer of a void`) and currently-voided
entries (`entry is voided` — unvoid it first, since editing one would change
what the eventual unvoid restores). Both use the same chain-parity rule as
D13. Migration 0002 must be applied by hand (`wrangler d1 migrations apply
tally --remote`); CI does not run migrations.
