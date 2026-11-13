import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeTypeBadges, changeTypeLabel, isCriticalType, sortChangeTypes } from "@/components/Badge";
import Icon from "@/components/Icon";
import ItemBody from "@/components/ItemBody";
import JsonLd from "@/components/JsonLd";
import { formatLongDate } from "@/components/format";
import { listHref } from "@/components/href";
import { getItemBySlug, type ItemDetail } from "@/lib/db/queries";
import { sanitizeForWeb } from "@/lib/html/sanitize";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

type Params = Promise<{ slug: string }>;

function describe(text: string): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= 155) return flat;
  const cut = flat.slice(0, 154);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (!item) return { title: "Item não encontrado", robots: { index: false } };
  const description = describe(item.descriptionText);
  const path = `/changelog/${item.slug}`;
  return {
    title: item.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      url: path,
      title: item.title,
      description,
      siteName: SITE_NAME,
      locale: "pt_BR",
      publishedTime: item.publishedAt,
      modifiedTime: item.updatedAt,
      tags: [...item.changeTypes, ...item.areas],
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SITE_NAME }],
    },
    twitter: { card: "summary_large_image", title: item.title, description, images: ["/opengraph-image"] },
  };
}

export default async function ChangelogItemPage({ params }: { params: Params }) {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (item === null) notFound();

  const updated = item.updatedAt.slice(0, 10) !== item.publishedAt.slice(0, 10);
  const criticalTypes = sortChangeTypes(item.changeTypes.filter(isCriticalType), (t) => t);
  const summary = item.summaryPt
    ?.split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean);

  return (
    <div className="container">
      <nav className="crumbs" aria-label="Trilha de navegação">
        <ol>
          <li>
            <Link href="/">Changelog</Link>
          </li>
          <li aria-current="page">{item.title}</li>
        </ol>
      </nav>

      <article>
        <header className="article-head">
          <ChangeTypeBadges types={item.changeTypes} />
          <h1 className="article-head__title">{item.title}</h1>
          <p className="article-head__meta">
            Publicado em <time dateTime={item.publishedAt}>{formatLongDate(item.publishedAt)}</time>
            {updated ? (
              <>
                {" · "}atualizado em <time dateTime={item.updatedAt}>{formatLongDate(item.updatedAt)}</time>
              </>
            ) : null}
          </p>
          <div className="article-head__actions">
            <a className="button button--primary" href={item.link} target="_blank" rel="noopener noreferrer">
              Abrir no shopify.dev
              <Icon name="external" />
              <span className="visually-hidden"> (abre em nova aba)</span>
            </a>
          </div>
        </header>

        <div className="article">
          <div className="panel article__main">
            {criticalTypes.length ? (
              <div className="banner banner--critical">
                <Icon name="alert" />
                <div className="banner__body">
                  <p>
                    <strong>
                      A Shopify classificou esta mudança como {criticalTypes.map(changeTypeLabel).join(" e ")}.
                    </strong>{" "}
                    Leia prazos e passos de migração no texto abaixo antes de atualizar seu app ou tema.
                  </p>
                </div>
              </div>
            ) : null}

            {summary?.length ? (
              <aside className="banner summary" aria-labelledby="resumo-ia">
                <Icon name="translate" />
                <div className="banner__body">
                  <h2 className="banner__title" id="resumo-ia">
                    Resumo em português
                  </h2>
                  {summary.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                  <p className="banner__note">Gerado por IA a partir do texto original; pode conter imprecisões.</p>
                </div>
              </aside>
            ) : null}

            <ItemBody html={sanitizeForWeb(item.descriptionHtml, item.link)} />

            <p className="article__source">
              Texto original em inglês, publicado pela Shopify.
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                Ler no shopify.dev
                <span className="visually-hidden"> (abre em nova aba)</span>
              </a>
            </p>
          </div>

          <Facts item={item} />
        </div>
      </article>

      <JsonLd data={articleJsonLd(item)} />
    </div>
  );
}

function Facts({ item }: { item: ItemDetail }) {
  return (
    <aside className="panel facts article__facts" aria-labelledby="detalhes">
      <h2 className="facts__title" id="detalhes">
        Detalhes
      </h2>
      <dl>
        {item.changeTypes.length ? (
          <div>
            <dt>Tipo</dt>
            <dd>
              <ul className="facts__links">
                {sortChangeTypes(item.changeTypes, (t) => t).map((t) => (
                  <li key={t}>
                    <Link href={listHref({ type: t })}>{changeTypeLabel(t)}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {item.areas.length ? (
          <div>
            <dt>Áreas</dt>
            <dd>
              <ul className="facts__links">
                {item.areas.map((a) => (
                  <li key={a}>
                    <Link href={listHref({ area: a })}>{a}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {item.apiVersions.length ? (
          <div>
            <dt>Versão da API</dt>
            <dd>
              <ul className="facts__links">
                {item.apiVersions.map((v) => (
                  <li key={v}>
                    <Link className="mono" href={listHref({ version: v })}>
                      {v}
                    </Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Publicado</dt>
          <dd>
            <time dateTime={item.publishedAt}>{formatLongDate(item.publishedAt)}</time>
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function articleJsonLd(item: ItemDetail): Record<string, unknown> {
  const url = absoluteUrl(`/changelog/${item.slug}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: item.title.slice(0, 110),
        description: describe(item.descriptionText),
        url,
        mainEntityOfPage: url,
        datePublished: item.publishedAt,
        dateModified: item.updatedAt,
        inLanguage: "en",
        isBasedOn: item.link,
        keywords: [...item.changeTypes, ...item.areas, ...item.apiVersions].join(", ") || undefined,
        isPartOf: { "@type": "WebSite", "@id": `${absoluteUrl("/")}#website`, name: SITE_NAME },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Changelog", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: item.title, item: url },
        ],
      },
    ],
  };
}
