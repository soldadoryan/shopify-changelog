import { createHash } from "node:crypto";

export const CHANGE_TYPES = [
  "Action Required",
  "Breaking API Change",
  "Deprecation announcement",
  "New",
  "Update",
  "Platform",
] as const;

const CHANGE_TYPE_BY_LOWER = new Map<string, string>(CHANGE_TYPES.map((t) => [t.toLowerCase(), t]));
const API_VERSION_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const SITE_ORIGIN = "https://shopify.dev";

export type Classified = { changeTypes: string[]; areas: string[]; apiVersions: string[] };

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/**
 * Separa as categorias brutas em tipo de mudança (match exato, case-insensitive, devolvido na
 * grafia canônica), versão de API (`YYYY-MM` ou `YYYY-MM-DD`) e área (todo o resto — categorias
 * desconhecidas nunca são descartadas). Mantém a ordem do feed e remove duplicatas.
 */
export function classifyCategories(categories: readonly string[]): Classified {
  const changeTypes: string[] = [];
  const areas: string[] = [];
  const apiVersions: string[] = [];
  for (const raw of categories) {
    const category = raw.trim();
    if (category === "") continue;
    const changeType = CHANGE_TYPE_BY_LOWER.get(category.toLowerCase());
    if (changeType !== undefined) pushUnique(changeTypes, changeType);
    else if (API_VERSION_RE.test(category)) pushUnique(apiVersions, category);
    else pushUnique(areas, category);
  }
  return { changeTypes, areas, apiVersions };
}

/** Último segmento não vazio de `new URL(link).pathname` (links relativos resolvem em shopify.dev). */
export function slugFromLink(link: string): string {
  let pathname: string;
  try {
    pathname = new URL(link, SITE_ORIGIN).pathname;
  } catch {
    pathname = link;
  }
  const segments = pathname.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  // Slug seguro para URL/DB: só [A-Za-z0-9_.-].
  return decoded.replace(/[^\w.-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

/** sha256 hex de `title|description_html|categories` (categorias unidas por vírgula, ordem do feed). */
export function contentHash(title: string, descriptionHtml: string, categories: readonly string[]): string {
  return createHash("sha256").update(`${title}|${descriptionHtml}|${categories.join(",")}`).digest("hex");
}

/** Sufixo estável de 6 hex derivado do guid (não muda quando o conteúdo é editado). */
export function slugSuffix(guid: string): string {
  return createHash("sha256").update(guid).digest("hex").slice(0, 6);
}

/** Devolve `slug` se livre em `taken`, senão `${slug}-${hash6(guid)}`. Não altera `taken`. */
export function resolveSlugCollision(slug: string, guid: string, taken: ReadonlySet<string>): string {
  return taken.has(slug) ? `${slug}-${slugSuffix(guid)}` : slug;
}
