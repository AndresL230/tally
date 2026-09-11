// Sign-in: email -> six-digit code -> in. Every state keeps the same
// skeleton so the page reads as changing its mind, not navigating away
// (mockup/signin-account.dc.html, artboard 1a; desktop card in 1c).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, api } from "../api";
import { looksLikeEmail } from "../../shared/prefs";
import { ARCHIVO, CARD, DEFAULT_ACCENT, INK, MONO, MUTED_1, MUTED_3, MUTED_6, SERIF } from "../theme";
import { TallyMark } from "../components/TallyMark";

const ACCENT = DEFAULT_ACCENT;
const ERROR_INK = "#8a4a3f";

type CodeError = { kind: "wrong"; triesLeft: number } | { kind: "expired" } | { kind: "tooMany" } | null;

type Step =
  | { name: "email"; retryAfter: number | null }
  | { name: "code"; email: string; error: CodeError }
  | { name: "notInvited" };

export interface SignInScreenProps {
  desktop: boolean;
  onSignedIn: () => void;
}

const LABEL: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 7,
};

const QUIET: CSSProperties = {
  border: 0,
  background: "transparent",
  padding: 0,
  font: `500 13px ${ARCHIVO}`,
  color: MUTED_3,
  cursor: "pointer",
};

export function SignInScreen({ desktop, onSignedIn }: SignInScreenProps) {
  const [step, setStep] = useState<Step>({ name: "email", retryAfter: null });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // "Slow down": count the cooldown down to zero, then re-enable the button.
  useEffect(() => {
    if (step.name !== "email" || step.retryAfter === null) return;
    if (step.retryAfter <= 0) {
      setStep({ name: "email", retryAfter: null });
      return;
    }
    const t = window.setTimeout(() => {
      setStep((s) => (s.name === "email" && s.retryAfter !== null ? { name: "email", retryAfter: s.retryAfter - 1 } : s));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [step]);

  const cooling = step.name === "email" && step.retryAfter !== null;
  const canSend = looksLikeEmail(email.trim()) && !busy && !cooling;

  const sendCode = async (to: string) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.requestCode(to);
      setCode("");
      setStep({ name: "code", email: to.trim().toLowerCase(), error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setStep({ name: "notInvited" });
      } else if (err instanceof ApiError && err.status === 429) {
        const retry = typeof err.body.retry_after === "number" ? err.body.retry_after : 60;
        setStep({ name: "email", retryAfter: retry });
      } else {
        setFailure("That didn't go through — check the connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (digits: string) => {
    if (busy || step.name !== "code") return;
    setBusy(true);
    setFailure(null);
    try {
      await api.verifyCode(step.email, digits);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        if (err.message === "wrong code") {
          const left = typeof err.body.tries_left === "number" ? err.body.tries_left : 0;
          setStep({ ...step, error: { kind: "wrong", triesLeft: left } });
          window.setTimeout(() => codeInput.current?.select(), 0);
        } else {
          // "code expired" covers expired, consumed, superseded, and the
          // fifth miss; the server can't tell us which, but a fifth miss
          // is the one case we saw coming.
          const tooMany = step.error?.kind === "wrong" && step.error.triesLeft === 1;
          setStep({ ...step, error: tooMany ? { kind: "tooMany" } : { kind: "expired" } });
        }
      } else {
        setFailure("That didn't go through — check the connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  // ---- pieces -------------------------------------------------------------

  const heading = (text: string) => (
    <div style={{ marginTop: desktop ? 24 : 26, fontFamily: SERIF, fontSize: desktop ? 40 : 44, lineHeight: 1.02 }}>{text}</div>
  );
  const body = (node: React.ReactNode) => (
    <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: desktop ? undefined : 280 }}>
      {node}
    </div>
  );
  const primary = (label: string, enabled: boolean, onClick: () => void, dim = false) => (
    <button
      onClick={() => {
        if (enabled) onClick();
      }}
      disabled={!enabled}
      style={{
        marginTop: desktop ? 30 : 36,
        width: "100%",
        height: 58,
        borderRadius: 16,
        border: 0,
        cursor: enabled ? "pointer" : "default",
        font: `600 16px ${ARCHIVO}`,
        background: enabled || dim ? ACCENT : "rgba(0,0,0,.14)",
        color: enabled || dim ? "#fff" : MUTED_3,
        opacity: dim ? 0.85 : 1,
      }}
    >
      {label}
    </button>
  );
  const failureLine = failure && (
    <div role="status" style={{ marginTop: 14, font: `400 14px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}>
      {failure}
    </div>
  );

  let content: React.ReactNode;
  if (step.name === "notInvited") {
    content = (
      <>
        {heading("Not on the list yet")}
        {body("Tally is invite-only. Ask the person you share a ledger with to add you, then try again.")}
        {primary("Try another email", true, () => {
          setEmail("");
          setStep({ name: "email", retryAfter: null });
        })}
      </>
    );
  } else if (step.name === "email") {
    content = (
      <>
        {heading("Sign in")}
        {body(
          cooling
            ? "You asked for a code a moment ago. Give it a minute, then try again."
            : "We'll email you a six-digit code. There are no passwords.",
        )}
        <label style={{ display: "block", marginTop: desktop ? 30 : 32 }}>
          <span style={LABEL}>Email</span>
          <input
            value={email}
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) void sendCode(email);
            }}
            placeholder="you@example.com"
            style={{
              width: "100%",
              border: 0,
              borderBottom: "1px solid rgba(0,0,0,.2)",
              paddingBottom: 9,
              font: `500 20px ${ARCHIVO}`,
              background: "transparent",
            }}
          />
        </label>
        {cooling && (
          <div style={{ marginTop: 36, marginBottom: -26, textAlign: "center", font: `500 13px ${MONO}`, color: MUTED_3 }}>
            {`${Math.floor(step.retryAfter! / 60)}:${String(step.retryAfter! % 60).padStart(2, "0")}`}
          </div>
        )}
        {primary(busy ? "Sending…" : "Send me a code", canSend, () => void sendCode(email), busy)}
        {failureLine}
      </>
    );
  } else {
    const err = step.error;
    const gone = err?.kind === "expired" || err?.kind === "tooMany";
    const active = Math.min(code.length, 5);
    const slot = (i: number) => (
      <span
        key={i}
        style={{
          flex: 1,
          textAlign: "center",
          font: `500 32px ${MONO}`,
          color: INK,
          minWidth: 30,
          paddingBottom: i === active && !err ? 7 : 8,
          borderBottom: i === active && !err ? `2px solid ${ACCENT}` : "1px solid rgba(0,0,0,.25)",
          background: err?.kind === "wrong" ? "rgba(10,138,155,.16)" : "transparent",
        }}
      >
        {code[i] ?? " "}
      </span>
    );
    content = (
      <>
        {heading("Check your email")}
        {body(
          gone ? (
            err?.kind === "tooMany" ? "Too many tries — that code is no longer valid." : "That code has expired."
          ) : (
            <>
              We sent a 6-digit code to <span style={{ fontWeight: 500, color: INK }}>{step.email}</span>. It works for 10 minutes.
            </>
          ),
        )}
        {!gone && (
          <div style={{ marginTop: desktop ? 30 : 32, position: "relative" }} onClick={() => codeInput.current?.focus()}>
            <span style={{ ...LABEL, marginBottom: 10 }}>Code</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              {[0, 1, 2].map(slot)}
              <span style={{ width: 4 }} />
              {[3, 4, 5].map(slot)}
            </div>
            {/* One real input behind the slots: paste and iOS "From Messages" fill all six. */}
            <input
              ref={codeInput}
              value={code}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              aria-label="Six-digit code"
              onChange={(e) => onCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) void verify(code);
              }}
              style={{ position: "absolute", inset: 0, opacity: 0, border: 0, font: `32px ${MONO}`, caretColor: "transparent" }}
            />
            {err?.kind === "wrong" && (
              <div
                role="status"
                style={{ marginTop: 10, font: `400 14px ${ARCHIVO}`, lineHeight: 1.45, color: ERROR_INK }}
              >
                {`That code isn't right. ${err.triesLeft} ${err.triesLeft === 1 ? "try" : "tries"} left.`}
              </div>
            )}
          </div>
        )}
        {gone
          ? primary(busy ? "Sending…" : "Send a new code", !busy, () => void sendCode(step.email), busy)
          : primary(busy ? "Signing in…" : "Sign in", code.length === 6 && !busy, () => void verify(code), busy)}
        {failureLine}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8 }}>
          {!gone && (
            <>
              <button style={QUIET} onClick={() => void sendCode(step.email)}>
                Send a new code
              </button>
              <span style={{ font: `400 13px ${ARCHIVO}`, color: MUTED_6 }}>·</span>
            </>
          )}
          <button
            style={QUIET}
            onClick={() => {
              setCode("");
              setStep({ name: "email", retryAfter: null });
            }}
          >
            Use a different email
          </button>
        </div>
      </>
    );
  }

  if (desktop) {
    // A centered card on the paper; the logo lives inside it (artboard 1c).
    return (
      <div style={{ height: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto" }}>
        <div style={{ width: 420, marginTop: 96, background: CARD, border: "1px solid rgba(0,0,0,.09)", borderRadius: 6, padding: "30px 34px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TallyMark height={15} accent={ACCENT} />
            <span style={{ letterSpacing: ".08em", color: ACCENT, font: `600 12px ${MONO}` }}>Tally</span>
          </div>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px", overflowY: "auto" }}>
      {content}
    </div>
  );
}
