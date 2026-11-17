import { clip, COLORS, colorForTypes, isAlertItem, SUMMARY_MAX } from "@/lib/discord/embed";
import { htmlToDiscordMarkdown } from "@/lib/html/to-discord";
import { truncateMarkdown } from "@/lib/text/truncate";
import type { FeedItem } from "@/lib/types";

// Payload do Workflow do Teams ("Post to a channel when a webhook request is received"):
// uma mensagem com um Adaptive Card por item, com o mesmo conteúdo do embed do Discord.

export const TEAMS_TITLE_MAX = 256;
export const TEAMS_BODY_MAX = 3500;
export const TEAMS_FOOTER_TEXT = "shopify.dev/changelog • bot não oficial";

type TextColor = "Default" | "Attention" | "Warning" | "Good" | "Accent";

const TEXT_COLOR_BY_EMBED_COLOR = new Map<number, TextColor>([
  [COLORS.critical, "Attention"],
  [COLORS.warning, "Warning"],
  [COLORS.success, "Good"],
  [COLORS.info, "Accent"],
  [COLORS.platform, "Accent"],
]);

export type TeamsTextBlock = {
  type: "TextBlock";
  text: string;
  wrap: true;
  size?: "Small" | "Medium" | "Large";
  weight?: "Bolder";
  color?: TextColor;
  isSubtle?: true;
  spacing?: "None" | "Medium";
};
export type TeamsFactSet = { type: "FactSet"; facts: Array<{ title: string; value: string }> };
export type TeamsCard = {
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json";
  type: "AdaptiveCard";
  version: "1.4";
  msteams: { width: "Full" };
  body: Array<TeamsTextBlock | TeamsFactSet>;
  actions: Array<{ type: "Action.OpenUrl"; title: string; url: string }>;
};
export type TeamsPayload = {
  type: "message";
  attachments: [{ contentType: "application/vnd.microsoft.card.adaptive"; contentUrl: null; content: TeamsCard }];
};

type CardSource = Pick<
  FeedItem,
  "title" | "link" | "publishedAt" | "changeTypes" | "areas" | "apiVersions" | "descriptionHtml"
>;

/**
 * Markdown do Discord -> subconjunto que o TextBlock do Teams renderiza (negrito, itálico, listas, links).
 * Blocos de código e citações viram texto simples; escapes do turndown são removidos.
 */
export function toTeamsMarkdown(md: string): string {
  return md
    .replace(/^[ \t>]*`{3,}[^\n]*$/gm, "")
    .replace(/^> ?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
    .replace(/​/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(d);
}

function buildFacts(item: CardSource): TeamsFactSet["facts"] {
  const defs: Array<[string, string, readonly string[]]> = [
    ["Tipo", " · ", item.changeTypes],
    ["Área", ", ", item.areas],
    ["Versão da API", ", ", item.apiVersions],
  ];
  const facts: TeamsFactSet["facts"] = [];
  for (const [title, separator, values] of defs) {
    const value = values
      .map((v) => v.trim())
      .filter((v) => v !== "")
      .join(separator);
    if (value !== "") facts.push({ title, value: clip(value, 1024) });
  }
  return facts;
}

function text(value: string, extra: Omit<TeamsTextBlock, "type" | "text" | "wrap"> = {}): TeamsTextBlock {
  return { type: "TextBlock", text: value, wrap: true, ...extra };
}

export function buildTeamsPayload(item: CardSource, options: { summaryPt?: string | null } = {}): TeamsPayload {
  const body: TeamsCard["body"] = [];

  if (isAlertItem(item.changeTypes)) {
    body.push(text("⚠️ Ação necessária", { weight: "Bolder", color: "Attention" }));
  }

  const title = clip(item.title.trim() || "Shopify changelog", TEAMS_TITLE_MAX);
  const color = TEXT_COLOR_BY_EMBED_COLOR.get(colorForTypes(item.changeTypes)) ?? "Default";
  body.push(text(title, { size: "Large", weight: "Bolder", color }));

  const date = formatDate(item.publishedAt);
  body.push(text(date ? `${date} · ${TEAMS_FOOTER_TEXT}` : TEAMS_FOOTER_TEXT, { size: "Small", isSubtle: true, spacing: "None" }));

  const facts = buildFacts(item);
  if (facts.length > 0) body.push({ type: "FactSet", facts });

  const summary = options.summaryPt?.trim() ? clip(options.summaryPt.trim(), SUMMARY_MAX) : "";
  if (summary !== "") {
    body.push(text("**Resumo (IA)**", { spacing: "Medium" }));
    body.push(text(summary, { spacing: "None" }));
  }

  const markdown = htmlToDiscordMarkdown(item.descriptionHtml).trim();
  if (markdown !== "") {
    const details = toTeamsMarkdown(truncateMarkdown(markdown, TEAMS_BODY_MAX, item.link));
    if (details !== "") {
      if (summary !== "") body.push(text("**Detalhes**", { spacing: "Medium" }));
      body.push(text(details, summary !== "" ? { spacing: "None" } : { spacing: "Medium" }));
    }
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body,
          actions: [{ type: "Action.OpenUrl", title: "Ver no shopify.dev", url: item.link }],
        },
      },
    ],
  };
}
