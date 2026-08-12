// The breadcrumb/cancel text control ("‹ Ledgers", "Cancel") shared by every
// screen header. Comfortable padding with negative margins keeps the visual
// anchor where the naked text sat, while the hit area and hover pill (the
// .navlink class in index.html) make it feel like a real control.

import { ARCHIVO, MUTED_3 } from "../theme";

export function BackLink({
  onClick,
  children,
  style,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      className="navlink"
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: 0,
        background: "transparent",
        padding: "9px 13px",
        margin: "-9px -13px",
        borderRadius: 10,
        font: `500 14px ${ARCHIVO}`,
        color: MUTED_3,
        cursor: "pointer",
        textAlign: "left",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
