import { resolveSlugCollision, slugFromLink } from "@/lib/feed/classify";
import type { FeedItem } from "@/lib/types";

// Diff puro entre o que já está no banco e o feed recém-parseado.
// Sem I/O: recebe os itens conhecidos (guid/slug/hash) e devolve o que inserir/atualizar.

/** Mesmo formato de `KnownItem` em lib/db/items.ts (redeclarado para manter este módulo puro). */
export type KnownItemRef = { guid: string; slug: string; contentHash: string };

export type FeedDiff = {
  /** guids nunca vistos, com slug já livre de colisão contra o banco e entre si. */
  toInsert: FeedItem[];
  /** guids conhecidos cujo content_hash mudou (edição). Mantêm o slug gravado no banco. */
  toUpdate: FeedItem[];
  /** guids conhecidos com o mesmo hash. */
  unchanged: number;
  /** Entradas repetidas do mesmo guid no feed (mantida a primeira). */
  duplicates: number;
};

/**
 * Escolhe um slug livre para `item`. `slugOwners` mapeia slug -> guid dono (banco + já
 * atribuídos neste diff). O slug do parse é usado se estiver livre; senão aplica
 * `resolveSlugCollision` sobre o slug base do link e, no caso (improvável) de o sufixo
 * também estar ocupado, acrescenta um contador.
 */
function pickSlug(item: FeedItem, slugOwners: ReadonlyMap<string, string>): string {
  const isFree = (slug: string) => {
    const owner = slugOwners.get(slug);
    return owner === undefined || owner === item.guid;
  };
  if (item.slug !== "" && isFree(item.slug)) return item.slug;

  const base = slugFromLink(item.link) || item.slug || "item";
  const taken = new Set<string>();
  for (const [slug, owner] of slugOwners) if (owner !== item.guid) taken.add(slug);
  const candidate = resolveSlugCollision(base, item.guid, taken);
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/**
 * - guid novo -> `toInsert` (slug resolvido contra slugs do banco de OUTROS guids, já que
 *   `slug` é unique na tabela e o parse só resolve colisões dentro do próprio feed);
 * - guid conhecido com hash diferente -> `toUpdate` com o slug do banco (URL estável e sem
 *   risco de violar o unique ao reordenar colisões);
 * - guid conhecido com o mesmo hash -> ignorado.
 * Itens ausentes do feed nunca geram remoção.
 */
export function diffFeed(known: readonly KnownItemRef[], parsed: readonly FeedItem[]): FeedDiff {
  const byGuid = new Map<string, KnownItemRef>();
  const slugOwners = new Map<string, string>();
  for (const k of known) {
    byGuid.set(k.guid, k);
    slugOwners.set(k.slug, k.guid);
  }

  const seen = new Set<string>();
  const fresh: FeedItem[] = [];
  const toUpdate: FeedItem[] = [];
  let unchanged = 0;
  let duplicates = 0;

  for (const item of parsed) {
    if (seen.has(item.guid)) {
      duplicates += 1;
      continue;
    }
    seen.add(item.guid);

    const existing = byGuid.get(item.guid);
    if (existing === undefined) {
      fresh.push(item);
    } else if (existing.contentHash !== item.contentHash) {
      toUpdate.push(existing.slug === item.slug ? item : { ...item, slug: existing.slug });
    } else {
      unchanged += 1;
    }
  }

  const toInsert: FeedItem[] = [];
  for (const item of fresh) {
    const slug = pickSlug(item, slugOwners);
    slugOwners.set(slug, item.guid);
    toInsert.push(slug === item.slug ? item : { ...item, slug });
  }

  return { toInsert, toUpdate, unchanged, duplicates };
}
