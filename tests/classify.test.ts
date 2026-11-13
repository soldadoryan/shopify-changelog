import { describe, expect, it } from "vitest";
import {
  CHANGE_TYPES,
  classifyCategories,
  contentHash,
  resolveSlugCollision,
  slugFromLink,
  slugSuffix,
} from "@/lib/feed/classify";
import { htmlToSearchText } from "@/lib/feed/text";

describe("classifyCategories", () => {
  it("separa tipo, área e versão", () => {
    expect(
      classifyCategories(["API", "Breaking API Change", "GraphQL Admin API", "2026-01", "Action Required", "2026-08-25"]),
    ).toEqual({
      changeTypes: ["Breaking API Change", "Action Required"],
      areas: ["API", "GraphQL Admin API"],
      apiVersions: ["2026-01", "2026-08-25"],
    });
  });

  it("reconhece todos os tipos de mudança", () => {
    expect(classifyCategories([...CHANGE_TYPES]).changeTypes).toEqual([...CHANGE_TYPES]);
    expect(classifyCategories([...CHANGE_TYPES]).areas).toEqual([]);
  });

  it("match de tipo é case-insensitive e devolve a grafia canônica", () => {
    expect(classifyCategories(["new", "DEPRECATION ANNOUNCEMENT", " update "]).changeTypes).toEqual([
      "New",
      "Deprecation announcement",
      "Update",
    ]);
  });

  it("categoria desconhecida vira área (nunca descartada)", () => {
    expect(classifyCategories(["Something Brand New", "Changelog"]).areas).toEqual(["Something Brand New", "Changelog"]);
  });

  it("versões só casam YYYY-MM e YYYY-MM-DD; o resto é área", () => {
    const r = classifyCategories(["2026-10", "2026-08-25", "2026", "2026-1", "2026-10-1", "v2026-10", "unstable"]);
    expect(r.apiVersions).toEqual(["2026-10", "2026-08-25"]);
    expect(r.areas).toEqual(["2026", "2026-1", "2026-10-1", "v2026-10", "unstable"]);
  });

  it("lista vazia, vazios e duplicatas", () => {
    expect(classifyCategories([])).toEqual({ changeTypes: [], areas: [], apiVersions: [] });
    expect(classifyCategories(["", "  ", "API", "API", "New", "new"])).toEqual({
      changeTypes: ["New"],
      areas: ["API"],
      apiVersions: [],
    });
  });
});

describe("slugFromLink", () => {
  it("usa o último segmento do pathname", () => {
    expect(slugFromLink("https://shopify.dev/changelog/some-item")).toBe("some-item");
  });

  it("ignora barra final, query e hash", () => {
    expect(slugFromLink("https://shopify.dev/changelog/some-item/?utm=1#x")).toBe("some-item");
  });

  it("resolve link relativo", () => {
    expect(slugFromLink("/changelog/relative-one")).toBe("relative-one");
  });

  it("decodifica percent-encoding", () => {
    expect(slugFromLink("https://shopify.dev/changelog/a%20b")).toBe("a-b");
  });

  it("sanitiza para [A-Za-z0-9_.-], colapsa repetidos e apara hifens", () => {
    expect(slugFromLink("https://shopify.dev/changelog/%20a%20%20b%20")).toBe("a-b");
    expect(slugFromLink("https://shopify.dev/changelog/caf%C3%A9%2F..%3Cx%3E")).toBe("caf-..-x");
    expect(slugFromLink("https://shopify.dev/changelog/a%25zz")).toBe("a-zz");
    expect(slugFromLink("https://shopify.dev/changelog/%E0%A4%A")).toBe("E0-A4-A");
    expect(slugFromLink("https://shopify.dev/changelog/ok_name.v2-1")).toBe("ok_name.v2-1");
  });
});

describe("resolveSlugCollision", () => {
  it("mantém o slug livre e sufixa o colidido com hash6 estável do guid", () => {
    const taken = new Set(["dup"]);
    expect(resolveSlugCollision("free", "g1", taken)).toBe("free");
    const resolved = resolveSlugCollision("dup", "https://shopify.dev/other/dup", taken);
    expect(resolved).toBe(`dup-${slugSuffix("https://shopify.dev/other/dup")}`);
    expect(resolved).toMatch(/^dup-[0-9a-f]{6}$/);
    expect(taken.size).toBe(1);
  });
});

describe("contentHash", () => {
  it("é sha256 hex determinístico sobre título, descrição e categorias", () => {
    const h = contentHash("T", "<p>x</p>", ["New", "API"]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash("T", "<p>x</p>", ["New", "API"])).toBe(h);
    expect(contentHash("T2", "<p>x</p>", ["New", "API"])).not.toBe(h);
    expect(contentHash("T", "<p>y</p>", ["New", "API"])).not.toBe(h);
    expect(contentHash("T", "<p>x</p>", ["API", "New"])).not.toBe(h);
  });
});

describe("htmlToSearchText", () => {
  it("remove tags, script/style e colapsa espaços", () => {
    expect(htmlToSearchText("<p>Hello</p>\n<ul><li>a</li><li>b</li></ul><script>x()</script><style>p{}</style>")).toBe(
      "Hello a b",
    );
  });

  it("decodifica entidades uma única vez", () => {
    expect(htmlToSearchText("<p>&lt;div&gt; &amp;amp; &quot;q&quot; &#39;s&#39; &#x41;</p>")).toBe(`<div> &amp; "q" 's' A`);
  });
});
