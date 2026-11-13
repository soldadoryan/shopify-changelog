import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Changelog Shopify Dev (não oficial)",
    short_name: "Changelog Dev",
    description: "Changelog do shopify.dev com filtros por tipo, área e versão da API. Não oficial.",
    lang: "pt-BR",
    start_url: "/",
    display: "browser",
    background_color: "#f1f2f1",
    theme_color: "#1c1e1d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
