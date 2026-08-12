import type { LedgerSummary } from "../../shared/types";
import { ARCHIVO, INK, MUTED_1, MUTED_3, SERIF, type Colors } from "../theme";
import { LedgerRows, NewLedgerControl } from "../components/LedgerNav";

export interface PickerScreenProps {
  ledgers: LedgerSummary[];
  viewerEmail: string;
  colors: Colors;
  /** The last-opened ledger gets the accent border (the mockup's `live`). */
  activeLedgerId: string | null;
  /** Empty state: the new-ledger form starts open. */
  createOpenByDefault?: boolean;
  onOpen: (ledger: LedgerSummary) => void;
  /** Resolves on success (the app navigates away); throws ApiError on rejection. */
  onCreate: (email: string) => Promise<void>;
  /** Reopen the prefs screen (name + color) in edit mode. */
  onEditPrefs?: () => void;
}

export function PickerScreen({
  ledgers,
  viewerEmail,
  colors: C,
  activeLedgerId,
  createOpenByDefault,
  onOpen,
  onCreate,
  onEditPrefs,
}: PickerScreenProps) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {/* Root screen: no back button (the mockup's went to onboarding). */}
        <div style={{ marginTop: 26, fontFamily: SERIF, fontSize: 44, lineHeight: 1.02 }}>Your ledgers</div>
        {ledgers.length > 0 && (
          <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: 280 }}>
            Pick the one to open.
          </div>
        )}

        {ledgers.length > 0 ? (
          <div style={{ marginTop: 26 }}>
            <LedgerRows
              ledgers={ledgers}
              viewerEmail={viewerEmail}
              colors={C}
              activeLedgerId={activeLedgerId}
              onOpen={onOpen}
            />
          </div>
        ) : (
          <div style={{ padding: "48px 10px 36px", textAlign: "center" }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.25, color: INK }}>
              No ledgers yet.
              <br />
              Start one with a friend's email.
            </div>
          </div>
        )}

        <div style={{ marginTop: ledgers.length > 0 ? 10 : 0 }}>
          <NewLedgerControl colors={C} openByDefault={createOpenByDefault} onCreate={onCreate} />

          {onEditPrefs && (
            <button
              onClick={onEditPrefs}
              style={{
                marginTop: 22,
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
        </div>
      </div>
    </div>
  );
}
