import type { Metadata } from "next";
import Link from "next/link";
import { changeTypeLabel } from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import FilterBar, { type FilterValues } from "@/components/FilterBar";
import Icon from "@/components/Icon";
import ItemCard from "@/components/ItemCard";
import JsonLd from "@/components/JsonLd";
import Pagination from "@/components/Pagination";
import TypeTabs from "@/components/TypeTabs";
import { monthOf, sameUtcDay } from "@/components/format";
import { listHref } from "@/components/href";
import {
  cleanAreaParam,
  cleanTypeParam,
  cleanVersionParam,
  getFacets,
  listItems,
  type ItemList,
  type ItemListEntry,
} from "@/lib/db/queries";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim().slice(0, 200);
  return t ? t : undefined;
}

function parsePage(v: string | string[] | undefined): number {
  const s = first(v);
  if (!s || !/^\d{1,5}$/.test(s)) return 1;
  return Math.max(parseInt(s, 10), 1);
}

function readFilters(sp: SearchParams): FilterValues {
  return { q: first(sp.q), type: first(sp.type), area: first(sp.area), version: first(sp.version) };
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const sp = await searchParams;
  const raw = readFilters(sp);
  const type = cleanTypeParam(raw.type);
  const area = cleanAreaParam(raw.area);
  const version = cleanVersionParam(raw.version);
  const page = parsePage(sp.page);

  const parts = [
    type ? changeTypeLabel(type) : null,
    area ?? null,
    version ? `API ${version}` : null,
    page > 1 ? `página ${page}` : null,
  ].filter((p): p is string => p !== null);

  return {
    title: { absolute: parts.length ? `${parts.join(" · ")} | ${SITE_NAME}` : `${SITE_NAME} (não oficial)` },
    alternates: { canonical: listHref({ type, area, version, page }) },
    ...(raw.q ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = readFilters(sp);
  const page = parsePage(sp.page);

  const [list, facets] = await Promise.all([listItems({ ...filters, page }), getFacets()]);
  const unfiltered = !filters.q && !filters.type && !filters.area && !filters.version;

  return (
    <div className="container home">
      <header className="intro">
        <h1 className="intro__title">Changelog para desenvolvedores Shopify</h1>
        <p className="intro__lede">
          O que mudou nas APIs, apps e temas da Shopify, com ações necessárias e breaking changes em destaque.
          Filtre por área e versão da API.
        </p>
      </header>

      <div className="home__filters">
        <FilterBar
          facets={{
            areas: facets.areas.map((f) => ({ value: f.value, n: f.count })),
            versions: facets.apiVersions.map((f) => ({ value: f.value, n: f.count })),
          }}
          values={filters}
        />
      </div>

      <section className="home__results" aria-labelledby="resultados">
        <TypeTabs
          types={facets.changeTypes.map((f) => ({ value: f.value, n: f.count }))}
          values={filters}
          allCount={unfiltered ? list.total : undefined}
        />
        <div className="results-bar">
          <p className="results-count tabular" id="resultados">
            {list.total === 0 ? "Nenhum resultado" : `${list.total} ${list.total === 1 ? "resultado" : "resultados"}`}
          </p>
          <ActiveFilters filters={filters} />
        </div>
        <Results list={list} filtered={!unfiltered} />
        <Pagination
          page={list.page}
          totalPages={list.totalPages}
          params={{ q: filters.q, type: filters.type, area: filters.area, version: filters.version }}
        />
      </section>

      <JsonLd data={listJsonLd(list.items)} />
    </div>
  );
}

function ActiveFilters({ filters }: { filters: FilterValues }) {
  const chips: { key: string; label: React.ReactNode; mono?: boolean; href: string }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, href: listHref({ ...filters, q: undefined }) });
  if (filters.area) chips.push({ key: "area", label: filters.area, href: listHref({ ...filters, area: undefined }) });
  if (filters.version)
    chips.push({
      key: "version",
      label: `API ${filters.version}`,
      mono: true,
      href: listHref({ ...filters, version: undefined }),
    });
  if (chips.length === 0) return null;
  return (
    <ul className="chips" aria-label="Filtros ativos">
      {chips.map((c) => (
        <li key={c.key}>
          <Link className={c.mono ? "chip chip--mono" : "chip"} href={c.href}>
            {c.label}
            <Icon name="close" />
            <span className="visually-hidden">(remover filtro)</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function groupByMonth(items: ItemListEntry[]) {
  const groups: { key: string; label: string; items: ItemListEntry[] }[] = [];
  for (const item of items) {
    const { key, label } = monthOf(item.publishedAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

function Results({ list, filtered }: { list: ItemList; filtered: boolean }) {
  if (list.items.length === 0) {
    const beyondEnd = list.total > 0;
    return (
      <EmptyState
        headingLevel={2}
        icon={filtered || beyondEnd ? "search" : "inbox"}
        title={beyondEnd ? "Esta página não existe" : filtered ? "Nada encontrado" : "Changelog vazio"}
        description={
          beyondEnd
            ? "Os filtros atuais têm menos páginas do que o endereço pede."
            : filtered
              ? "Nenhum item corresponde a esses filtros. Remova algum filtro ou tente outra busca."
              : "Ainda não há itens sincronizados do shopify.dev."
        }
        action={filtered || beyondEnd ? { href: "/", label: "Ver todo o changelog" } : undefined}
      />
    );
  }

  return (
    <div>
      {groupByMonth(list.items).map((group) => (
        <section className="month" key={group.key} aria-labelledby={`mes-${group.key}`}>
          <h2 className="month__heading" id={`mes-${group.key}`}>
            {group.label}
          </h2>
          <ul className="feed">
            {group.items.map((item, i) => (
              <ItemCard
                key={item.guid}
                item={item}
                repeatDate={i > 0 && sameUtcDay(group.items[i - 1].publishedAt, item.publishedAt)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function listJsonLd(items: ItemListEntry[]): Record<string, unknown> {
  const home = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: SITE_NAME,
        inLanguage: "pt-BR",
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${home}?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "ItemList",
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: items.length,
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: absoluteUrl(`/changelog/${item.slug}`),
          name: item.title,
        })),
      },
    ],
  };
}
