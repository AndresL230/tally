import { useEffect, useState } from "react";
import type { LedgerDetail, LedgerSummary, UserPrefs } from "../shared/types";
import { otherMember } from "../shared/ledger";
import { api } from "./api";
import { ARCHIVO, MONO, SERIF, colorsFor } from "./theme";
import { LedgerScreen } from "./screens/LedgerScreen";

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

export default function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });

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

  return (
    <Shell accent={colors.me}>
      <LedgerScreen detail={detail} colors={colors} friendName={friendDisplayName(detail)} />
    </Shell>
  );
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
          <span style={{ letterSpacing: ".08em", color: accent ?? "#211f1c", fontWeight: 600, font: `600 12px ${ARCHIVO}`, textTransform: "none" }}>
            Tally
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
