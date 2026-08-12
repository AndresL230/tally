# Desktop (PC) UI — two-pane master-detail

Approved 2026-08-12. Phone behavior unchanged; this is a wide-viewport rendering
of the same app.

## Goal

On screens ≥ 900px wide, Tally stops being a centered 410px phone strip and
becomes a two-pane desktop app: the ledger list always visible in a left rail,
everything else in a right pane. Below 900px nothing changes.

## Layout

- `useIsDesktop()` hook: `matchMedia("(min-width: 900px)")`, live-updating.
- `DesktopShell` (new, alongside the existing `Shell`): `Tally` wordmark strip
  on top, then left rail (fixed ~300px) + right pane, separated by a hairline.
  Right pane content is constrained to ~560px and left-aligned with breathing
  room. All inline styles, existing theme tokens (paper/ink palette, Archivo /
  IBM Plex Mono / Instrument Serif). No CSS framework.

## Navigation mapping (no new router)

The `Screen` state machine in `App.tsx` is untouched. Desktop only renders it
differently:

- **Left rail** = the picker content: ledger rows (name, meta, viewer-relative
  balance, active highlight), + New ledger form, Edit-prefs link. Clicking a
  row opens that ledger in the right pane (`onOpen`, same as phone).
- **Right pane** = whatever `screen` says: ledger view (entries, add-receipt
  actions, settle), entry detail, or the flow screens (reading → confirm →
  percent, manual, settle). Flows replace the pane, list stays visible.
- With no ledger open (`detail === null`), the right pane shows a quiet empty
  state ("Pick a ledger" / create prompt).
- Phone-only affordances are suppressed on desktop: the `‹ Ledgers` back link
  and the full-screen picker state (the rail already is the picker). Prefs
  editing and onboarding render in the right pane.

## Shared components

Extract from `PickerScreen` into `components/LedgerNav.tsx`:

- `LedgerRows` — the ledger buttons list (used by phone picker + desktop rail,
  compact spacing in the rail).
- `NewLedgerControl` — the + New ledger dashed button / inline email form.

`PickerScreen` keeps its layout and copy, composed from the shared pieces.

## Desktop niceties

- "Take a photo" already degrades to a file dialog on desktop (browsers ignore
  `capture` there) — no work, keep the sheet labels as-is.
- Drag-and-drop a receipt image anywhere on the ledger pane → same `runScan`
  path as the pickers, with a visible drop-highlight.
- `Escape` cancels/backs out of flow screens (same handlers as the on-screen
  Cancel/back buttons; inert while an upload commit is busy).

## Testing

No worker/API/schema changes. Verification = `npm test` (typecheck + suite),
`npm run build`, and a live wide-viewport pass against wrangler dev (empty
state, ledger pane, entry detail, manual flow, Escape). The dev state gallery
keeps its phone framing. Deploys by pushing `main`.

## Non-goals

Dashboard/stats views, entry tables, hover-only controls, any phone-layout
change, theme changes.
