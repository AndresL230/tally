// TALLY_DEV_GALLERY — the dev-only state gallery (reconciled decision E).
// Reached only via `#gallery` in dev builds; main.tsx's `import.meta.env.DEV`
// guard makes production drop this whole chunk. It renders the REAL screen
// components against fixture data inside the app shell, with the mockup's
// States sidebar (jump chips + swatch legend) on the right and an accent
// switcher so every state can be eyeballed in each palette color.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LedgerDetail } from "../../shared/types";
import { ACCENT_PALETTE, ARCHIVO, MONO, PAPER, colorsFor, halfBg, type Colors } from "../theme";
import { LedgerScreen } from "../screens/LedgerScreen";
import { PickerScreen } from "../screens/PickerScreen";
import { StartScreen } from "../screens/StartScreen";
import { ManualScreen } from "../screens/ManualScreen";
import { PercentScreen } from "../screens/PercentScreen";
import { SettleScreen } from "../screens/SettleScreen";
import { DetailScreen } from "../screens/DetailScreen";
import { ReadingScreen } from "../screens/ReadingScreen";
import { ConfirmScreen } from "../screens/ConfirmScreen";
import {
  FRIEND,
  VIEWER,
  emptyDetail,
  entryIn,
  jordanBalanceCents,
  jordanDetail,
  nongsItemsMixed,
  nongsItemsUntouched,
  nongsReceipt,
  nongsReceiptEditedDown,
  oweDetail,
  percentReceipt,
  pickerLedgers,
  settledDetail,
  voidedDetail,
} from "./fixtures";

const MARKER = "TALLY_DEV_GALLERY";
const F = "Jordan";

/* eslint-disable no-console */
const log =
  (label: string) =>
  (...args: unknown[]) =>
    console.log(`[gallery] ${label}`, ...args);

const logAsync =
  (label: string) =>
  async (...args: unknown[]) => {
    console.log(`[gallery] ${label}`, ...args);
  };

/** Confirm receipt shape (the slice ConfirmScreen wants). */
function receiptSlice(r: { merchant: string | null; purchased_on: string | null; total_cents: number | null }) {
  return { merchant: r.merchant, purchased_on: r.purchased_on, total_cents: r.total_cents };
}

/** Wraps the confirm screen and taps its commit button once on mount, so the
 *  armed beat state ("Yes, all of it is Jordan's") is directly visible. */
function AutoArm({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const buttons = ref.current?.querySelectorAll("button") ?? [];
      for (const b of buttons) {
        if (b.textContent === "Add to ledger") {
          b.click();
          break;
        }
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

export interface GalleryState {
  id: string;
  label: string;
  render: (C: Colors, accent: string, setAccent: (hex: string) => void) => ReactNode;
}

function detailState(id: string, label: string, d: LedgerDetail, entryId: string): GalleryState {
  return {
    id,
    label,
    render: (C) => (
      <DetailScreen
        entry={entryIn(d, entryId)}
        detail={d}
        colors={C}
        friendName={F}
        onBack={log("detail back")}
        onVoid={log("void entry")}
      />
    ),
  };
}

const ledgerScreen = (C: Colors, d: LedgerDetail) => (
  <LedgerScreen
    detail={d}
    colors={C}
    friendName={F}
    onOpenEntry={log("open entry")}
    onSettle={log("settle")}
    onTakePhoto={log("take photo")}
    onChooseFromLibrary={log("choose from library")}
    onEnterByHand={log("enter by hand")}
    onBackToPicker={log("back to picker")}
  />
);

export const STATES: GalleryState[] = [
  {
    id: "onboarding",
    label: "Onboarding",
    render: (C, accent, setAccent) => (
      <StartScreen colors={C} accent={accent} onPickAccent={setAccent} onSave={log("save prefs")} />
    ),
  },
  {
    id: "picker",
    label: "Pick a ledger",
    render: (C) => (
      <PickerScreen
        ledgers={pickerLedgers}
        viewerEmail={VIEWER}
        colors={C}
        activeLedgerId="led-jordan"
        onOpen={log("open ledger")}
        onCreate={logAsync("create ledger")}
        onEditPrefs={log("edit prefs")}
      />
    ),
  },
  { id: "ledger-owed", label: "Ledger — owed to you", render: (C) => ledgerScreen(C, jordanDetail) },
  { id: "ledger-owe", label: "Ledger — you owe", render: (C) => ledgerScreen(C, oweDetail) },
  { id: "ledger-settled", label: "Balance at zero", render: (C) => ledgerScreen(C, settledDetail) },
  { id: "ledger-empty", label: "Empty ledger", render: (C) => ledgerScreen(C, emptyDetail) },
  {
    id: "reading-1",
    label: "Reading — step 1",
    render: (C) => (
      <ReadingScreen
        colors={C}
        phase={{ step: 1, merchant: null, itemCount: null, totalCents: null }}
        onCancel={log("cancel reading")}
      />
    ),
  },
  {
    id: "reading-3",
    label: "Reading — values filling",
    render: (C) => (
      <ReadingScreen
        colors={C}
        phase={{
          step: 3,
          merchant: nongsReceipt.merchant,
          itemCount: nongsItemsUntouched.length,
          totalCents: nongsReceipt.total_cents,
        }}
        onCancel={log("cancel reading")}
      />
    ),
  },
  {
    id: "confirm-hero",
    label: "Confirm (hero)",
    render: (C) => (
      <ConfirmScreen
        colors={C}
        friendName={F}
        viewerEmail={VIEWER}
        friendEmail={FRIEND}
        receipt={receiptSlice(nongsReceipt)}
        initialItems={nongsItemsMixed}
        onCancel={log("cancel confirm")}
        onCommit={log("commit confirm")}
        onFallbackPercent={log("fallback percent")}
      />
    ),
  },
  {
    id: "confirm-armed",
    label: "Confirm — armed beat",
    render: (C) => (
      <AutoArm>
        <ConfirmScreen
          colors={C}
          friendName={F}
          viewerEmail={VIEWER}
          friendEmail={FRIEND}
          receipt={receiptSlice(nongsReceipt)}
          initialItems={nongsItemsUntouched}
          onCancel={log("cancel confirm")}
          onCommit={log("commit confirm (all theirs)")}
          onFallbackPercent={log("fallback percent")}
        />
      </AutoArm>
    ),
  },
  {
    id: "confirm-negative-extra",
    label: "Confirm — negative extra",
    render: (C) => (
      <ConfirmScreen
        colors={C}
        friendName={F}
        viewerEmail={VIEWER}
        friendEmail={FRIEND}
        receipt={receiptSlice(nongsReceiptEditedDown)}
        initialItems={nongsItemsMixed}
        onCancel={log("cancel confirm")}
        onCommit={log("commit confirm")}
        onFallbackPercent={log("fallback percent")}
      />
    ),
  },
  {
    id: "percent",
    label: "No line items found",
    render: (C) => (
      <PercentScreen
        colors={C}
        friendName={F}
        merchant={percentReceipt.merchant ?? "Receipt"}
        occurredOn={percentReceipt.purchased_on ?? "2026-08-09"}
        totalCents={percentReceipt.total_cents ?? 0}
        payer={VIEWER}
        viewerEmail={VIEWER}
        friendEmail={FRIEND}
        onCancel={log("cancel percent")}
        onCommit={log("commit percent")}
      />
    ),
  },
  {
    id: "manual-byhand",
    label: "Manual — by hand",
    render: (C) => (
      <ManualScreen
        reason="byhand"
        colors={C}
        friendName={F}
        viewerEmail={VIEWER}
        friendEmail={FRIEND}
        onCancel={log("cancel manual")}
        onCommit={log("commit manual")}
      />
    ),
  },
  {
    id: "manual-photofail",
    label: "Photo didn't read",
    render: (C) => (
      <ManualScreen
        reason="photofail"
        colors={C}
        friendName={F}
        viewerEmail={VIEWER}
        friendEmail={FRIEND}
        onCancel={log("cancel manual")}
        onCommit={log("commit manual")}
        onRetake={log("retake photo")}
      />
    ),
  },
  {
    id: "settle",
    label: "Settle up",
    render: (C) => (
      <SettleScreen
        colors={C}
        friendName={F}
        balanceCents={jordanBalanceCents}
        onCancel={log("cancel settle")}
        onCommit={log("record payment")}
      />
    ),
  },
  {
    id: "settle-zero",
    label: "Nothing to settle",
    render: (C) => (
      <SettleScreen
        colors={C}
        friendName={F}
        balanceCents={0}
        onCancel={log("cancel settle")}
        onCommit={log("record payment")}
      />
    ),
  },
  detailState("detail-items", "Detail — items entry", jordanDetail, "exp-safeway"),
  detailState("detail-percent", "Detail — percent entry", jordanDetail, "exp-tj"),
  detailState("detail-settlement", "Detail — settlement", jordanDetail, "set-1"),
  detailState("detail-voided", "Detail — voided original", voidedDetail, "void-fm"),
  detailState("detail-reversal", "Detail — reversal", voidedDetail, "void-fm-rev"),
];

export function Gallery() {
  const [selected, setSelected] = useState(STATES[0]!.id);
  const [accent, setAccent] = useState<string>(ACCENT_PALETTE[0]);
  const C = colorsFor(accent);
  const state = STATES.find((s) => s.id === selected) ?? STATES[0]!;

  return (
    <div
      data-gallery={MARKER}
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 34,
        padding: "40px 24px 48px",
        background: PAPER,
      }}
    >
      {/* Phone frame: the app Shell look (44px top bar, mono wordmark). */}
      <div
        style={{
          width: 410,
          flex: "none",
          height: "min(844px, calc(100vh - 88px))",
          minHeight: 560,
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          border: "1px solid rgba(0,0,0,.16)",
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 18px 44px rgba(20,17,12,.10)",
          position: "sticky",
          top: 40,
        }}
      >
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
          <span style={{ letterSpacing: ".08em", color: C.me, font: `600 12px ${MONO}` }}>Tally</span>
        </div>
        {/* Key by state id + accent so each jump remounts the screen with
            fresh internal state (the real screens keep their own useState). */}
        <div
          key={`${state.id}|${accent}`}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {state.render(C, accent, setAccent)}
        </div>
      </div>

      {/* The mockup's States sidebar: jump chips + swatch legend. */}
      <div
        style={{
          width: 250,
          flex: "none",
          position: "sticky",
          top: 40,
          maxHeight: "calc(100vh - 88px)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          paddingRight: 2,
        }}
      >
        <div>
          <div
            style={{
              font: `600 10px ${ARCHIVO}`,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#8a857c",
              marginBottom: 10,
            }}
          >
            States
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {STATES.map((s) => {
              const active = s.id === selected;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  style={{
                    textAlign: "left",
                    padding: "11px 13px",
                    borderRadius: 10,
                    cursor: "pointer",
                    font: `500 13.5px ${ARCHIVO}`,
                    border: `1px solid ${active ? C.me : "rgba(0,0,0,.12)"}`,
                    background: active ? `${C.me}22` : "transparent",
                    color: active ? C.deep : "#4a453d",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div
            style={{
              font: `600 10px ${ARCHIVO}`,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#8a857c",
              marginBottom: 10,
            }}
          >
            Accent
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {ACCENT_PALETTE.map((hex) => {
              const sel = accent === hex;
              return (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  aria-pressed={sel}
                  title={hex}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    padding: 0,
                    cursor: "pointer",
                    background: "transparent",
                    border: `2px solid ${sel ? hex : "transparent"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: sel ? 16 : 20,
                      height: sel ? 16 : 20,
                      borderRadius: "50%",
                      background: hex,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid rgba(0,0,0,.12)",
            paddingTop: 16,
            font: `400 12.5px ${ARCHIVO}`,
            lineHeight: 1.6,
            color: "#6f6a61",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span style={swatch(C.me)} />
            You
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span style={swatch(C.fr)} />
            {F}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={swatch(halfBg(C))} />
            Half each
          </div>
        </div>
      </div>
    </div>
  );
}

function swatch(bg: string): React.CSSProperties {
  return { width: 13, height: 13, borderRadius: 3, background: bg, display: "inline-block", flex: "none" };
}
