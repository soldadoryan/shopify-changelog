import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { CHANGE_TYPES } from "@/lib/feed/classify";
import { ITEM_COLUMNS, rowToFeedItem, type ItemRow } from "@/lib/db/mapping";
import type { FeedItem } from "@/lib/types";

/*
 * Cache: `unstable_cache` (next/cache) com tag e revalidate de 1h.
 * Em Next 16 ele não está depreciado nem exige flag; `use cache` exigiria
 * `cacheComponents` no next.config.ts (não habilitado) e as docs recomendam
 * unstable_cache para dados não-fetch que devem sobreviver a deploys.
 * Nota: `revalidateTag` exige 2 argumentos no Next 16 — a rota de
 * sync deve chamar `revalidateChangelog()`.
 */

export const CHANGELOG_CACHE_TAG = "changelog";
export const CHANGELOG_REVALIDATE_SECONDS = 3600;
export const PAGE_SIZE = 30;
export const EXCERPT_LENGTH = 240;
const MAX_QUERY_LENGTH = 200;

/** Para a rota de sync: expira já (sem stale-while-revalidate), pois vem de fora de Server Action. */
export function revalidateChangelog(): void {
  revalidateTag(CHANGELOG_CACHE_TAG, { expire: 0 });
}

export type ListFilters = {
  type?: string;
  area?: string;
  version?: string;
  q?: string;
  page?: number;
};

export type ItemListEntry = Pick<
  FeedItem,
  "guid" | "slug" | "title" | "link" | "publishedAt" | "updatedAt" | "changeTypes" | "areas" | "apiVersions"
> & { excerpt: string };

export type ItemList = {
  items: ItemListEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ItemDetail = FeedItem & { summaryPt: string | null };

export type FacetOption = { value: string; count: number };
export type Facets = {
  changeTypes: FacetOption[];
  areas: FacetOption[];
  apiVersions: FacetOption[];
};

/** Texto de busca seguro para websearch_to_tsquery: sem controles, espaços colapsados, até 200 chars. */
export function sanitizeSearchQuery(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[(),]/g, " ") // delimitadores da sintaxe de filtro do PostgREST
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

const CHANGE_TYPE_SET: ReadonlySet<string> = new Set(CHANGE_TYPES);
const VERSION_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const SLUG_RE = /^[\w.-]{1,200}$/;
const MAX_AREA_LENGTH = 80;
/** Aspas, chaves, vírgula e barra invertida quebram a literal de array do PostgREST (`cs.{...}`). */
const AREA_FORBIDDEN_RE = /["{},\\]/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Filtro `type` válido (um dos CHANGE_TYPES, grafia exata) ou undefined. */
export function cleanTypeParam(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t !== undefined && CHANGE_TYPE_SET.has(t) ? t : undefined;
}

/** Filtro `version` válido (`YYYY-MM` ou `YYYY-MM-DD`) ou undefined. */
export function cleanVersionParam(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t !== undefined && VERSION_RE.test(t) ? t : undefined;
}

/** Filtro `area`: até 80 caracteres, sem aspas, chaves, vírgula e barra invertida, e sem controles; senão undefined (descartado). */
export function cleanAreaParam(v: string | undefined): string | undefined {
  const t = v?.trim();
  if (!t || t.length > MAX_AREA_LENGTH || AREA_FORBIDDEN_RE.test(t) || CONTROL_RE.test(t)) return undefined;
  return t;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_LENGTH) return flat;
  const cut = flat.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > EXCERPT_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const LIST_COLUMNS =
  "guid, slug, title, link, published_at, updated_at, change_types, areas, api_versions, description_text";

type ListRow = Pick<
  ItemRow,
  | "guid" | "slug" | "title" | "link" | "published_at" | "updated_at"
  | "change_types" | "areas" | "api_versions" | "description_text"
>;

async function fetchList(f: ListFilters & { page: number }): Promise<ItemList> {
  const from = (f.page - 1) * PAGE_SIZE;
  let query = createServiceClient()
    .from("changelog_items")
    .select(LIST_COLUMNS, { count: "exact" });
  if (f.type) query = query.contains("change_types", [f.type]);
  if (f.area) query = query.contains("areas", [f.area]);
  if (f.version) query = query.contains("api_versions", [f.version]);
  if (f.q) query = query.textSearch("search", f.q, { type: "websearch", config: "simple" });
  const { data, count, error } = await query
    .order("published_at", { ascending: false })
    .order("guid", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`Supabase list items: ${error.message}`);
  const total = count ?? 0;
  return {
    items: (data as ListRow[]).map((r) => ({
      guid: r.guid,
      slug: r.slug,
      title: r.title,
      link: r.link,
      publishedAt: new Date(r.published_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      changeTypes: r.change_types ?? [],
      areas: r.areas ?? [],
      apiVersions: r.api_versions ?? [],
      excerpt: excerpt(r.description_text),
    })),
    total,
    page: f.page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
  };
}

const cachedList = unstable_cache(fetchList, ["changelog-list"], {
  tags: [CHANGELOG_CACHE_TAG],
  revalidate: CHANGELOG_REVALIDATE_SECONDS,
});

/** Lista paginada (30/pág.) com filtros e busca full-text. A entrada é normalizada antes de formar a chave de cache. */
export function listItems(filters: ListFilters = {}): Promise<ItemList> {
  const raw = filters.page;
  const page = typeof raw === "number" && Number.isFinite(raw) ? Math.max(Math.floor(raw), 1) : 1;
  return cachedList({
    page: Math.min(page, 10_000),
    type: cleanTypeParam(filters.type),
    area: cleanAreaParam(filters.area),
    version: cleanVersionParam(filters.version),
    q: sanitizeSearchQuery(filters.q),
  });
}

async function fetchBySlug(slug: string): Promise<ItemDetail | null> {
  const { data, error } = await createServiceClient()
    .from("changelog_items")
    .select(ITEM_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Supabase get item: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ItemRow;
  return { ...rowToFeedItem(row), summaryPt: row.summary_pt };
}

const cachedBySlug = unstable_cache(fetchBySlug, ["changelog-item"], {
  tags: [CHANGELOG_CACHE_TAG],
  revalidate: CHANGELOG_REVALIDATE_SECONDS,
});

/** Item pelo slug, ou null (a página chama notFound()). */
export function getItemBySlug(slug: string): Promise<ItemDetail | null> {
  if (!SLUG_RE.test(slug)) return Promise.resolve(null);
  return cachedBySlug(slug);
}

async function fetchFacets(): Promise<Facets> {
  const { data, error } = await createServiceClient().rpc("changelog_facets");
  if (error) throw new Error(`Supabase changelog_facets: ${error.message}`);
  const facets: Facets = { changeTypes: [], areas: [], apiVersions: [] };
  for (const r of (data ?? []) as { kind: string; value: string; n: number | string }[]) {
    const opt = { value: r.value, count: Number(r.n) };
    if (r.kind === "change_type") facets.changeTypes.push(opt);
    else if (r.kind === "area") facets.areas.push(opt);
    else if (r.kind === "api_version") facets.apiVersions.push(opt);
  }
  facets.apiVersions.sort((a, b) => b.value.localeCompare(a.value));
  return facets;
}

export const getFacets: () => Promise<Facets> = unstable_cache(fetchFacets, ["changelog-facets"], {
  tags: [CHANGELOG_CACHE_TAG],
  revalidate: CHANGELOG_REVALIDATE_SECONDS,
});
