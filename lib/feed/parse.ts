import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { FeedItem } from "@/lib/types";
import { classifyCategories, contentHash, resolveSlugCollision, slugFromLink } from "./classify";
import { FeedParseError } from "./errors";
import { htmlToSearchText } from "./text";

const SITE_ORIGIN = "https://shopify.dev";

// parseTagValue/parseAttributeValue:false evita "2026-10" -> número; CDATA vira texto cru (sem
// processar entidades dentro dele: o HTML do CDATA é decodificado uma única vez, pelo consumidor).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => name === "item" || name === "category",
});

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : undefined;
}

/** Texto de um nó: string direta, ou `#text` quando o elemento carrega atributos. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const record = asRecord(value);
  if (record !== undefined) return textOf(record["#text"]);
  return "";
}

function toIso(value: string): string | undefined {
  if (value === "") return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Remove o wrapper externo `<div class="">…</div>` do description do feed. */
export function unwrapDescription(raw: string): string {
  const trimmed = raw.trim();
  const match = /^<div\s+class=""\s*>([\s\S]*)<\/div>$/i.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

function categoriesOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map(textOf).filter((c) => c !== "");
}

/**
 * Converte o XML do feed em `FeedItem[]` (ordem do feed). Lança `FeedParseError` para XML
 * inválido, estrutura RSS ausente ou nenhum item aproveitável. Itens sem guid/link/title/data
 * válida são ignorados com `console.warn`; descrição vazia é aceita.
 */
export function parseFeed(xml: string): FeedItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new FeedParseError(`XML inválido: ${validation.err.msg} (linha ${validation.err.line})`);
  }

  let doc: Raw;
  try {
    doc = parser.parse(xml) as Raw;
  } catch (error) {
    throw new FeedParseError(`Falha ao parsear XML: ${String(error)}`, { cause: error });
  }

  const channel = asRecord(asRecord(doc.rss)?.channel);
  if (channel === undefined) throw new FeedParseError("Estrutura RSS inesperada: rss.channel ausente");

  const rawItems = Array.isArray(channel.item) ? (channel.item as unknown[]) : [];
  const items: FeedItem[] = [];
  const takenSlugs = new Set<string>();

  for (const rawItem of rawItems) {
    const entry = asRecord(rawItem);
    if (entry === undefined) continue;

    const title = textOf(entry.title);
    const linkText = textOf(entry.link);
    const guid = textOf(entry.guid);
    if (title === "" || linkText === "" || guid === "") {
      console.warn(`[feed] item ignorado (sem title/link/guid): ${JSON.stringify({ title, link: linkText, guid })}`);
      continue;
    }

    let link: string;
    try {
      const url = new URL(linkText, SITE_ORIGIN);
      if (url.protocol !== "https:" || url.hostname !== "shopify.dev") {
        console.warn(`[feed] item ignorado (link fora de https://shopify.dev): ${linkText}`);
        continue;
      }
      link = url.toString();
    } catch {
      console.warn(`[feed] item ignorado (link inválido): ${linkText}`);
      continue;
    }

    const publishedAt = toIso(textOf(entry["atom:published"])) ?? toIso(textOf(entry.pubDate));
    if (publishedAt === undefined) {
      console.warn(`[feed] item ignorado (sem data válida): ${guid}`);
      continue;
    }
    const updatedAt = toIso(textOf(entry["atom:updated"])) ?? publishedAt;

    const categories = categoriesOf(entry.category);
    const { changeTypes, areas, apiVersions } = classifyCategories(categories);
    const descriptionHtml = unwrapDescription(textOf(entry.description));

    const slug = resolveSlugCollision(slugFromLink(link) || "item", guid, takenSlugs);
    takenSlugs.add(slug);

    items.push({
      guid,
      link,
      slug,
      title,
      publishedAt,
      updatedAt,
      categories,
      changeTypes,
      areas,
      apiVersions,
      descriptionHtml,
      descriptionText: htmlToSearchText(descriptionHtml),
      contentHash: contentHash(title, descriptionHtml, categories),
    });
  }

  if (items.length === 0) throw new FeedParseError("Feed sem nenhum item aproveitável");
  return items;
}
