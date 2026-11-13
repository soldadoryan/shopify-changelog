import { describe, expect, it } from "vitest";
import { buildDiscordPayload, colorForTypes, COLORS, embedLength, type BuildPayloadOptions } from "@/lib/discord/embed";
import type { FeedItem } from "@/lib/types";

const LINK = "https://shopify.dev/changelog/some-item";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    guid: "g1",
    link: LINK,
    slug: "some-item",
    title: "Some item",
    publishedAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
    categories: [],
    changeTypes: ["Update"],
    areas: ["GraphQL Admin API"],
    apiVersions: ["2026-01"],
    descriptionHtml: "<p>Hello <strong>world</strong></p>",
    descriptionText: "Hello world",
    contentHash: "h",
    ...overrides,
  };
}

describe("buildDiscordPayload", () => {
  it("picks the color by highest priority change type", () => {
    expect(colorForTypes(["Update", "Breaking API Change"])).toBe(COLORS.critical);
    expect(colorForTypes(["New", "Action Required"])).toBe(COLORS.critical);
    expect(colorForTypes(["New", "Deprecation announcement"])).toBe(COLORS.warning);
    expect(colorForTypes(["Update", "New"])).toBe(COLORS.success);
    expect(colorForTypes(["Platform", "Update"])).toBe(COLORS.info);
    expect(colorForTypes(["Platform"])).toBe(COLORS.platform);
    expect(colorForTypes([])).toBe(COLORS.none);
  });

  it("builds title, link, fields, timestamp and footer", () => {
    const p = buildDiscordPayload(makeItem({ changeTypes: ["Action Required", "Update"], areas: ["A", "B"] }));
    const e = p.embeds[0];
    expect(e.title).toBe("Some item");
    expect(e.url).toBe(LINK);
    expect(e.timestamp).toBe("2026-01-05T10:00:00.000Z");
    expect(e.footer.text).toContain("bot não oficial");
    expect(e.fields).toEqual([
      { name: "Tipo", value: "Action Required · Update", inline: true },
      { name: "Área", value: "A, B", inline: true },
      { name: "Versão da API", value: "2026-01", inline: true },
    ]);
    expect(e.description).toContain("Hello **world**");
  });

  it("omits empty fields", () => {
    const p = buildDiscordPayload(makeItem({ changeTypes: [], areas: [], apiVersions: ["2026-01"] }));
    expect(p.embeds[0].fields.map((f) => f.name)).toEqual(["Versão da API"]);
  });

  it("produces a valid embed for empty descriptions", () => {
    const p = buildDiscordPayload(makeItem({ descriptionHtml: "", changeTypes: [], areas: [], apiVersions: [] }));
    expect(p.embeds[0].description).toBe(`[Ver no shopify.dev](${LINK})`);
    expect(p.embeds[0].fields).toEqual([]);
  });

  it("prepends the summary when present", () => {
    const p = buildDiscordPayload(makeItem(), { summaryPt: "- Mudou X" });
    expect(p.embeds[0].description).toMatch(/^\*\*Resumo \(IA\)\*\*\n- Mudou X\n\n\*\*Detalhes\*\*\nHello/);
  });

  it("neutralizes mentions inside the summary", () => {
    const p = buildDiscordPayload(makeItem(), { summaryPt: "@everyone <@123> <@&456>" });
    const d = p.embeds[0].description;
    expect(d).not.toContain("@everyone");
    expect(d).not.toContain("<@");
  });

  it("keeps the whole embed within 6000 chars for huge content", () => {
    const huge = `<p>${"palavra ".repeat(5000)}</p>`;
    const p = buildDiscordPayload(
      makeItem({
        title: "T".repeat(500),
        areas: Array.from({ length: 300 }, (_, i) => `Area number ${i}`),
        descriptionHtml: huge,
      }),
      { summaryPt: "s".repeat(3000) },
    );
    const e = p.embeds[0];
    expect(e.title.length).toBeLessThanOrEqual(256);
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(e.description.length).toBeLessThanOrEqual(3800);
    expect(embedLength(e)).toBeLessThanOrEqual(6000);
    expect(e.description).toContain("[Ler mais](");
  });

  it("shrinks the description when fields eat the budget", () => {
    const p = buildDiscordPayload(
      makeItem({ areas: ["x".repeat(1500)], changeTypes: ["Update".repeat(300)], descriptionHtml: `<p>${"a ".repeat(4000)}</p>` }),
    );
    expect(embedLength(p.embeds[0])).toBeLessThanOrEqual(6000);
  });

  describe("mentions", () => {
    const opts: BuildPayloadOptions = { alertRoleId: "123456789" };

    it("always sets allowed_mentions.parse to []", () => {
      const p = buildDiscordPayload(makeItem({ title: "@everyone hi", descriptionHtml: "<p>@everyone @here</p>" }));
      expect(p.allowed_mentions.parse).toEqual([]);
      expect(p.allowed_mentions.roles).toBeUndefined();
      expect(p.content).toBeUndefined();
      expect(p.embeds[0].title).not.toContain("@everyone");
    });

    it("mentions the role only for Action Required / Breaking API Change with env set", () => {
      for (const type of ["Action Required", "Breaking API Change"]) {
        const p = buildDiscordPayload(makeItem({ changeTypes: [type] }), opts);
        expect(p.content).toContain("<@&123456789>");
        expect(p.allowed_mentions).toEqual({ parse: [], roles: ["123456789"] });
      }
    });

    it("does not mention for other types or without a role", () => {
      const other = buildDiscordPayload(makeItem({ changeTypes: ["New"] }), opts);
      expect(other.content).toBeUndefined();
      expect(other.allowed_mentions).toEqual({ parse: [] });
      const noRole = buildDiscordPayload(makeItem({ changeTypes: ["Action Required"] }));
      expect(noRole.content).toBeUndefined();
    });

    it("ignores a non-numeric role id", () => {
      const p = buildDiscordPayload(makeItem({ changeTypes: ["Action Required"] }), { alertRoleId: "everyone" });
      expect(p.content).toBeUndefined();
      expect(p.allowed_mentions).toEqual({ parse: [] });
    });
  });
});
