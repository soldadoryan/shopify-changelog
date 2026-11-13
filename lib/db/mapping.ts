import type { FeedItem, NotifyStatus, StoredItem } from "@/lib/types";

// Único lugar com o mapeamento snake_case <-> camelCase (tabela changelog_items).

export type ItemRow = {
  guid: string;
  slug: string;
  title: string;
  link: string;
  published_at: string;
  updated_at: string;
  categories: string[];
  change_types: string[];
  areas: string[];
  api_versions: string[];
  description_html: string;
  description_text: string;
  content_hash: string;
  summary_pt: string | null;
  summary_model: string | null;
  notify_status: NotifyStatus;
  notify_attempts: number;
  notify_claimed_at: string | null;
  notified_at: string | null;
  discord_message_id: string | null;
  last_error: string | null;
  first_seen_at: string;
};

/** Colunas lidas de changelog_items (tudo menos `search`, o tsvector gerado). Mantém em sincronia com ItemRow. */
export const ITEM_COLUMNS =
  "guid, slug, title, link, published_at, updated_at, categories, change_types, areas, api_versions, " +
  "description_html, description_text, content_hash, summary_pt, summary_model, notify_status, notify_attempts, " +
  "notify_claimed_at, notified_at, discord_message_id, last_error, first_seen_at";

/** Colunas graváveis a partir de um FeedItem (sem campos de notificação). */
export type FeedItemRow = Pick<
  ItemRow,
  | "guid" | "slug" | "title" | "link" | "published_at" | "updated_at"
  | "categories" | "change_types" | "areas" | "api_versions"
  | "description_html" | "description_text" | "content_hash"
>;

/** Normaliza timestamptz do Postgres ("2025-01-01T00:00:00+00:00") para ISO UTC. */
export function toIso(value: string): string {
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? value : t.toISOString();
}

export function feedItemToRow(item: FeedItem): FeedItemRow {
  return {
    guid: item.guid,
    slug: item.slug,
    title: item.title,
    link: item.link,
    published_at: item.publishedAt,
    updated_at: item.updatedAt,
    categories: item.categories,
    change_types: item.changeTypes,
    areas: item.areas,
    api_versions: item.apiVersions,
    description_html: item.descriptionHtml,
    description_text: item.descriptionText,
    content_hash: item.contentHash,
  };
}

export function rowToFeedItem(row: ItemRow): FeedItem {
  return {
    guid: row.guid,
    link: row.link,
    slug: row.slug,
    title: row.title,
    publishedAt: toIso(row.published_at),
    updatedAt: toIso(row.updated_at),
    categories: row.categories ?? [],
    changeTypes: row.change_types ?? [],
    areas: row.areas ?? [],
    apiVersions: row.api_versions ?? [],
    descriptionHtml: row.description_html,
    descriptionText: row.description_text,
    contentHash: row.content_hash,
  };
}

export function rowToStoredItem(row: ItemRow): StoredItem {
  return {
    ...rowToFeedItem(row),
    summaryPt: row.summary_pt,
    notifyStatus: row.notify_status,
    notifyAttempts: row.notify_attempts,
    notifiedAt: row.notified_at ? toIso(row.notified_at) : null,
  };
}
