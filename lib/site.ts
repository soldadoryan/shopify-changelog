import "server-only";
import { getSiteUrl } from "@/lib/env";

export const SITE_NAME = "Changelog Shopify Dev";

/**
 * Origem pública do site, sem barra final. SITE_URL tem prioridade; na Vercel cai no
 * domínio de produção do projeto; em último caso localhost (build local sem env).
 */
export function siteOrigin(): string {
  let configured: string | undefined;
  try {
    configured = getSiteUrl();
  } catch (err) {
    console.warn("[env] SITE_URL inválida; usando o padrão.", err instanceof Error ? err.message : err);
  }
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}
