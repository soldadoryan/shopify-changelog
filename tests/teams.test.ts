import { describe, expect, it, vi } from "vitest";
import { buildTeamsPayload, toTeamsMarkdown } from "@/lib/teams/card";
import { sendTeamsWebhook } from "@/lib/teams/send";
import type { FeedItem } from "@/lib/types";

const WEBHOOK = "https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SECRET-SIG";
const item: FeedItem = {
  guid: "g",
  link: "https://shopify.dev/changelog/x",
  slug: "x",
  title: "Nova API de descontos",
  publishedAt: "2026-01-05T10:00:00.000Z",
  updatedAt: "2026-01-05T10:00:00.000Z",
  categories: [],
  changeTypes: ["Breaking API Change"],
  areas: ["Admin GraphQL API"],
  apiVersions: ["2026-01"],
  descriptionHtml: "<h2>O que mudou</h2><p>Use <code>discountCreate</code>.</p><pre><code>mutation { x }</code></pre>",
  descriptionText: "",
  contentHash: "h",
};

describe("buildTeamsPayload", () => {
  it("builds an Adaptive Card message with alert, title, facts, summary, body and link", () => {
    const payload = buildTeamsPayload(item, { summaryPt: "Resumo curto." });
    expect(payload.type).toBe("message");
    const att = payload.attachments[0];
    expect(att.contentType).toBe("application/vnd.microsoft.card.adaptive");
    const card = att.content;
    expect(card.type).toBe("AdaptiveCard");
    expect(card.actions).toEqual([{ type: "Action.OpenUrl", title: "Ver no shopify.dev", url: item.link }]);

    const texts = card.body.flatMap((b) => (b.type === "TextBlock" ? [b.text] : []));
    expect(texts[0]).toBe("⚠️ Ação necessária");
    expect(texts[1]).toBe("Nova API de descontos");
    expect(texts).toContain("Resumo curto.");
    const details = texts[texts.length - 1];
    expect(details).toContain("**O que mudou**");
    expect(details).toContain("discountCreate");
    expect(details).not.toContain("```");
    expect(details).not.toContain("`");

    const title = card.body.find((b) => b.type === "TextBlock" && b.text === "Nova API de descontos");
    expect(title).toMatchObject({ color: "Attention", size: "Large" });

    const facts = card.body.find((b) => b.type === "FactSet");
    expect(facts).toEqual({
      type: "FactSet",
      facts: [
        { title: "Tipo", value: "Breaking API Change" },
        { title: "Área", value: "Admin GraphQL API" },
        { title: "Versão da API", value: "2026-01" },
      ],
    });
  });

  it("omits alert, facts and summary when absent", () => {
    const plain = { ...item, changeTypes: [], areas: [], apiVersions: [] };
    const card = buildTeamsPayload(plain).attachments[0].content;
    expect(card.body.some((b) => b.type === "FactSet")).toBe(false);
    const texts = card.body.flatMap((b) => (b.type === "TextBlock" ? [b.text] : []));
    expect(texts).not.toContain("⚠️ Ação necessária");
    expect(texts).not.toContain("**Resumo (IA)**");
  });

  it("keeps the payload small for very long bodies", () => {
    const long = { ...item, descriptionHtml: `<p>${"palavra ".repeat(5000)}</p>` };
    expect(JSON.stringify(buildTeamsPayload(long)).length).toBeLessThan(10_000);
  });
});

describe("toTeamsMarkdown", () => {
  it("strips fences, quotes, inline code and escapes", () => {
    expect(toTeamsMarkdown("> nota\n\n```js\nconst a = 1\n```\n\nuse `x` e 1\\. item")).toBe(
      "nota\n\nconst a = 1\n\nuse x e 1. item",
    );
  });
});

describe("sendTeamsWebhook", () => {
  const payload = buildTeamsPayload(item);

  it("posts JSON and treats 202 as ok", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    const res = await sendTeamsWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock });
    expect(res).toEqual({ kind: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("returns failed with the status on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    const res = await sendTeamsWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock });
    expect(res).toEqual({ kind: "failed", error: "Teams respondeu 400", status: 400 });
  });

  it("never leaks the webhook URL in errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error(`fetch failed for ${WEBHOOK}`);
    });
    const res = await sendTeamsWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock });
    expect(res.kind).toBe("failed");
    expect(JSON.stringify(res)).not.toContain("SECRET-SIG");
  });

  it("dry run does not call fetch", async () => {
    const fetchMock = vi.fn();
    const res = await sendTeamsWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: true, log: () => {} });
    expect(res).toEqual({ kind: "dry_run" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
