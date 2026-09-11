// The account area under the receipt tear at the bottom of "Your ledgers":
// an identity row (name + your color), the owner-only settings row, and the
// quiet centered footer "About Tally · Sign out". Shared by the phone picker
// and the desktop rail (compact) so the two can't drift.

import { useState } from "react";
import type { CSSProperties } from "react";
import { ARCHIVO, INK, MUTED_1, MUTED_3, MUTED_4, MUTED_6, type Colors } from "../theme";

export interface AccountAreaProps {
  colors: Colors;
  displayName: string;
  isAdmin: boolean;
  compact?: boolean;
  onEditPrefs: () => void;
  onOwnerSettings: () => void;
  /** Called once; the label reads "Signed out." while the caller finishes. */
  onSignOut: () => void;
}

function Row({
  dot,
  title,
  subtitle,
  compact,
  onClick,
}: {
  dot: string;
  title: string;
  subtitle: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 11 : 13,
        width: "100%",
        padding: compact ? "10px 12px" : "12px 15px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,.13)",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ width: 11, height: 11, borderRadius: "50%", flex: "none", background: dot }} />
      <span style={{ flex: 1, minWidth: 0, display: "block" }}>
        <span style={{ display: "block", font: `600 ${compact ? 14 : 15}px ${ARCHIVO}`, color: INK }}>{title}</span>
        <span style={{ display: "block", marginTop: compact ? 2 : 3, font: `400 ${compact ? 11 : 12}px ${ARCHIVO}`, color: MUTED_3 }}>
          {subtitle}
        </span>
      </span>
      <span style={{ flex: "none", font: `500 ${compact ? 15 : 16}px ${ARCHIVO}`, color: MUTED_4 }}>›</span>
    </button>
  );
}

export function AccountArea({ colors: C, displayName, isAdmin, compact, onEditPrefs, onOwnerSettings, onSignOut }: AccountAreaProps) {
  const [signedOut, setSignedOut] = useState(false);
  const quiet: CSSProperties = {
    border: 0,
    background: "transparent",
    padding: 0,
    font: `500 ${compact ? 12 : 13}px ${ARCHIVO}`,
    color: MUTED_3,
    cursor: "pointer",
    textDecoration: "none",
  };
  return (
    <div
      style={{
        marginTop: compact ? 20 : 28,
        borderTop: "1px dashed rgba(0,0,0,.2)",
        paddingTop: compact ? 14 : 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <Row dot={C.me} title={displayName} subtitle="Your name and color" compact={compact} onClick={onEditPrefs} />
      {isAdmin && (
        <Row dot={INK} title="Owner settings" subtitle="Who can sign in · invites" compact={compact} onClick={onOwnerSettings} />
      )}
      <div style={{ marginTop: compact ? 10 : 12, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8 }}>
        <a href="/welcome" style={quiet}>
          About Tally
        </a>
        <span style={{ font: `400 ${compact ? 12 : 13}px ${ARCHIVO}`, color: MUTED_6 }}>·</span>
        {signedOut ? (
          <span style={{ ...quiet, color: MUTED_1, cursor: "default" }}>Signed out.</span>
        ) : (
          <button
            style={quiet}
            onClick={() => {
              setSignedOut(true);
              onSignOut();
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
