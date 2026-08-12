import { useEffect, useRef, useState } from "react";
import type { ApiEntry, ApiItem, ApiReceipt, LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";
import { otherMember, viewerDelta } from "../shared/ledger";
import { ApiError, api } from "./api";
import { downscaleImage } from "./image";
import { ARCHIVO, DEFAULT_ACCENT, MONO, SERIF, colorsFor, type Colors } from "./theme";
import { LedgerScreen } from "./screens/LedgerScreen";
import { PickerScreen } from "./screens/PickerScreen";
import { DesktopShell, PaneEmptyState, useIsDesktop, type DesktopRailProps } from "./components/DesktopShell";
import { TallyMark } from "./components/TallyMark";
import { StartScreen } from "./screens/StartScreen";
import { ManualScreen, type ManualCommit } from "./screens/ManualScreen";
import { SettleScreen } from "./screens/SettleScreen";
import { DetailScreen } from "./screens/DetailScreen";
import { ReadingScreen, type ReadingPhase } from "./screens/ReadingScreen";
import { ConfirmScreen, type ConfirmCommit } from "./screens/ConfirmScreen";
import { PercentScreen } from "./screens/PercentScreen";
import { todayISO } from "./util";

export function friendDisplayName(detail: LedgerDetail): string {
  const friendEmail = otherMember(detail.viewer, detail.ledger);
  const stored = detail.members[friendEmail]?.display_name;
  if (stored) return stored;
  const local = friendEmail.split("@")[0] ?? friendEmail;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

type Boot =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; me: UserPrefs; ledgers: LedgerSummary[]; detail: LedgerDetail | null };

// The mockup-style screen state machine. M2 adds the receipt pipeline:
// reading -> confirm | percent | manual(photofail).
type Screen =
  | { name: "ledger" }
  | { name: "picker" }
  | { name: "manual"; reason: "byhand" | "photofail" }
  | { name: "settle" }
  | { name: "detail"; entryId: string }
  | { name: "reading" }
  | { name: "confirm" }
  | { name: "percent" };

/** The in-flight receipt: set once the upload lands, cleared when the flow
 *  ends (commit, discard, or a new scan). */
interface ReceiptFlow {
  receipt: ApiReceipt;
  items: ApiItem[];
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `That didn't save (${err.message}). Try again.`;
  return "That didn't save — check the connection and try again.";
}

const IDLE_PHASE: ReadingPhase = { step: 0, merchant: null, itemCount: null, totalCents: null };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });
  const [screen, setScreen] = useState<Screen>({ name: "ledger" });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReceiptFlow | null>(null);
  const [reading, setReading] = useState<ReadingPhase>(IDLE_PHASE);
  // Desktop (≥900px) renders the same screen state machine in a two-pane
  // shell; below the breakpoint everything is exactly the phone app.
  const isDesktop = useIsDesktop();
  const [dragOver, setDragOver] = useState(false);
  // Onboarding accent preview: the picked swatch recolors the whole shell
  // live (through colorsFor) before anything is saved.
  const [startAccent, setStartAccent] = useState<string>(DEFAULT_ACCENT);
  // Prefs editing after onboarding (M3 review F5): reachable from the picker.
  const [editingPrefs, setEditingPrefs] = useState(false);

  // One idempotency id per user commit intent (contract rule 4). It is
  // minted on the first attempt and reused verbatim if that attempt fails
  // and the user retries; it clears on success or navigation.
  const intentRef = useRef<string | null>(null);
  const takeIntentId = () => intentRef.current ?? (intentRef.current = crypto.randomUUID());
  const clearIntent = () => {
    intentRef.current = null;
  };

  // Scan-flow plumbing: a token invalidates stale timers/continuations
  // (Cancel on the reading screen aborts navigation, not the request).
  const scanTokenRef = useRef(0);
  const scanTimerRef = useRef<number | null>(null);
  const stopScanTimer = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  };
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  // The receipt upload gets its own UUID, one per photo: re-picking the
  // same file (a retry) reuses it, so the repeat POST is the dedupe path.
  const lastPickRef = useRef<{ key: string; id: string } | null>(null);
  const receiptIdFor = (file: File) => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (lastPickRef.current?.key !== key) {
      lastPickRef.current = { key, id: crypto.randomUUID() };
    }
    return lastPickRef.current.id;
  };

  useEffect(() => {
    (async () => {
      try {
        const [me, { ledgers }] = await Promise.all([api.me(), api.ledgers()]);
        // Exactly one ledger boots straight into it; zero or several boot
        // into the picker (detail stays null until one is opened).
        const only = ledgers.length === 1 ? ledgers[0]! : null;
        const detail = only ? await api.ledger(only.id) : null;
        setBoot({ phase: "ready", me, ledgers, detail });
      } catch (err) {
        setBoot({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  useEffect(() => stopScanTimer, []);

  // Escape backs out of whatever the visible Cancel/back button would; the
  // ref is (re)assigned every render so the listener always sees the current
  // screen's action. Null where there is nothing to cancel.
  const escapeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let inputs keep their own Escape behavior (e.g. clearing).
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      escapeRef.current?.();
    };
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKey(e);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  escapeRef.current = null; // default; the deep render path overrides it

  const nav = (next: Screen) => {
    clearIntent();
    setFlash(null);
    setScreen(next);
  };

  if (boot.phase === "loading") {
    return <Shell accent={null}>{null}</Shell>;
  }
  if (boot.phase === "error") {
    return (
      <Shell accent={null}>
        <div style={{ padding: "56px 30px", textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.25 }}>Couldn't reach the ledger.</div>
          <div style={{ marginTop: 10, font: `400 13px ${MONO}`, color: "#8a857c" }}>{boot.message}</div>
        </div>
      </Shell>
    );
  }

  const { me, ledgers, detail } = boot;

  /** Merge fresher data into the ready boot state without clobbering it. */
  const patchBoot = (patch: Partial<Extract<Boot, { phase: "ready" }>>) => {
    setBoot((b) => (b.phase === "ready" ? { ...b, ...patch } : b));
  };

  // Shared by the phone picker and the desktop rail.
  const openLedger = async (summary: LedgerSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api.ledger(summary.id);
      patchBoot({ detail: next });
      nav({ name: "ledger" });
    } catch (err) {
      setFlash(
        err instanceof ApiError
          ? `That ledger didn't open (${err.message}). Try again.`
          : "That ledger didn't open — check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const createLedger = async (friendEmail: string) => {
    // Fresh UUID per attempt: the server is idempotent by PAIR, so a
    // repeat returns 200 with the existing ledger — landing on it is
    // the correct UX. Errors propagate to the form's inline notice.
    const { ledger } = await api.createLedger({ id: crypto.randomUUID(), friend_email: friendEmail });
    const [{ ledgers: nextLedgers }, nextDetail] = await Promise.all([api.ledgers(), api.ledger(ledger.id)]);
    patchBoot({ ledgers: nextLedgers, detail: nextDetail });
    nav({ name: "ledger" });
  };

  const railFor = (C: Colors): DesktopRailProps => ({
    ledgers,
    viewerEmail: me.email,
    colors: C,
    activeLedgerId: detail?.ledger.id ?? null,
    onOpen: openLedger,
    onCreate: createLedger,
  });

  // ---- Onboarding: no display name yet -> prefs first (decision B) --------
  if (me.display_name === null) {
    const preview = colorsFor(startAccent);
    const start = (
      <>
        {flash && <FlashNote accent={preview.me}>{flash}</FlashNote>}
        <StartScreen
          colors={preview}
          accent={startAccent}
          onPickAccent={setStartAccent}
          busy={busy}
          onSave={async (prefs) => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await api.updateMe(prefs);
              setFlash(null);
              patchBoot({ me: updated });
            } catch (err) {
              setFlash(describeError(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </>
    );
    return isDesktop ? (
      <DesktopShell accent={preview.me} rail={railFor(preview)} railInert>
        {start}
      </DesktopShell>
    ) : (
      <Shell accent={preview.me}>{start}</Shell>
    );
  }

  const colors = colorsFor(me.accent_color);

  // ---- Picker: the root screen whenever no ledger is open -----------------
  if (editingPrefs) {
    const preview = colorsFor(startAccent);
    const editor = (
      <>
        {flash && <FlashNote accent={preview.me}>{flash}</FlashNote>}
        <StartScreen
          colors={preview}
          accent={startAccent}
          onPickAccent={setStartAccent}
          busy={busy}
          initialName={me.display_name ?? ""}
          onCancel={() => setEditingPrefs(false)}
          onSave={async (prefs) => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await api.updateMe(prefs);
              setFlash(null);
              patchBoot({ me: updated });
              setEditingPrefs(false);
            } catch (err) {
              setFlash(describeError(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </>
    );
    return isDesktop ? (
      <DesktopShell accent={preview.me} rail={railFor(preview)} railInert>
        {editor}
      </DesktopShell>
    ) : (
      <Shell accent={preview.me}>{editor}</Shell>
    );
  }

  const startPrefsEdit = () => {
    setStartAccent(me.accent_color ?? DEFAULT_ACCENT);
    setEditingPrefs(true);
  };

  // Logo/wordmark click: abandon any in-flight flow presentation (the
  // receipt itself survives server-side) and land on the main view.
  const goHome = () => {
    setFlow(null);
    nav({ name: "ledger" });
  };

  const phonePicker = (
    <Shell accent={colors.me} onHome={goHome}>
      {flash && <FlashNote accent={colors.me}>{flash}</FlashNote>}
      <PickerScreen
        ledgers={ledgers}
        viewerEmail={me.email}
        colors={colors}
        activeLedgerId={detail?.ledger.id ?? null}
        createOpenByDefault={ledgers.length === 0}
        onOpen={openLedger}
        onCreate={createLedger}
        onEditPrefs={startPrefsEdit}
      />
    </Shell>
  );

  if (!detail) {
    // Desktop: the rail IS the picker; the pane gets a quiet empty state.
    return isDesktop ? (
      <DesktopShell accent={colors.me} rail={{ ...railFor(colors), onEditPrefs: startPrefsEdit }} onHome={goHome}>
        {flash && <FlashNote accent={colors.me}>{flash}</FlashNote>}
        <PaneEmptyState hasLedgers={ledgers.length > 0} accent={colors.me} />
      </DesktopShell>
    ) : (
      phonePicker
    );
  }
  // Phone-only: the full-screen picker state. On desktop the rail is always
  // visible, so "picker" simply renders the open ledger in the pane.
  if (!isDesktop && screen.name === "picker") {
    return phonePicker;
  }

  const friendName = friendDisplayName(detail);
  const friendEmail = otherMember(detail.viewer, detail.ledger);
  const lastEntry = detail.entries[detail.entries.length - 1];
  const balance = lastEntry ? viewerDelta(lastEntry.running_cents, detail.viewer, detail.ledger) : 0;

  const refresh = async () => {
    // Refetch the open ledger AND the summary list, so the picker stays
    // honest after any balance-changing mutation.
    const [next, { ledgers: nextLedgers }] = await Promise.all([api.ledger(detail.ledger.id), api.ledgers()]);
    patchBoot({ detail: next, ledgers: nextLedgers });
  };

  // The intent id is released the moment the POST succeeds (so a later
  // refresh failure can't cause a stale-id no-op that eats fresh edits);
  // then refetch and return to the ledger.
  const afterMutation = async () => {
    clearIntent();
    setFlash(null);
    await refresh();
    setScreen({ name: "ledger" });
  };

  // ---- The M2 receipt pipeline -------------------------------------------

  /** Downscale -> reading screen -> upload -> extract -> route per contract.
   *  ONE round-trip; the reading steps are presentation while it runs. */
  const runScan = async (file: File) => {
    const token = ++scanTokenRef.current;
    const live = () => scanTokenRef.current === token;
    // The upload's own idempotency UUID: minted once per photo, reused on a
    // retry of the same file, and the receipt PK server-side. (Re-shooting
    // the same paper receipt dedupes on the image SHA-256 regardless.)
    const receiptId = receiptIdFor(file);

    clearIntent();
    setFlow(null);
    setFlash(null);
    setReading({ ...IDLE_PHASE });
    setScreen({ name: "reading" });
    stopScanTimer();
    scanTimerRef.current = window.setInterval(() => {
      // Steps advance on the clock, but the LAST one never completes
      // before the response arrives (cap at "current", never "done").
      setReading((r) => ({ ...r, step: Math.min(r.step + 1, 3) }));
    }, 950);

    /** Complete the remaining steps with real values, then navigate after a beat. */
    const finish = (receipt: ApiReceipt, items: ApiItem[], dest: Screen) => {
      stopScanTimer();
      setReading({
        step: 4,
        merchant: receipt.merchant,
        itemCount: items.length,
        totalCents: receipt.total_cents,
      });
      window.setTimeout(() => {
        if (!live()) return;
        setScreen(dest);
      }, 900);
    };

    try {
      const blob = await downscaleImage(file);
      const up = await api.uploadReceipt(detail.ledger.id, receiptId, blob);
      if (!live()) return;

      // Dedupe UX: same bytes as a receipt that's already posted — nothing
      // to re-add.
      if (up.receipt.status === "posted") {
        stopScanTimer();
        scanTokenRef.current++;
        setScreen({ name: "ledger" });
        setFlash("That receipt is already on the ledger.");
        return;
      }

      let { receipt, items } = up;
      setFlow({ receipt, items });
      if (receipt.status !== "needs_review" && receipt.status !== "failed") {
        // Fresh upload (or a dedupe onto a not-yet-extracted receipt): run
        // the extraction round-trip. A cache hit server-side returns the
        // stored result without a model call. If the OTHER member is mid-
        // extraction on the same bytes (status 'extracting', server-side
        // claim), poll until their result lands.
        const extracted = await api.extractReceipt(receipt.id);
        if (!live()) return;
        receipt = extracted.receipt;
        items = extracted.items;
        setFlow({ receipt, items });
        for (let tries = 0; receipt.status === "extracting" && tries < 20; tries++) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          if (!live()) return;
          const polled = await api.extractReceipt(receipt.id);
          if (!live()) return;
          receipt = polled.receipt;
          items = polled.items;
          setFlow({ receipt, items });
        }
        if (receipt.status === "extracting") {
          // Their call is stuck; fall to manual rather than spin forever.
          stopScanTimer();
          setScreen({ name: "manual", reason: "photofail" });
          return;
        }
      }

      if (receipt.status === "failed") {
        stopScanTimer();
        setScreen({ name: "manual", reason: "photofail" });
        return;
      }
      if (items.length > 0) {
        finish(receipt, items, { name: "confirm" });
      } else if (receipt.total_cents !== null) {
        finish(receipt, items, { name: "percent" });
      } else {
        // Nothing usable on the photo.
        stopScanTimer();
        setScreen({ name: "manual", reason: "photofail" });
      }
    } catch (err) {
      // Upload failure, extraction 503 ("extraction not configured"),
      // extract 409/500, network: all land on the photo-failed manual copy.
      if (!live()) return;
      console.warn("receipt scan failed", err);
      stopScanTimer();
      setScreen({ name: "manual", reason: "photofail" });
    }
  };

  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (file) void runScan(file);
  };

  /** Reading-screen Cancel: abort navigation; the receipt stays (the user
   *  can discard it later by cancelling from confirm/percent). */
  const cancelReading = () => {
    scanTokenRef.current++;
    stopScanTimer();
    nav({ name: "ledger" });
  };

  /** Confirm/percent Cancel: the receipt is abandoned — discard it
   *  fire-and-forget and go back to the ledger. */
  const cancelAndDiscard = () => {
    if (flow) {
      api.discardReceipt(flow.receipt.id).catch(() => {
        // fire-and-forget: a failed discard leaves a needs_review orphan,
        // which the dedupe path resurrects if the photo comes back
      });
      setFlow(null);
    }
    nav({ name: "ledger" });
  };

  // ---- Commits ------------------------------------------------------------

  const commitManual = async (payload: ManualCommit) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.postExpense(detail.ledger.id, {
        id: takeIntentId(),
        occurred_on: payload.occurred_on,
        merchant: payload.merchant,
        total_cents: payload.total_cents,
        payer: payload.payer,
        method: "manual",
        other_share_cents: payload.other_share_cents,
        note: "Entered by hand.",
        // A photo-failed manual entry keeps the receipt link when one
        // exists and is still linkable (a posted/discarded id would 409).
        ...(flow && flow.receipt.status !== "posted" && flow.receipt.status !== "discarded"
          ? { receipt_id: flow.receipt.id }
          : {}),
      });
      clearIntent();
      setFlow(null);
      await afterMutation();
    } catch (err) {
      // Stay on the screen; the intent id survives only if the POST itself
      // failed, so a retry is a no-op server-side if it actually landed.
      setFlash(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitConfirm = async (payload: ConfirmCommit) => {
    if (busy || !flow) return;
    setBusy(true);
    try {
      await api.postExpense(detail.ledger.id, {
        id: takeIntentId(),
        occurred_on: payload.occurred_on,
        merchant: payload.merchant,
        total_cents: payload.total_cents,
        payer: payload.payer,
        method: "items",
        receipt_id: flow.receipt.id,
        items: payload.items,
      });
      clearIntent();
      setFlow(null);
      await afterMutation();
    } catch (err) {
      setFlash(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  /** Percent fallback for a receipt whose total came through without line
   *  items. otherShareCents is the NON-PAYER's share from the slider. */
  const commitPercent = async (commit: { payer: string; other_share_cents: number }) => {
    if (busy || !flow) return;
    const r = flow.receipt;
    setBusy(true);
    try {
      await api.postExpense(detail.ledger.id, {
        id: takeIntentId(),
        occurred_on: r.purchased_on ?? todayISO(),
        merchant: r.merchant ?? "Receipt",
        total_cents: r.total_cents ?? 0,
        payer: commit.payer,
        method: "percent",
        other_share_cents: commit.other_share_cents,
        note: "Halved by percentage — no line items on the photo.",
        receipt_id: r.id,
      });
      clearIntent();
      setFlow(null);
      await afterMutation();
    } catch (err) {
      setFlash(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitSettlement = async ({ amount_cents }: { amount_cents: number }) => {
    if (busy) return;
    setBusy(true);
    try {
      // from = debtor, to = creditor, from the viewer-relative balance sign.
      const from = balance > 0 ? friendEmail : detail.viewer;
      const to = balance > 0 ? detail.viewer : friendEmail;
      await api.postSettlement(detail.ledger.id, {
        id: takeIntentId(),
        occurred_on: todayISO(),
        from_email: from,
        to_email: to,
        amount_cents,
      });
      clearIntent();
      await afterMutation();
    } catch (err) {
      setFlash(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitVoid = async (entry: ApiEntry) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.voidExpense(detail.ledger.id, entry.id, {
        id: takeIntentId(),
        occurred_on: todayISO(),
      });
      clearIntent();
      await afterMutation();
    } catch (err) {
      setFlash(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  // ---- Screens ------------------------------------------------------------

  const ledgerScreen = (
    <LedgerScreen
      detail={detail}
      colors={colors}
      friendName={friendName}
      onOpenEntry={(entry) => nav({ name: "detail", entryId: entry.id })}
      onSettle={() => nav({ name: "settle" })}
      onTakePhoto={() => cameraInputRef.current?.click()}
      onChooseFromLibrary={() => libraryInputRef.current?.click()}
      onEnterByHand={() => {
        setFlow(null);
        nav({ name: "manual", reason: "byhand" });
      }}
      onBackToPicker={
        // Desktop: the rail is always visible, so the back link would be
        // a no-op — suppress it. Phone: always reachable (M3 review F1);
        // with exactly one ledger this is the ONLY road to "+ New ledger"
        // and to prefs.
        isDesktop
          ? undefined
          : () => {
              nav({ name: "picker" });
              // Refresh the summaries behind the navigation so the list is
              // current when it appears.
              api
                .ledgers()
                .then(({ ledgers: nextLedgers }) => patchBoot({ ledgers: nextLedgers }))
                .catch(() => {});
            }
      }
    />
  );

  let body: React.ReactNode;
  switch (screen.name) {
    case "manual":
      body = (
        <ManualScreen
          reason={screen.reason}
          colors={colors}
          friendName={friendName}
          viewerEmail={detail.viewer}
          friendEmail={friendEmail}
          onCancel={() => {
            setFlow(null);
            nav({ name: "ledger" });
          }}
          onCommit={commitManual}
          onRetake={() => cameraInputRef.current?.click()}
        />
      );
      break;
    case "settle":
      body = (
        <SettleScreen
          colors={colors}
          friendName={friendName}
          balanceCents={balance}
          onCancel={() => nav({ name: "ledger" })}
          onCommit={commitSettlement}
        />
      );
      break;
    case "reading":
      body = <ReadingScreen colors={colors} phase={reading} onCancel={cancelReading} />;
      break;
    case "confirm":
      if (!flow) {
        body = ledgerScreen;
        break;
      }
      body = (
        <ConfirmScreen
          key={flow.receipt.id}
          colors={colors}
          friendName={friendName}
          viewerEmail={detail.viewer}
          friendEmail={friendEmail}
          receipt={{
            merchant: flow.receipt.merchant,
            purchased_on: flow.receipt.purchased_on,
            total_cents: flow.receipt.total_cents,
          }}
          initialItems={flow.items}
          busy={busy}
          onCancel={cancelAndDiscard}
          onCommit={commitConfirm}
          onFallbackPercent={() =>
            nav(flow.receipt.total_cents !== null ? { name: "percent" } : { name: "manual", reason: "photofail" })
          }
        />
      );
      break;
    case "percent":
      if (!flow || flow.receipt.total_cents === null) {
        body = ledgerScreen;
        break;
      }
      body = (
        <PercentScreen
          key={flow.receipt.id}
          colors={colors}
          friendName={friendName}
          merchant={flow.receipt.merchant ?? "Receipt"}
          occurredOn={flow.receipt.purchased_on ?? todayISO()}
          totalCents={flow.receipt.total_cents}
          payer={detail.viewer}
          viewerEmail={detail.viewer}
          friendEmail={friendEmail}
          onCancel={cancelAndDiscard}
          onCommit={commitPercent}
        />
      );
      break;
    case "detail": {
      const entry = detail.entries.find((e) => e.id === screen.entryId);
      if (!entry) {
        // The entry vanished from a refetch — show the ledger instead.
        body = ledgerScreen;
        break;
      }
      body = (
        <DetailScreen
          key={entry.id}
          entry={entry}
          detail={detail}
          colors={colors}
          friendName={friendName}
          onBack={() => nav({ name: "ledger" })}
          onVoid={commitVoid}
        />
      );
      break;
    }
    default:
      body = ledgerScreen;
  }

  // Escape mirrors the visible Cancel/back control of the current screen.
  if (!busy) {
    switch (screen.name) {
      case "reading":
        escapeRef.current = cancelReading;
        break;
      case "confirm":
      case "percent":
        escapeRef.current = cancelAndDiscard;
        break;
      case "manual":
        escapeRef.current = () => {
          setFlow(null);
          nav({ name: "ledger" });
        };
        break;
      case "settle":
      case "detail":
        escapeRef.current = () => nav({ name: "ledger" });
        break;
      default:
        escapeRef.current = null;
    }
  }

  // Hidden pickers behind the add-receipt sheet's photo buttons; the camera
  // one is also what "Retake photo" re-opens. On desktop the browser ignores
  // `capture` and both open the file dialog.
  const hiddenInputs = (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onFilePicked}
      />
      <input ref={libraryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFilePicked} />
    </>
  );

  // Remount + rise-in when the screen changes, so navigation reads as a
  // transition instead of a hard swap (same keyframe the receipt card uses).
  const screenKey = screen.name === "detail" ? `detail-${screen.entryId}` : screen.name;

  if (isDesktop) {
    const canDrop = screen.name === "ledger";
    return (
      <DesktopShell accent={colors.me} rail={{ ...railFor(colors), onEditPrefs: startPrefsEdit }} onHome={goHome}>
        {flash && <FlashNote accent={colors.me}>{flash}</FlashNote>}
        <div
          key={screenKey}
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            animation: "riseIn .22s ease both",
          }}
          onDragOver={(e) => {
            if (!canDrop || busy) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!canDrop || busy) return;
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) void runScan(file);
          }}
        >
          {body}
          {dragOver && canDrop && (
            <div
              style={{
                position: "absolute",
                inset: 8,
                borderRadius: 16,
                border: `2px dashed ${colors.me}`,
                background: "rgba(242,239,231,.92)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                font: `600 15px ${ARCHIVO}`,
                color: colors.me,
              }}
            >
              Drop the receipt photo
            </div>
          )}
        </div>
        {hiddenInputs}
      </DesktopShell>
    );
  }

  return (
    <Shell accent={colors.me} onHome={goHome}>
      {flash && <FlashNote accent={colors.me}>{flash}</FlashNote>}
      <div
        key={screenKey}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", animation: "riseIn .22s ease both" }}
      >
        {body}
      </div>
      {hiddenInputs}
    </Shell>
  );
}

function FlashNote({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: "0 22px 8px",
        borderLeft: `3px solid ${accent}`,
        paddingLeft: 14,
        font: `400 14px ${ARCHIVO}`,
        lineHeight: 1.5,
        color: "#4a453d",
      }}
    >
      {children}
    </div>
  );
}

function Shell({
  accent,
  onHome,
  children,
}: {
  accent: string | null;
  onHome?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ height: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 410, height: "100%", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            height: 44,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: `500 12px ${MONO}`,
          }}
        >
          <button
            onClick={onHome}
            className="navlink"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: 0,
              background: "transparent",
              padding: "6px 12px",
              borderRadius: 10,
              cursor: onHome ? "pointer" : "default",
            }}
          >
            <TallyMark height={15} accent={accent ?? "#211f1c"} />
            <span style={{ letterSpacing: ".08em", color: accent ?? "#211f1c", font: `600 12px ${MONO}` }}>
              Tally
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
