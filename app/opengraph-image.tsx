import { ImageResponse } from "next/og";

export const alt = "Changelog Shopify Dev (não oficial): ações necessárias, breaking changes e depreciações do shopify.dev";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ROWS = [
  { label: "Ação necessária", bg: "#c8321f", fg: "#ffffff" },
  { label: "Breaking change", bg: "#c8321f", fg: "#ffffff" },
  { label: "Depreciação", bg: "#ffe1a8", fg: "#5b3d00" },
  { label: "Novo", bg: "#c4f2d6", fg: "#0c4a35" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#f1f2f1",
          color: "#232524",
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#1c9b6c",
              display: "flex",
            }}
          />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>Changelog Shopify Dev</div>
          <div
            style={{
              display: "flex",
              border: "2px solid #9aa09d",
              borderRadius: 999,
              padding: "4px 16px",
              fontSize: 22,
              color: "#4f5552",
            }}
          >
            Não oficial
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1.1, maxWidth: 980 }}>
            O que mudou no shopify.dev, com o que exige ação em destaque
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {ROWS.map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  background: r.bg,
                  color: r.fg,
                  borderRadius: 10,
                  padding: "8px 18px",
                  fontSize: 24,
                }}
              >
                {r.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
