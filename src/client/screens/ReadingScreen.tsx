import { moneyAbs } from "../../shared/format";
import { ARCHIVO, CARD, MONO, MUTED_3, MUTED_4, PAPER, type Colors } from "../theme";

// Port of the mockup's reading screen (sc-if isReading): scanline card,
// four dotted-row steps with a blip animation on the current one, Cancel.
//
// Purely presentational. The PARENT owns the clock: it advances phase.step
// on a ~950ms timer while the single upload+extract round-trip runs, caps
// it at 3 so the last step never completes before the response, then sets
// step 4 with the real values and navigates after a beat.

export interface ReadingPhase {
  /** 0..4 — mockup semantics: step n is done when step > n, current when
   *  step === n. */
  step: number;
  merchant: string | null;
  itemCount: number | null;
  totalCents: number | null;
}

export interface ReadingScreenProps {
  colors: Colors;
  phase: ReadingPhase;
  onCancel: () => void;
}

const STEP_LABELS = [
  "Sharpening the photo",
  "Reading merchant and date",
  "Finding line items",
  "Adding it up",
] as const;

export function ReadingScreen({ colors: C, phase, onCancel }: ReadingScreenProps) {
  const { step } = phase;
  const values = [
    "",
    step >= 2 && phase.merchant ? phase.merchant.slice(0, 14) : "",
    step >= 3 && phase.itemCount !== null ? `${phase.itemCount} found` : "",
    step >= 4 && phase.totalCents !== null ? moneyAbs(phase.totalCents) : "",
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 22px 22px" }}>
      <div style={{ font: `600 10px ${ARCHIVO}`, letterSpacing: ".16em", textTransform: "uppercase", color: MUTED_3 }}>
        Reading the photo
      </div>

      <div
        style={{
          marginTop: 16,
          position: "relative",
          borderRadius: 8,
          overflow: "hidden",
          background: CARD,
          border: "1px solid rgba(0,0,0,.1)",
          height: 250,
          flex: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "repeating-linear-gradient(180deg,rgba(0,0,0,.055) 0 2px,transparent 2px 13px)",
          }}
        />
        <div style={{ position: "absolute", left: 20, top: 22, right: 20 }}>
          <div style={{ height: 14, width: "64%", background: "rgba(0,0,0,.16)", borderRadius: 2 }} />
          <div style={{ height: 8, width: "38%", background: "rgba(0,0,0,.11)", borderRadius: 2, marginTop: 10 }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            background: C.me,
            boxShadow: `0 0 18px 4px ${C.me}73`,
            animation: "scanline 1.15s ease-in-out infinite alternate",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 12,
            backgroundImage: `linear-gradient(45deg,transparent 33.4%,${PAPER} 33.4% 66.6%,transparent 66.6%),linear-gradient(-45deg,transparent 33.4%,${PAPER} 33.4% 66.6%,transparent 66.6%)`,
            backgroundSize: "12px 24px",
          }}
        />
      </div>

      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 2 }}>
        {STEP_LABELS.map((label, n) => {
          const done = step > n;
          const cur = step === n;
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 0",
                borderBottom: "1px dotted rgba(0,0,0,.15)",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  flex: "none",
                  borderRadius: 2,
                  background: done || cur ? C.me : "transparent",
                  border: done || cur ? 0 : "1px solid rgba(0,0,0,.25)",
                  animation: cur ? "blip .8s ease-in-out infinite" : "none",
                }}
              />
              <span style={{ font: `${done ? "500" : "400"} 15px ${ARCHIVO}`, color: done || cur ? "#211f1c" : MUTED_4 }}>
                {label}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ font: `500 12px ${MONO}`, color: MUTED_3 }}>{values[n]}</span>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />
      <button
        onClick={onCancel}
        style={{
          height: 52,
          borderRadius: 16,
          border: "1px solid rgba(0,0,0,.16)",
          background: "transparent",
          font: `600 15px ${ARCHIVO}`,
          color: "#6f6a61",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
