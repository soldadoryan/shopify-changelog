import { htmlToDiscordMarkdown } from "@/lib/html/to-discord";
import { truncateMarkdown } from "@/lib/text/truncate";
import type { FeedItem } from "@/lib/types";

// Payload do webhook do Discord: uma mensagem, um embed por item.

export const EMBED_TITLE_MAX = 256;
export const EMBED_FIELD_VALUE_MAX = 1024;
export const EMBED_FIELDS_MAX = 25;
export const EMBED_TOTAL_MAX = 6000;
export const EMBED_DESCRIPTION_MAX = 3800;
export const SUMMARY_MAX = 1000;
export const BOT_USERNAME = "Shopify Dev Changelog";
export const FOOTER_TEXT = "shopify.dev/changelog • bot não oficial";

export const COLORS = {
  critical: 0xe51c00,
  warning: 0xffb800,
  success: 0x29845a,
  info: 0x0094d5,
  platform: 0x8051ff,
  none: 0x8a8a8a,
} as const;

// Ordem = prioridade (primeiro que casar define a cor).
const COLOR_BY_TYPE: ReadonlyArray<readonly [string, number]> = [
  ["Breaking API Change", COLORS.critical],
  ["Action Required", COLORS.critical],
  ["Deprecation announcement", COLORS.warning],
  ["New", COLORS.success],
  ["Update", COLORS.info],
  ["Platform", COLORS.platform],
];
const ALERT_TYPES = new Set(["Action Required", "Breaking API Change"]);

export type DiscordEmbedField = { name: string; value: string; inline: boolean };
export type DiscordEmbed = {
  title: string;
  url: string;
  color: number;
  description: string;
  fields: DiscordEmbedField[];
  timestamp?: string;
  footer: { text: string };
};
export type DiscordPayload = {
  username: string;
  content?: string;
  allowed_mentions: { parse: never[]; roles?: string[] };
  embeds: [DiscordEmbed];
};

export type BuildPayloadOptions = {
  /** Resumo pt-BR (summary_pt); ausente/vazio = só o corpo. */
  summaryPt?: string | null;
  /** DISCORD_ALERT_ROLE_ID; só usado para Action Required / Breaking API Change. */
  alertRoleId?: string | null;
};

type EmbedSource = Pick<
  FeedItem,
  "title" | "link" | "publishedAt" | "changeTypes" | "areas" | "apiVersions" | "descriptionHtml"
>;

/** Corta em `max` unidades UTF-16 sem separar um par substituto; acrescenta "…" dentro do limite. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  const code = text.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Defesa extra para texto que não passou por htmlToDiscordMarkdown (ex.: saída do modelo). */
export function neutralizeMentions(text: string): string {
  return text.replace(/@(?=everyone|here)/gi, "@​").replace(/<(?=[@#])/g, "<​");
}

export function colorForTypes(changeTypes: readonly string[]): number {
  for (const [type, color] of COLOR_BY_TYPE) {
    if (changeTypes.includes(type)) return color;
  }
  return COLORS.none;
}

export function isAlertItem(changeTypes: readonly string[]): boolean {
  return changeTypes.some((t) => ALERT_TYPES.has(t));
}

function buildFields(item: EmbedSource): DiscordEmbedField[] {
  const defs: Array<[string, string, readonly string[]]> = [
    ["Tipo", " · ", item.changeTypes],
    ["Área", ", ", item.areas],
    ["Versão da API", ", ", item.apiVersions],
  ];
  const fields: DiscordEmbedField[] = [];
  for (const [name, separator, values] of defs) {
    const value = values
      .map((v) => v.trim())
      .filter((v) => v !== "")
      .join(separator);
    if (value !== "") {
      fields.push({ name, value: clip(neutralizeMentions(value), EMBED_FIELD_VALUE_MAX), inline: true });
    }
  }
  return fields.slice(0, EMBED_FIELDS_MAX);
}

/** Soma title + description + nomes/valores dos fields + footer (regra de 6000 do Discord). */
export function embedLength(embed: DiscordEmbed): number {
  let total = embed.title.length + embed.description.length + embed.footer.text.length;
  for (const f of embed.fields) total += f.name.length + f.value.length;
  return total;
}

function buildDescription(item: EmbedSource, summaryPt: string | null | undefined, budget: number): string {
  const markdown = htmlToDiscordMarkdown(item.descriptionHtml).trim();
  const fallback = `[Ver no shopify.dev](${item.link})`;
  const summary = summaryPt?.trim() ? clip(neutralizeMentions(summaryPt.trim()), SUMMARY_MAX) : "";

  if (markdown === "") {
    const text = summary === "" ? fallback : `**Resumo (IA)**\n${summary}\n\n${fallback}`;
    return clip(text, budget);
  }

  let prefix = summary === "" ? "" : `**Resumo (IA)**\n${summary}\n\n**Detalhes**\n`;
  // Sem espaço decente para o corpo: descarta o resumo (o corpo é o essencial).
  if (prefix !== "" && budget - prefix.length < 200) prefix = "";

  const out = prefix + truncateMarkdown(markdown, Math.max(1, budget - prefix.length), item.link);
  return out.length > budget ? clip(out, budget) : out;
}

export function buildDiscordPayload(item: EmbedSource, options: BuildPayloadOptions = {}): DiscordPayload {
  const title = clip(neutralizeMentions(item.title.trim()) || "Shopify changelog", EMBED_TITLE_MAX);
  const fields = buildFields(item);
  const fixed = title.length + FOOTER_TEXT.length + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  const budget = Math.max(0, Math.min(EMBED_DESCRIPTION_MAX, EMBED_TOTAL_MAX - fixed));

  const embed: DiscordEmbed = {
    title,
    url: item.link,
    color: colorForTypes(item.changeTypes),
    description: buildDescription(item, options.summaryPt, budget),
    fields,
    footer: { text: FOOTER_TEXT },
  };
  const ts = new Date(item.publishedAt);
  if (!Number.isNaN(ts.getTime())) embed.timestamp = ts.toISOString();

  const payload: DiscordPayload = {
    username: BOT_USERNAME,
    allowed_mentions: { parse: [] },
    embeds: [embed],
  };
  const roleId = options.alertRoleId?.trim();
  if (roleId && /^\d+$/.test(roleId) && isAlertItem(item.changeTypes)) {
    payload.content = `<@&${roleId}> ⚠️ Ação necessária`;
    payload.allowed_mentions.roles = [roleId];
  }
  return payload;
}
