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

## D5. Sign-in is the app's own (was: Cloudflare Access + DEV_ALLOW_USER)

The spec's Cloudflare Access One-Time PIN and the local `DEV_ALLOW_USER`
bypass are gone. The app emails its own six-digit code and keeps sessions in
D1 (`docs/superpowers/specs/2026-09-11-email-code-auth-design.md`). Local
development signs in for real: without `RESEND_API_KEY` the code prints to
the wrangler terminal. There is no longer any identity bypass anywhere.

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
is itself the invite — ledger membership lets that address request a
sign-in code, and a mistyped one simply never signs in; there is no ledger
deletion, deliberately, in an append-only system.

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
CALLER (not the new payer), and the detail screen prints "Edited by you on
Aug 13, 2026" so the other member can see the entry was edited. (That line
named the payer until D16 gave the stamp a second writer.)

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

## D15. The confirm screen's items are editable, and the total follows them

The mockup's confirm screen treats the scan as final: rows can be assigned
and an item the scan missed can be added, but nothing already on the list can
be repriced or taken off it, and the total is a fixed number the extra line
absorbs changes against. A scan that invents a line, doubles one, or misreads
a price therefore had no fix short of cancelling and splitting by percentage.

Each row now carries an editable amount and a ✕. Crossing a row out does NOT
delete it: it stays in place, greyed and struck through, reading "Not on this
split", with ↺ in the ✕'s spot — the same toggle in the same box (a wider
text control would slide every amount sideways as rows are crossed out), so
a mis-tap costs one tap, and what the scan actually read stays on screen instead of vanishing.
Only `includedItems` reaches the subtotal, the split, the beat-confirm rule,
and the posted items; the server needs no change, since a receipt-linked
expense already replaces `receipt_items` with the confirmed set.

The money model inverts to make that work. The screen used to store the
TOTAL and derive `extra = total - subtotal`; it now stores the EXTRA and
derives `total = subtotal + extra` (shared/items.ts). Crossing out an $8.75
item drops the total by $8.75 and leaves tax and tip where they are, which is
the reading a wrong scanned line calls for — the receipt was wrong, not just
its itemization. Typing over the Total still pins it, by re-deriving the
extra: the inverse, and the same gesture as before.

Two consequences worth knowing:

- **Adding an item now raises the total** instead of shrinking the extra.
  One rule governs every item change, at the cost of the old add behavior;
  the total remains one tap from being pinned to what the paper says.
- **The derived total is clamped at zero.** A negative extra (a discount) can
  exceed what the remaining items cost once rows are crossed out, and
  `splitItems` throws on a negative total. Clamping keeps an over-crossed-out
  receipt renderable; the extra line then shows `split.extra_cents` rather
  than the held value, so the screen never displays a number the split math
  did not use.

## D16. The date is editable after the fact, and re-dating reorders the ledger

The date was correctable only in the moment: the confirm screen offers a date
field, and once the entry was posted the number was frozen. That is backwards
from how receipts actually arrive — a photo taken on Sunday of Friday's
dinner is posted with the scan's guess or with today, and the mistake is
noticed later, from the ledger, which is precisely where there was no way to
fix it. `POST /expenses/:id/date` is therefore the SECOND in-place edit, and
it deliberately copies D14 rather than inventing a second vocabulary: the
body names the target date (so a retry cannot walk an entry down the
calendar), naming the date a row already has writes nothing and stamps
nothing, and it refuses voids (`cannot change the date of a void`) and
currently-voided entries (`entry is voided`) under the same chain-parity rule
as D13. Both routes now share one `isVoided` helper instead of two copies of
the recursive CTE. No new migration: the D14 stamp columns already mean "this
row was changed, and by whom", so the detail screen's amendment line drops
its claim about the payer and reads "Edited by …".

Two consequences worth knowing:

- **Re-dating moves the row through the ledger.** `ledger_entries` orders by
  `(occurred_on, created_at, id)`, so a corrected date rewrites the running
  balance of every row it passes. The balance itself does not move — the same
  deltas summed in a different order — but a member watching the running
  column will see numbers change on entries they did not touch.
- **A linked receipt's `purchased_on` follows in the same transaction.** The
  items post stamps the expense and its receipt with one date; a correction
  that moved only the expense would quietly split them apart.

Any valid date is allowed, including a future one — the same latitude the
confirm screen already gives, since a receipt dated wrong by the scanner is
more common than a member deliberately post-dating an entry.

## D17. An item can be split by a custom amount, not only whole/half

The mockup's item toggle has three stops: the other person's, yours, half.
Real receipts have a fourth case — the bottle two people drank unevenly,
the appetizer one of you mostly ate — and forcing it into "half" quietly
misstates the ledger. `receipt_items.share_cents` (migration 0004,
nullable) is the fourth case: the member named in `assigned_to` pays
exactly that many cents of the item and the other member pays the rest.
NULL keeps the old meaning, so every row and every code path that predates
it is untouched; the server refuses it on a `'half'` item and outside
`0..price_cents`. A percent is an INPUT convenience only — the confirm
screen resolves it to cents (`percentShare`, halves up) before anything is
posted — so nothing stores "30%"; the detail screen shows the cents and
draws the spine cut at the rounded percent.

Design choices worth knowing:

- **The tap cycle keeps three stops: other's, yours, split.** The mockup's
  third stop was "half"; here the third stop IS the split, and it starts
  at half each, so the common case costs the same two taps it always did.
  On the wire an exactly-even split is still the canonical `'half'` (its
  half-cent-unit rounding is untouched, and rows posted before this
  change load back into the same state); only an uneven share goes out
  as `share_cents`. A fourth "custom" stop and, before that, a ÷ button
  on every row were both tried and dropped: the extra stop made the
  round trip back to "other's" four taps, and a 30px ÷ beside the 30px
  ✕ was a mis-tap waiting to happen on a phone. Only a split row shows
  the ÷ (a 36px round button, sized to the row so it never changes the
  row's height), and only tapping it unfolds the split card beneath the
  row — entering the state never opens the card on its own. The card is
  the percent screen's grammar (`ItemSplitControl`): friend's amount
  left, yours right, one slider in steps of five with the percentages
  under it, and 25/50/75 quick buttons; a thumb-sized control rather
  than two tiny text fields. It unfolds with a short animation, off
  under `prefers-reduced-motion`.
- **Exact cents, no new rounding.** Custom cents join the existing
  half-cent accumulator as whole cents, so D1's single-rounding rule still
  holds and the payer's side is still derived by subtraction. The extra
  (tax and tip) keeps splitting in proportion to each side's item subtotal.
- **The wire is anchored, not viewer-relative (rule D).** The client always
  posts the viewer's email with the viewer's cents; either anchor reads
  back correctly for either member (`assignedToCustom`).
- **A quantity line with a custom share is not expanded into units.** A cut
  of the whole line cannot be spread over its units without inventing a
  rounding rule, so `expandQtyItems` passes it through unchanged.

## D18. A receipt can be a PDF, not only a photo

The spec and mockup assume a camera: photograph the paper, upload the
image, read it. Plenty of receipts never exist on paper — they arrive as a
PDF by email, or download as one from an online order — and the round trip
of printing or photographing a screen to feed such a receipt in was pure
loss.

- `application/pdf` joins the three photo codecs the upload route accepts
  (`src/worker/receipts.ts`), under the same 8 MB cap: base64 inflates by
  4/3 on the way to the model, so that stays well inside the Messages
  API's 32 MB request ceiling.
- The stored object keeps its own content type and a `.pdf` key suffix;
  photos keep the contract's `.jpg` suffix whatever their codec, so
  existing keys are untouched.
- Extraction sends a PDF as a base64 `document` block instead of an
  `image` block (`src/worker/extract.ts`) — same model, same forced
  `record_receipt` tool, same salvage, same one-call-per-receipt caching
  and SHA-256 dedupe. A PDF past the model's page limit fails at the
  gateway and lands on `failed` like any unreadable photo.
- Client side, the library picker accepts `image/*,application/pdf` (the
  camera button stays photo-only) and a PDF skips the rule-8 downscale,
  which has nothing to do to it. The failure screen says "No total in that
  PDF" and offers "Choose another file" rather than telling someone to
  re-shoot a document with the receipt "flat and lit".
