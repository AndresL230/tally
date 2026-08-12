import { useState } from "react";
import type { LedgerSummary } from "../../shared/types";
import { viewerDelta } from "../../shared/ledger";
import { runningLabel, shortDate } from "../../shared/format";
import { ApiError } from "../api";
import { ARCHIVO, INK, MONO, MUTED_1, MUTED_2, MUTED_3, MUTED_4, SERIF, type Colors } from "../theme";

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

function ledgerDisplayName(l: LedgerSummary): string {
  if (l.friend_name) return l.friend_name;
  const local = l.friend_email.split("@")[0] ?? l.friend_email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function metaLine(l: LedgerSummary): string {
  if (l.entry_count === 0 || l.last_entry_on === null) return "no entries yet";
  return `${l.entry_count} ${l.entry_count === 1 ? "entry" : "entries"} · last ${shortDate(l.last_entry_on)}`;
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
  const [adding, setAdding] = useState(!!createOpenByDefault);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = email.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setError(null);
    setBusy(true);
    try {
      await onCreate(email.trim());
      // Success navigates away; nothing to clean up here.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "That didn't go through — check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    font: `600 9.5px ${ARCHIVO}`,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: MUTED_3,
    marginBottom: 10,
  };

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
          <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 10 }}>
            {ledgers.map((l) => {
              // LedgerSummary.balance_cents is CANONICAL — translate to the
              // viewer's perspective before choosing color or amount.
              const bal = viewerDelta(l.balance_cents, viewerEmail, l);
              const live = l.id === activeLedgerId;
              return (
                <button
                  key={l.id}
                  onClick={() => onOpen(l)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    width: "100%",
                    padding: "16px 15px",
                    borderRadius: 14,
                    cursor: "pointer",
                    border: `1px solid ${live ? C.me : "rgba(0,0,0,.13)"}`,
                    background: "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: "50%",
                      flex: "none",
                      background: bal === 0 ? "transparent" : bal > 0 ? C.me : C.fr,
                      border: bal === 0 ? "1px solid rgba(0,0,0,.28)" : 0,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, display: "block", textAlign: "left" }}>
                    <span style={{ display: "block", font: `600 17px ${ARCHIVO}`, color: INK }}>
                      {ledgerDisplayName(l)}
                    </span>
                    <span style={{ display: "block", marginTop: 4, font: `400 12px ${MONO}`, color: MUTED_3 }}>
                      {metaLine(l)}
                    </span>
                  </span>
                  <span
                    style={{
                      flex: "none",
                      font: `500 15px ${MONO}`,
                      fontVariantNumeric: "tabular-nums",
                      color: bal === 0 ? MUTED_4 : bal > 0 ? C.me : C.fr,
                    }}
                  >
                    {runningLabel(bal)}
                  </span>
                </button>
              );
            })}
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
          {adding ? (
            <div
              style={{
                width: "100%",
                padding: "14px 15px 16px",
                borderRadius: 14,
                border: "1px dashed rgba(0,0,0,.28)",
              }}
            >
              <span style={labelStyle}>Friend's email</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={email}
                  autoFocus
                  inputMode="email"
                  autoCapitalize="none"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  placeholder="friend@example.com"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    borderBottom: "1px solid rgba(0,0,0,.22)",
                    paddingBottom: 6,
                    font: `500 15px ${MONO}`,
                    background: "transparent",
                  }}
                />
                <button
                  onClick={() => void submit()}
                  style={{
                    flex: "none",
                    height: 36,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: 0,
                    cursor: "pointer",
                    font: `600 13px ${ARCHIVO}`,
                    background: canCreate ? C.me : "rgba(0,0,0,.14)",
                    color: canCreate ? "#fff" : MUTED_3,
                  }}
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setEmail("");
                    setError(null);
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: "0 2px",
                    font: `500 13px ${ARCHIVO}`,
                    color: MUTED_3,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setAdding(true);
                setError(null);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: "16px 15px",
                borderRadius: 14,
                border: "1px dashed rgba(0,0,0,.28)",
                background: "transparent",
                font: `600 15px ${ARCHIVO}`,
                color: MUTED_2,
                cursor: "pointer",
              }}
            >
              + New ledger
            </button>
          )}

          {error && (
            <div
              style={{
                marginTop: 14,
                borderLeft: `3px solid ${C.me}`,
                paddingLeft: 14,
                font: `400 15px ${ARCHIVO}`,
                lineHeight: 1.5,
                color: MUTED_1,
              }}
            >
              {error}
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
}
