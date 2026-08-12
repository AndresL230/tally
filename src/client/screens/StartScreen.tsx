import { useState } from "react";
import type { CSSProperties } from "react";
import { ACCENT_PALETTE, ARCHIVO, CARD, MONO, MUTED_1, MUTED_2, MUTED_3, SERIF, halfBg, type Colors } from "../theme";

export interface StartScreenProps {
  /** Derived from `accent` by the caller so the whole shell live-previews. */
  colors: Colors;
  accent: string;
  onPickAccent: (hex: string) => void;
  busy?: boolean;
  onSave: (prefs: { display_name: string; accent_color: string }) => void;
  /** Edit mode (from the picker): prefill, softer copy, a cancel path. */
  initialName?: string;
  onCancel?: () => void;
}

const LABEL: CSSProperties = {
  display: "block",
  font: `600 9.5px ${ARCHIVO}`,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: MUTED_3,
  marginBottom: 7,
};

export function StartScreen({ colors: C, accent, onPickAccent, busy, onSave, initialName, onCancel }: StartScreenProps) {
  const editing = initialName !== undefined;
  const [name, setName] = useState(initialName ?? "");
  const ready = name.trim().length > 0 && !busy;

  const sampleBody = (bg: string, last = false): CSSProperties => ({
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 13px",
    background: bg,
    ...(last ? {} : { borderBottom: "1px solid rgba(0,0,0,.06)" }),
  });
  const sampleName: CSSProperties = { flex: 1, font: `500 14px ${ARCHIVO}` };
  const samplePrice: CSSProperties = { font: `500 13px ${MONO}` };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 24px 22px" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ border: 0, background: "transparent", padding: 0, font: `500 14px ${ARCHIVO}`, color: MUTED_3, cursor: "pointer" }}
          >
            ‹ Back
          </button>
        )}
        <div style={{ marginTop: 26, fontFamily: SERIF, fontSize: 44, lineHeight: 1.02 }}>
          {editing ? "You" : "Get started"}
        </div>
        <div style={{ marginTop: 10, font: `400 16px ${ARCHIVO}`, lineHeight: 1.45, color: MUTED_1, maxWidth: 280 }}>
          Your name is what your friends see on every entry.
        </div>

        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 24 }}>
          <label style={{ display: "block" }}>
            <span style={LABEL}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Rivera"
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

          <div>
            <span style={LABEL}>Your color</span>
            <span style={{ display: "block", font: `400 13px ${ARCHIVO}`, color: MUTED_2, marginBottom: 12 }}>
              Everything of yours on a receipt is marked in it.
            </span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ACCENT_PALETTE.map((hex) => {
                const sel = accent === hex;
                return (
                  <button
                    key={hex}
                    onClick={() => onPickAccent(hex)}
                    aria-pressed={sel}
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: "50%",
                      padding: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: `2px solid ${sel ? hex : "transparent"}`,
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: sel ? 32 : 38,
                        height: sel ? 32 : 38,
                        borderRadius: "50%",
                        background: hex,
                      }}
                    />
                  </button>
                );
              })}
            </div>

            {/* The three sample rows: spines/tints track the picked color live. */}
            <div
              style={{
                marginTop: 16,
                border: "1px solid rgba(0,0,0,.09)",
                borderRadius: 6,
                background: CARD,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <span style={{ width: 9, flex: "none", background: C.me }} />
                <span style={sampleBody(`${C.me}1f`)}>
                  <span style={sampleName}>Your item</span>
                  <span style={samplePrice}>$12.00</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <span style={{ width: 9, flex: "none", background: halfBg(C) }} />
                <span style={sampleBody(`${C.me}0d`)}>
                  <span style={sampleName}>Half each</span>
                  <span style={samplePrice}>$8.00</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <span style={{ width: 9, flex: "none", background: C.fr }} />
                <span style={sampleBody("rgba(44,40,35,.05)", true)}>
                  <span style={sampleName}>Their item</span>
                  <span style={samplePrice}>$9.50</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: "none", paddingTop: 12 }}>
        <button
          onClick={() => {
            if (!ready) return;
            onSave({ display_name: name.trim(), accent_color: accent });
          }}
          style={{
            width: "100%",
            height: 58,
            borderRadius: 16,
            border: 0,
            cursor: "pointer",
            font: `600 16px ${ARCHIVO}`,
            background: ready ? C.me : "rgba(0,0,0,.14)",
            color: ready ? "#fff" : MUTED_3,
          }}
        >
          {editing ? "Save" : "Open the ledger"}
        </button>
      </div>
    </div>
  );
}
