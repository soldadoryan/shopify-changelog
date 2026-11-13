import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { FeedFetchError, FeedParseError } from "@/lib/feed/errors";
import { fetchFeed } from "@/lib/feed/fetch";
import { parseFeed } from "@/lib/feed/parse";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureXml = readFileSync(join(here, "fixtures", "feed.xml"), "utf8");
const FULL_FEED_PATH =
  "C:\\Users\\PC\\AppData\\Local\\Temp\\claude\\f9edc60c3d6856b4\\c4493d3c-65fe-4520-87ad-2e98dac19072\\scratchpad\\feed\\feed.xml";

const items = parseFeed(fixtureXml);
const bySlug = (slug: string) => {
  const item = items.find((i) => i.slug === slug);
  if (!item) throw new Error(`fixture sem o slug ${slug}`);
  return item;
};

function rss(inner: string): string {
  return `<?xml version="1.0"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel><title>t</title>${inner}</channel></rss>`;
}

describe("parseFeed (fixture)", () => {
  it("lê todos os itens, na ordem do feed, com guids únicos", () => {
    expect(items).toHaveLength(9);
    expect(items[0].title).toBe("Full-stack capabilities to power app analytics");
    expect(new Set(items.map((i) => i.guid)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.slug)).size).toBe(items.length);
  });

  it("preenche os campos básicos e usa guid == link", () => {
    const item = bySlug("full-stack-capabilities-to-power-app-analytics");
    expect(item.link).toBe("https://shopify.dev/changelog/full-stack-capabilities-to-power-app-analytics");
    expect(item.guid).toBe(item.link);
    expect(item.categories).toEqual([
      "API",
      "New",
      "GraphQL Admin API",
      "App Events API",
      "Metafields and metaobjects",
      "ShopifyQL",
      "2026-10",
    ]);
    expect(item.changeTypes).toEqual(["New"]);
    expect(item.areas).toEqual(["API", "GraphQL Admin API", "App Events API", "Metafields and metaobjects", "ShopifyQL"]);
    expect(item.apiVersions).toEqual(["2026-10"]);
    expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("datas viram ISO e atom:updated pode ser posterior ao publicado", () => {
    const item = bySlug("full-stack-capabilities-to-power-app-analytics");
    expect(item.publishedAt).toBe("2026-07-21T13:00:00.000Z");
    expect(item.updatedAt).toBe("2026-08-25T19:37:58.000Z");
    for (const i of items) {
      expect(new Date(i.publishedAt).toISOString()).toBe(i.publishedAt);
      expect(new Date(i.updatedAt).toISOString()).toBe(i.updatedAt);
    }
  });

  it("mantém versões como string, inclusive YYYY-MM-DD", () => {
    expect(bySlug("full-stack-capabilities-to-power-app-analytics").apiVersions).toEqual(["2026-10"]);
    const dated = items.find((i) => i.apiVersions.includes("2026-08-25"));
    expect(dated?.apiVersions).toEqual(["2026-08-25"]);
    expect(dated?.changeTypes).toEqual(["New"]);
    expect(dated?.areas).toEqual(["UCP"]);
    for (const i of items) for (const v of i.apiVersions) expect(typeof v).toBe("string");
  });

  it("aceita item sem categorias e com descrição vazia", () => {
    const item = bySlug("editions-fall-2026");
    expect(item.categories).toEqual([]);
    expect(item.changeTypes).toEqual([]);
    expect(item.areas).toEqual([]);
    expect(item.apiVersions).toEqual([]);
    expect(item.descriptionHtml).toBe("");
    expect(item.descriptionText).toBe("");
    expect(item.updatedAt > item.publishedAt).toBe(true);
  });

  it("categoria única não vira array no XML e é lida normalmente", () => {
    const item = bySlug("single-category-item");
    expect(item.categories).toEqual(["Platform"]);
    expect(item.changeTypes).toEqual(["Platform"]);
  });

  it("remove o wrapper <div class=\"\"> externo da descrição", () => {
    for (const i of items) {
      expect(i.descriptionHtml.startsWith('<div class="">')).toBe(false);
      expect(i.descriptionHtml).toBe(i.descriptionHtml.trim());
    }
    const item = bySlug("single-category-item");
    expect(item.descriptionHtml).toBe("<p>Only one category here.</p>");
    expect(item.descriptionText).toBe("Only one category here.");
  });

  it("não decodifica o CDATA duas vezes: entidades de código seguem como entidades no HTML", () => {
    const item = items.find((i) => /&lt;\w+/.test(i.descriptionHtml));
    expect(item).toBeDefined();
    expect(item!.descriptionHtml).toMatch(/&lt;/);
    expect(item!.descriptionText).toMatch(/<\w/);
    expect(item!.descriptionText).not.toMatch(/&lt;|&gt;|&quot;/);
  });

  it("preserva blocos de código com classe de linguagem e iframes no HTML bruto", () => {
    expect(items.some((i) => /<pre><code class="language-/.test(i.descriptionHtml))).toBe(true);
    expect(items.some((i) => /<iframe\b/.test(i.descriptionHtml))).toBe(true);
    const iframeItem = items.find((i) => /<iframe\b/.test(i.descriptionHtml))!;
    expect(iframeItem.descriptionText).not.toMatch(/<iframe/);
  });

  it("resolve link relativo contra shopify.dev", () => {
    const item = bySlug("relative-link-item");
    expect(item.link).toBe("https://shopify.dev/changelog/relative-link-item");
    expect(item.publishedAt).toBe("2026-05-31T10:00:00.000Z");
    expect(item.updatedAt).toBe(item.publishedAt);
    expect(item.descriptionHtml).toContain('href="/docs/api/admin-graphql"');
  });

  it("contentHash é estável e muda com título, descrição ou categorias", () => {
    const again = parseFeed(fixtureXml);
    expect(again.map((i) => i.contentHash)).toEqual(items.map((i) => i.contentHash));
    const base = rss(
      `<item><title>A</title><description><![CDATA[<div class=""><p>x</p></div>]]></description><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><category>New</category><link>https://shopify.dev/changelog/a</link><guid isPermaLink="true">https://shopify.dev/changelog/a</guid></item>`,
    );
    const hash = (xml: string) => parseFeed(xml)[0].contentHash;
    expect(hash(base.replace("<title>A</title>", "<title>B</title>"))).not.toBe(hash(base));
    expect(hash(base.replace("<p>x</p>", "<p>y</p>"))).not.toBe(hash(base));
    expect(hash(base.replace("<category>New</category>", "<category>Update</category>"))).not.toBe(hash(base));
    expect(hash(base.replace("</pubDate>", "</pubDate><atom:updated>2026-07-01T00:00:00.000Z</atom:updated>"))).toBe(hash(base));
  });
});

describe("parseFeed (robustez)", () => {
  const goodItem = `<item><title>Ok</title><description>d</description><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><link>https://shopify.dev/changelog/ok</link><guid isPermaLink="true">https://shopify.dev/changelog/ok</guid></item>`;

  it("ignora itens sem title, link ou guid (com log)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const xml = rss(
      `${goodItem}<item><description>x</description><link>https://shopify.dev/changelog/n</link><guid>https://shopify.dev/changelog/n</guid></item><item><title>No guid</title><link>https://shopify.dev/changelog/g</link><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate></item>`,
    );
    const parsed = parseFeed(xml);
    expect(parsed.map((i) => i.title)).toEqual(["Ok"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("ignora itens cujo link não é https://shopify.dev (com log)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mk = (link: string) =>
      `<item><title>T ${link.length}</title><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><link>${link}</link><guid>${link}</guid></item>`;
    const xml = rss(
      goodItem +
        mk("http://shopify.dev/changelog/http") +
        mk("https://evil.example/changelog/x") +
        mk("https://shopify.dev.evil.example/changelog/y") +
        mk("javascript:alert(1)") +
        mk("https://www.shopify.dev/changelog/www"),
    );
    expect(parseFeed(xml).map((i) => i.title)).toEqual(["Ok"]);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("descrição ausente ou vazia é aceita", () => {
    const xml = rss(
      `<item><title>No desc</title><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><link>https://shopify.dev/changelog/nd</link><guid>https://shopify.dev/changelog/nd</guid></item>`,
    );
    expect(parseFeed(xml)[0].descriptionHtml).toBe("");
  });

  it("slugs repetidos recebem sufixo hash6 estável", () => {
    const mk = (guid: string, link: string) =>
      `<item><title>T</title><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><link>${link}</link><guid>${guid}</guid></item>`;
    const xml = rss(
      mk("https://shopify.dev/changelog/dup", "https://shopify.dev/changelog/dup") +
        mk("https://shopify.dev/other/dup", "https://shopify.dev/other/dup"),
    );
    const [a, b] = parseFeed(xml);
    expect(a.slug).toBe("dup");
    expect(b.slug).toMatch(/^dup-[0-9a-f]{6}$/);
    expect(parseFeed(xml)[1].slug).toBe(b.slug);
  });

  it("lança FeedParseError para XML inválido, RSS sem channel e feed sem itens", () => {
    expect(() => parseFeed("<rss><channel><item></rss>")).toThrow(FeedParseError);
    expect(() => parseFeed("não é xml")).toThrow(FeedParseError);
    expect(() => parseFeed("<html><body/></html>")).toThrow(FeedParseError);
    expect(() => parseFeed(rss(""))).toThrow(FeedParseError);
  });

  it("entidades XML fora do CDATA são decodificadas uma vez no título", () => {
    const xml = rss(
      `<item><title>Tom &amp; Jerry &lt;3</title><pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate><link>https://shopify.dev/changelog/tj</link><guid>https://shopify.dev/changelog/tj</guid></item>`,
    );
    expect(parseFeed(xml)[0].title).toBe("Tom & Jerry <3");
  });
});

describe("fetchFeed", () => {
  it("usa cache no-store, User-Agent e timeout, e devolve o corpo", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<rss/>", { status: 200 }));
    await expect(fetchFeed("https://example.test/feed.xml")).resolves.toBe("<rss/>");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://example.test/feed.xml");
    expect(init?.cache).toBe("no-store");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("shopify-changelog-notifier");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });

  it("mapeia falhas para FeedFetchError", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await expect(fetchFeed("https://example.test/f")).rejects.toMatchObject({ kind: "http", status: 503 });

    spy.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(fetchFeed("https://example.test/f")).rejects.toMatchObject({ kind: "timeout" });

    spy.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(fetchFeed("https://example.test/f")).rejects.toBeInstanceOf(FeedFetchError);

    spy.mockResolvedValueOnce(new Response("  ", { status: 200 }));
    await expect(fetchFeed("https://example.test/f")).rejects.toMatchObject({ kind: "empty" });
    spy.mockRestore();
  });
});

describe("parseFeed (feed real completo)", () => {
  it.skipIf(!existsSync(FULL_FEED_PATH))("parseia o feed inteiro com guids únicos", () => {
    const parsed = parseFeed(readFileSync(FULL_FEED_PATH, "utf8"));
    expect(parsed.length).toBeGreaterThan(0);
    expect(new Set(parsed.map((i) => i.guid)).size).toBe(parsed.length);
    expect(new Set(parsed.map((i) => i.slug)).size).toBe(parsed.length);
    for (const i of parsed) {
      expect(i.title).not.toBe("");
      expect(i.descriptionHtml.startsWith('<div class="">')).toBe(false);
      for (const v of i.apiVersions) expect(v).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    }
  });
});
