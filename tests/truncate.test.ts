import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlToDiscordMarkdown } from "../lib/html/to-discord";
import { truncateMarkdown } from "../lib/text/truncate";

const URL_MORE = "https://shopify.dev/changelog/x";
const SUFFIX = `\n\n… [Ler mais](${URL_MORE})`;

const fenceCount = (s: string) => s.split("\n").filter((l) => /^[ \t>]*```/.test(l)).length;

describe("truncateMarkdown", () => {
  it("returns short text untouched", () => {
    expect(truncateMarkdown("curto", 100, URL_MORE)).toBe("curto");
  });

  it("respects the limit including the suffix and appends Ler mais", () => {
    const md = Array.from({ length: 200 }, (_, i) => `Parágrafo ${i} com algum texto.`).join("\n\n");
    const out = truncateMarkdown(md, 500, URL_MORE);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith(SUFFIX)).toBe(true);
  });

  it("prefers a paragraph boundary", () => {
    const md = "a".repeat(40) + "\n\n" + "b".repeat(40) + "\n\n" + "c".repeat(200);
    const out = truncateMarkdown(md, 150, URL_MORE);
    expect(out).toBe("a".repeat(40) + "\n\n" + "b".repeat(40) + SUFFIX);
  });

  it("never cuts inside a markdown link", () => {
    const link = "[texto do link](https://shopify.dev/docs/muito/longo/caminho/aqui)";
    const head = "x".repeat(60) + " ";
    const md = head + link + " " + "y".repeat(300);
    const limit = head.length + 20 + SUFFIX.length;
    const out = truncateMarkdown(md, limit, URL_MORE);
    const body = out.slice(0, out.length - SUFFIX.length);
    expect(body).not.toContain("[texto");
    expect(out.length).toBeLessThanOrEqual(limit);
  });

  it("cuts before a code fence when that keeps most of the budget", () => {
    const md = "t".repeat(300) + "\n\n```js\n" + "code();\n".repeat(100) + "```\n\nfim";
    const out = truncateMarkdown(md, 400, URL_MORE);
    expect(fenceCount(out)).toBe(0);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  it("closes an open code fence when cutting inside it", () => {
    const md = "Intro\n\n```graphql\n" + "query { shop { name } }\n".repeat(100) + "```\n";
    const out = truncateMarkdown(md, 400, URL_MORE);
    expect(fenceCount(out) % 2).toBe(0);
    expect(out).toContain("```graphql");
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith(SUFFIX)).toBe(true);
  });

  it("never splits a surrogate pair", () => {
    const md = "😀".repeat(500);
    for (let max = 60; max < 90; max++) {
      const out = truncateMarkdown(md, max, URL_MORE);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out).toBe(out.toWellFormed());
    }
  });

  it("handles a text with no whitespace at all", () => {
    const out = truncateMarkdown("z".repeat(5000), 300, URL_MORE);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith(SUFFIX)).toBe(true);
  });

  it("encodes parentheses in the more-url", () => {
    const out = truncateMarkdown("a ".repeat(500), 200, "https://x.dev/a(b)");
    expect(out).toContain("(https://x.dev/a%28b%29)");
  });
});

const FEED_CANDIDATES = [
  "tests/fixtures/feed.xml",
  "C:/Users/PC/AppData/Local/Temp/claude/f9edc60c3d6856b4/c4493d3c-65fe-4520-87ad-2e98dac19072/scratchpad/feed/feed.xml",
];
const feedPath = FEED_CANDIDATES.find((p) => existsSync(p));

describe.skipIf(!feedPath)("truncateMarkdown over the real feed", () => {
  it("every item stays within the limit with balanced fences and intact links", () => {
    const xml = readFileSync(feedPath!, "utf8");
    const descriptions = [...xml.matchAll(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/g)].map((m) => m[1]);
    expect(descriptions.length).toBeGreaterThan(0);
    for (const html of descriptions) {
      const md = htmlToDiscordMarkdown(html);
      expect(fenceCount(md) % 2).toBe(0);
      for (const max of [1000, 3800]) {
        const out = truncateMarkdown(md, max, URL_MORE);
        expect(out.length).toBeLessThanOrEqual(max);
        expect(fenceCount(out) % 2).toBe(0);
        expect(out).toBe(out.toWellFormed());
        if (md.length > max) {
          const body = out.slice(0, out.length - SUFFIX.length);
          let i = body.indexOf("](");
          while (i >= 0) {
            expect(body.indexOf(")", i)).toBeGreaterThan(-1);
            i = body.indexOf("](", i + 2);
          }
        }
      }
    }
  });
});
