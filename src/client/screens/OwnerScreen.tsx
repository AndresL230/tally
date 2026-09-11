// Owner settings: who can sign in, invite someone, pending invites.
// mockup/signin-account.dc.html artboards A2 (phone), D (control states),
// D3 (desktop pane).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AdminState, SignupMode } from "../../shared/types";
import { ApiError, api } from "../api";
import { looksLikeEmail } from "../../shared/prefs";
import { shortDate } from "../../shared/format";
import { isoDay } from "../util";
import { ARCHIVO, CARD, INK, MONO, MUTED_1, MUTED_2, MUTED_3, MUTED_4, SERIF, type Colors } from "../theme";

const ERROR_INK = "#8a4a3f";

export interface OwnerScreenProps {
  colors: Colors;
  onBack: () => void;
}

const LABEL: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 10,
};

const HELPER: Record<SignupMode, string> = {
  invite: "Only people you or a ledger has added can sign in.",
  open: "Anyone can sign in and use your scan budget. Switch back when you're done — people who started a ledger keep their access.",
};

type InviteState = { name: "idle" } | { name: "sending" } | { name: "sent"; email: string } | { name: "error"; message: string };

export function OwnerScreen({ colors: C, onBack }: OwnerScreenProps) {
  const [state, setState] = useState<AdminState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<InviteState>({ name: "idle" });
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    api
      .admin()
      .then(setState)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load settings."));
  }, []);

  const setMode = async (mode: SignupMode) => {
    if (!state || switching || state.signup_mode === mode) return;
    setSwitching(true);
    try {
      const { signup_mode } = await api.setSignupMode(mode);
      setState({ ...state, signup_mode });
    } catch {
      // The buttons simply stay where they were.
    } finally {
      setSwitching(false);
    }
  };

  const sendInvite = async () => {
    const to = email.trim();
    if (invite.name === "sending") return;
    if (!looksLikeEmail(to)) {
      setInvite({ name: "error", message: "That's not an email address." });
      return;
    }
    setInvite({ name: "sending" });
    try {
      const sent = await api.invite(to);
      setInvite({ name: "sent", email: sent.email });
      setEmail("");
    } catch (err) {
      setInvite({
        name: "error",
        message: err instanceof ApiError ? err.message : "That didn't go through — check the connection and try again.",
      });
      return;
    }
    try {
      setState(await api.admin());
    } catch {
      // The list refreshes next visit; the "sent" notice above still stands.
    }
  };

  const remove = async (target: string) => {
    if (!state) return;
    setState({ ...state, pending: state.pending.filter((p) => p.email !== target) });
    try {
      await api.removeInvite(target);
    } catch {
      setState(await api.admin().catch(() => state));
    }
  };

  const segment = (mode: SignupMode, label: string) => {
    const on = state?.signup_mode === mode;
    return (
      <button
        onClick={() => void setMode(mode)}
        aria-pressed={on}
        disabled={!state || switching}
        style={{
          flex: 1,
          textAlign: "center",
          padding: "9px 14px",
          borderRadius: 10,
          font: `500 14px ${ARCHIVO}`,
          background: on ? INK : "transparent",
          color: on ? CARD : MUTED_1,
          border: `1px solid ${on ? INK : "rgba(0,0,0,.28)"}`,
          cursor: on ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px", overflowY: "auto" }}>
      <button
        onClick={onBack}
        className="navlink"
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "transparent",
          padding: "9px 13px",
          margin: "-9px -13px",
          borderRadius: 10,
          font: `500 14px ${ARCHIVO}`,
          color: MUTED_3,
          cursor: "pointer",
        }}
      >
        ‹ Back
      </button>
      <div style={{ marginTop: 26, fontFamily: SERIF, fontSize: 44, lineHeight: 1.02 }}>Owner settings</div>
      <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: 280 }}>
        Who can sign in, and who's been invited.
      </div>
      {loadError && (
        <div style={{ marginTop: 20, font: `400 14px ${ARCHIVO}`, color: ERROR_INK }}>{loadError}</div>
      )}

      <div style={{ marginTop: 32, maxWidth: 420 }}>
        <span style={LABEL}>Who can sign in</span>
        <div style={{ display: "flex", gap: 8 }}>
          {segment("invite", "Invite only")}
          {segment("open", "Anyone with an email")}
        </div>
        <div style={{ marginTop: 8, font: `400 13px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_2 }}>
          {state ? HELPER[state.signup_mode] : " "}
        </div>
      </div>

      <div style={{ marginTop: 28, maxWidth: 420 }}>
        <span style={LABEL}>Invite someone</span>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <input
            value={email}
            inputMode="email"
            autoCapitalize="none"
            placeholder="friend@example.com"
            onChange={(e) => {
              setEmail(e.target.value);
              if (invite.name === "error") setInvite({ name: "idle" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendInvite();
            }}
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
            onClick={() => void sendInvite()}
            disabled={invite.name === "sending"}
            style={{
              flex: "none",
              border: 0,
              background: "transparent",
              padding: "0 0 6px",
              font: `600 13px ${ARCHIVO}`,
              color: invite.name === "sending" ? MUTED_3 : C.me,
              cursor: invite.name === "sending" ? "default" : "pointer",
            }}
          >
            {invite.name === "sending" ? "Sending…" : "Send invite"}
          </button>
        </div>
        {invite.name === "sent" && (
          <div style={{ marginTop: 10, borderLeft: `3px solid ${C.me}`, paddingLeft: 14, font: `400 13px ${ARCHIVO}`, lineHeight: 1.5, color: MUTED_1 }}>
            {`Invited ${invite.email} — they'll get an email.`}
          </div>
        )}
        {invite.name === "error" && (
          <div style={{ marginTop: 10, font: `400 13px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}>{invite.message}</div>
        )}
      </div>

      <div style={{ marginTop: 28, maxWidth: 420 }}>
        <span style={LABEL}>Pending invites</span>
        {!state || state.pending.length === 0 ? (
          <div style={{ font: `400 13px ${ARCHIVO}`, color: MUTED_3 }}>No pending invites.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {state.pending.map((p) => (
              <div key={p.email} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0, font: `400 13px ${MONO}`, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.email}
                </span>
                <span style={{ flex: "none", font: `400 11px ${MONO}`, color: MUTED_4 }}>{shortDate(isoDay(p.invited_at))}</span>
                <button
                  onClick={() => void remove(p.email)}
                  style={{ flex: "none", border: 0, background: "transparent", padding: 0, font: `500 12px ${ARCHIVO}`, color: MUTED_3, cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
