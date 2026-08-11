import { useEffect, useRef, useState } from "react";
import type { ApiEntry, LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";
import { otherMember, viewerDelta } from "../shared/ledger";
import { api } from "./api";
import { ARCHIVO, MONO, SERIF, colorsFor } from "./theme";
import { LedgerScreen } from "./screens/LedgerScreen";
import { ManualScreen, type ManualCommit } from "./screens/ManualScreen";
import { SettleScreen } from "./screens/SettleScreen";
import { DetailScreen } from "./screens/DetailScreen";
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

// The mockup-style screen state machine. M1 navigates ledger / manual /
// settle / detail; percent joins in M2 (extraction fallback), picker and
// onboarding in M3.
type Screen =
  | { name: "ledger" }
  | { name: "manual" }
  | { name: "settle" }
  | { name: "detail"; entryId: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });
  const [screen, setScreen] = useState<Screen>({ name: "ledger" });
  const [busy, setBusy] = useState(false);
  // One idempotency id per user commit intent (contract rule 4). It is
  // minted on the first attempt and reused verbatim if that attempt fails
  // and the user retries; it clears on success or navigation.
  const intentRef = useRef<string | null>(null);
  const takeIntentId = () => intentRef.current ?? (intentRef.current = crypto.randomUUID());
  const clearIntent = () => {
    intentRef.current = null;
  };

  useEffect(() => {
    (async () => {
      try {
        const [me, { ledgers }] = await Promise.all([api.me(), api.ledgers()]);
        const first = ledgers[0];
        const detail = first ? await api.ledger(first.id) : null;
        setBoot({ phase: "ready", me, ledgers, detail });
      } catch (err) {
        setBoot({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  const nav = (next: Screen) => {
    clearIntent();
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

  const { me, detail } = boot;
  const colors = colorsFor(me.accent_color);
  if (!detail) {
    return (
      <Shell accent={colors.me}>
        <div style={{ padding: "56px 30px", textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.25 }}>No ledgers yet.</div>
        </div>
      </Shell>
    );
  }

  const friendName = friendDisplayName(detail);
  const friendEmail = otherMember(detail.viewer, detail.ledger);
  const lastEntry = detail.entries[detail.entries.length - 1];
  const balance = lastEntry ? viewerDelta(lastEntry.running_cents, detail.viewer, detail.ledger) : 0;

  const refresh = async () => {
    const next = await api.ledger(detail.ledger.id);
    setBoot({ ...boot, detail: next });
  };

  // After every successful mutation: refetch the ledger detail, return to
  // the ledger screen, and release the intent id.
  const afterMutation = async () => {
    clearIntent();
    await refresh();
    setScreen({ name: "ledger" });
  };

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
      });
      await afterMutation();
    } catch (err) {
      // Stay on the screen; the intent id is kept so a retry is a no-op
      // server-side if the first POST actually landed.
      console.error(err);
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
      await afterMutation();
    } catch (err) {
      console.error(err);
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
      await afterMutation();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  switch (screen.name) {
    case "manual":
      body = (
        <ManualScreen
          reason="byhand"
          colors={colors}
          friendName={friendName}
          viewerEmail={detail.viewer}
          friendEmail={friendEmail}
          onCancel={() => nav({ name: "ledger" })}
          onCommit={commitManual}
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
    case "detail": {
      const entry = detail.entries.find((e) => e.id === screen.entryId);
      if (!entry) {
        // The entry vanished from a refetch — show the ledger instead.
        body = (
          <LedgerScreen
            detail={detail}
            colors={colors}
            friendName={friendName}
            onOpenEntry={(e) => nav({ name: "detail", entryId: e.id })}
            onSettle={() => nav({ name: "settle" })}
            onEnterByHand={() => nav({ name: "manual" })}
          />
        );
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
      body = (
        <LedgerScreen
          detail={detail}
          colors={colors}
          friendName={friendName}
          onOpenEntry={(entry) => nav({ name: "detail", entryId: entry.id })}
          onSettle={() => nav({ name: "settle" })}
          onEnterByHand={() => nav({ name: "manual" })}
        />
      );
  }

  return <Shell accent={colors.me}>{body}</Shell>;
}

function Shell({ accent, children }: { accent: string | null; children: React.ReactNode }) {
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
          <span style={{ letterSpacing: ".08em", color: accent ?? "#211f1c", font: `600 12px ${MONO}` }}>
            Tally
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
