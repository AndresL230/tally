// Desktop (≥900px) chrome: the two-pane master-detail layout. The left rail
// is the ledger picker, permanently visible; the right pane renders whatever
// the App's screen state machine says. Below the breakpoint the app keeps the
// phone Shell — this file is never involved.

import { useEffect, useState } from "react";
import type { LedgerSummary } from "../../shared/types";
import { ARCHIVO, MONO, MUTED_1, MUTED_3, SERIF, type Colors } from "../theme";
import { LedgerRows, NewLedgerControl } from "./LedgerNav";
import { TallyMark } from "./TallyMark";

const BREAKPOINT = "(min-width: 900px)";

export function useIsDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(BREAKPOINT).matches);
  useEffect(() => {
    const mq = window.matchMedia(BREAKPOINT);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export interface DesktopRailProps {
  ledgers: LedgerSummary[];
  viewerEmail: string;
  colors: Colors;
  activeLedgerId: string | null;
  onOpen: (ledger: LedgerSummary) => void;
  onCreate: (email: string) => Promise<void>;
  onEditPrefs?: () => void;
}

export interface DesktopShellProps {
  accent: string;
  rail: DesktopRailProps;
  /** Dim + disable the rail while a full-screen state (onboarding, prefs
   *  editing) owns the pane. */
  railInert?: boolean;
  /** Logo + wordmark click: back to the main (ledger) view. */
  onHome?: () => void;
  children: React.ReactNode;
}

export function DesktopShell({ accent, rail, railInert, onHome, children }: DesktopShellProps) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 44,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: "1px solid rgba(0,0,0,.08)",
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
          <TallyMark height={15} accent={accent} />
          <span style={{ letterSpacing: ".08em", color: accent, font: `600 12px ${MONO}` }}>Tally</span>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 1060, display: "flex", minHeight: 0 }}>
          <aside
            style={{
              width: 300,
              flex: "none",
              minHeight: 0,
              overflowY: "auto",
              padding: "26px 20px 26px 24px",
              borderRight: "1px solid rgba(0,0,0,.08)",
              ...(railInert ? { pointerEvents: "none" as const, opacity: 0.5 } : {}),
            }}
          >
            <div
              style={{
                font: `600 9.5px ${ARCHIVO}`,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: MUTED_3,
                marginBottom: 14,
              }}
            >
              Ledgers
            </div>
            <LedgerRows
              ledgers={rail.ledgers}
              viewerEmail={rail.viewerEmail}
              colors={rail.colors}
              activeLedgerId={rail.activeLedgerId}
              onOpen={rail.onOpen}
              compact
            />
            <div style={{ marginTop: 10 }}>
              <NewLedgerControl
                colors={rail.colors}
                openByDefault={rail.ledgers.length === 0}
                onCreate={rail.onCreate}
                compact
              />
            </div>
            {rail.onEditPrefs && (
              <button
                onClick={rail.onEditPrefs}
                style={{
                  marginTop: 20,
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  font: `500 13px ${ARCHIVO}`,
                  color: MUTED_3,
                  cursor: "pointer",
                }}
              >
                Edit your name and color ›
              </button>
            )}
            <a
              href="/welcome"
              style={{
                display: "inline-block",
                marginTop: 12,
                font: `500 13px ${ARCHIVO}`,
                color: MUTED_3,
                textDecoration: "none",
              }}
            >
              About Tally ›
            </a>
          </aside>
          <main
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 560,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                padding: "18px 12px 0",
              }}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** The right pane when no ledger is open yet. */
export function PaneEmptyState({ hasLedgers, accent }: { hasLedgers: boolean; accent: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", paddingBottom: 60 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <TallyMark height={34} accent={accent} />
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.2 }}>
          {hasLedgers ? "Pick a ledger." : "Start a ledger with a friend's email."}
        </div>
        <div style={{ marginTop: 10, font: `400 15px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1 }}>
          {hasLedgers ? "Choose one on the left to see its entries." : "Use “+ New ledger” on the left."}
        </div>
      </div>
    </div>
  );
}
