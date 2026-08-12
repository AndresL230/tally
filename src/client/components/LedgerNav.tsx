// Ledger navigation pieces shared by the phone picker (PickerScreen) and the
// desktop left rail (DesktopShell): the ledger row buttons and the
// + New ledger control. Extracted verbatim from PickerScreen so the two
// surfaces cannot drift.

import { useState } from "react";
import type { LedgerSummary } from "../../shared/types";
import { viewerDelta } from "../../shared/ledger";
import { runningLabel, shortDate } from "../../shared/format";
import { ApiError } from "../api";
import { ARCHIVO, INK, MONO, MUTED_2, MUTED_3, MUTED_4, type Colors } from "../theme";

export function ledgerDisplayName(l: LedgerSummary): string {
  if (l.friend_name) return l.friend_name;
  const local = l.friend_email.split("@")[0] ?? l.friend_email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function metaLine(l: LedgerSummary): string {
  if (l.entry_count === 0 || l.last_entry_on === null) return "no entries yet";
  return `${l.entry_count} ${l.entry_count === 1 ? "entry" : "entries"} · last ${shortDate(l.last_entry_on)}`;
}

export interface LedgerRowsProps {
  ledgers: LedgerSummary[];
  viewerEmail: string;
  colors: Colors;
  /** The open (or last-opened) ledger gets the accent border. */
  activeLedgerId: string | null;
  onOpen: (ledger: LedgerSummary) => void;
  /** Rail spacing: tighter paddings and type than the full-screen picker. */
  compact?: boolean;
}

export function LedgerRows({ ledgers, viewerEmail, colors: C, activeLedgerId, onOpen, compact }: LedgerRowsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10 }}>
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
              gap: compact ? 11 : 13,
              width: "100%",
              padding: compact ? "12px 12px" : "16px 15px",
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
              <span style={{ display: "block", font: `600 ${compact ? 15 : 17}px ${ARCHIVO}`, color: INK }}>
                {ledgerDisplayName(l)}
              </span>
              <span style={{ display: "block", marginTop: 4, font: `400 ${compact ? 11 : 12}px ${MONO}`, color: MUTED_3 }}>
                {metaLine(l)}
              </span>
            </span>
            <span
              style={{
                flex: "none",
                font: `500 ${compact ? 13 : 15}px ${MONO}`,
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
  );
}

export interface NewLedgerControlProps {
  colors: Colors;
  /** Start with the email form open (the picker's empty state). */
  openByDefault?: boolean;
  /** Resolves on success (the app navigates away); throws ApiError on rejection. */
  onCreate: (email: string) => Promise<void>;
  compact?: boolean;
}

export function NewLedgerControl({ colors: C, openByDefault, onCreate, compact }: NewLedgerControlProps) {
  const [adding, setAdding] = useState(!!openByDefault);
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
    <div>
      {adding ? (
        <div
          style={{
            width: "100%",
            padding: compact ? "12px 12px 14px" : "14px 15px 16px",
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
                font: `500 ${compact ? 13 : 15}px ${MONO}`,
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
            padding: compact ? "12px 12px" : "16px 15px",
            borderRadius: 14,
            border: "1px dashed rgba(0,0,0,.28)",
            background: "transparent",
            font: `600 ${compact ? 14 : 15}px ${ARCHIVO}`,
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
            font: `400 ${compact ? 13 : 15}px ${ARCHIVO}`,
            lineHeight: 1.5,
            color: "#4a453d",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
