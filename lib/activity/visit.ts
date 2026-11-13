import { ACTIVITY_COLORS, ACTIVITY_USERNAME, type ActivityPayload } from "./types";
import { countryFlag, safeText } from "./text";
import { describeUserAgent, isBotUserAgent } from "./user-agent";

export const SEEN_COOKIE = "cl_seen";
export const SEEN_COOKIE_MAX_AGE = 1800;

const EXCLUDED_PREFIXES = [
  "/_next",
  "/api",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/icon",
  "/manifest",
  "/favicon",
  "/llms.txt",
];

export type VisitRequest = {
  method: string;
  pathname: string;
  search?: string;
  header(name: string): string | null | undefined;
  hasCookie: boolean;
};

export type VisitDecision =
  | { notify: true }
  | { notify: false; reason: "method" | "not_html" | "prefetch" | "excluded" | "bot" | "seen" };

function isPrefetch(req: VisitRequest): boolean {
  return (
    !!req.header("next-router-prefetch") ||
    /prefetch/i.test(req.header("purpose") ?? "") ||
    /prefetch/i.test(req.header("sec-purpose") ?? "") ||
    !!req.header("rsc") ||
    /(^|&)_rsc=/.test((req.search ?? "").replace(/^\?/, ""))
  );
}

export function isExcludedPath(pathname: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`) || pathname.startsWith(`${p}-`))) {
    return true;
  }
  const last = pathname.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]+$/.test(last);
}

/** Decide se este request é uma visita nova de pessoa a uma página (sem efeito colateral). */
export function decideVisit(req: VisitRequest): VisitDecision {
  if (req.method !== "GET") return { notify: false, reason: "method" };
  if (!(req.header("accept") ?? "").includes("text/html")) return { notify: false, reason: "not_html" };
  if (isPrefetch(req)) return { notify: false, reason: "prefetch" };
  if (isExcludedPath(req.pathname)) return { notify: false, reason: "excluded" };
  if (isBotUserAgent(req.header("user-agent"))) return { notify: false, reason: "bot" };
  if (req.hasCookie) return { notify: false, reason: "seen" };
  return { notify: true };
}

export type VisitInfo = {
  pathname: string;
  search?: string;
  country?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  ownHost?: string | null;
  droppedSinceLast?: number;
  now?: Date;
};

function refererHost(referer: string | null | undefined, ownHost: string | null | undefined): string {
  if (!referer) return "direto";
  try {
    const host = new URL(referer).host;
    if (host === "" || (ownHost && host === ownHost)) return "direto";
    return safeText(host, 100);
  } catch {
    return "direto";
  }
}

/** Embed do aviso de acesso. Não recebe nem inclui IP. */
export function buildVisitPayload(info: VisitInfo): ActivityPayload {
  const code = (info.country ?? "").trim().toUpperCase();
  const flag = countryFlag(code);
  const country = flag ? `${flag} ${code}` : "desconhecido";
  const page = safeText(`${info.pathname}${info.search ?? ""}`, 200) || "/";
  const fields = [
    { name: "Página", value: `\`${page}\``, inline: false },
    { name: "País", value: country, inline: true },
    { name: "Navegador/SO", value: safeText(describeUserAgent(info.userAgent), 100), inline: true },
    { name: "Origem", value: refererHost(info.referer, info.ownHost), inline: true },
  ];
  if (info.droppedSinceLast && info.droppedSinceLast > 0) {
    fields.push({ name: "Não notificados", value: `+${info.droppedSinceLast} acessos não notificados`, inline: false });
  }
  return {
    username: ACTIVITY_USERNAME,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "👀 Novo acesso ao site",
        color: ACTIVITY_COLORS.visit,
        fields,
        timestamp: (info.now ?? new Date()).toISOString(),
        footer: { text: "Changelog Shopify Dev · acesso" },
      },
    ],
  };
}
