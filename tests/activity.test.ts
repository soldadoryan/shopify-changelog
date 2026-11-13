import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/activity/rate-limit";
import { buildReplayPayload, REPLAY_CONTENT, replayLatestItem, type LatestItemSource } from "@/lib/activity/replay";
import { buildStartPayload } from "@/lib/activity/start";
import { countryFlag, safeText } from "@/lib/activity/text";
import { describeUserAgent, isBotUserAgent } from "@/lib/activity/user-agent";
import { buildVisitPayload, decideVisit, type VisitRequest } from "@/lib/activity/visit";
import { isActivityNoticesEnabled } from "@/lib/env";
import type { StoredItem } from "@/lib/types";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

function req(over: Partial<VisitRequest> & { headers?: Record<string, string> } = {}): VisitRequest {
  const headers: Record<string, string> = { accept: "text/html,application/xhtml+xml", "user-agent": CHROME, ...over.headers };
  return {
    method: "GET",
    pathname: "/",
    hasCookie: false,
    header: (n) => headers[n.toLowerCase()] ?? null,
    ...over,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("isBotUserAgent", () => {
  it.each(["", "Googlebot/2.1", "curl/8.0", "Discordbot/2.0", "python-requests/2", "HeadlessChrome/120", "Lighthouse", "node-fetch/1", "Go-http-client/2.0", "WhatsApp/2", "Slackbot"])(
    "bot: %j",
    (ua) => expect(isBotUserAgent(ua)).toBe(true),
  );
  it("null is a bot, real browsers are not", () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(CHROME)).toBe(false);
  });
});

describe("describeUserAgent", () => {
  it("parses browser and OS", () => {
    expect(describeUserAgent(CHROME)).toBe("Chrome 142 · Windows");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1")).toBe("Safari 17 · iOS");
    expect(describeUserAgent("xyz")).toBe("desconhecido");
  });
});

describe("decideVisit", () => {
  it("notifies a fresh human page view", () => expect(decideVisit(req())).toEqual({ notify: true }));
  it("filters non page views", () => {
    expect(decideVisit(req({ method: "POST" }))).toMatchObject({ reason: "method" });
    expect(decideVisit(req({ headers: { accept: "application/json" } }))).toMatchObject({ reason: "not_html" });
    expect(decideVisit(req({ headers: { "next-router-prefetch": "1" } }))).toMatchObject({ reason: "prefetch" });
    expect(decideVisit(req({ headers: { purpose: "prefetch" } }))).toMatchObject({ reason: "prefetch" });
    expect(decideVisit(req({ headers: { "sec-purpose": "prefetch;prerender" } }))).toMatchObject({ reason: "prefetch" });
    expect(decideVisit(req({ headers: { rsc: "1" } }))).toMatchObject({ reason: "prefetch" });
    expect(decideVisit(req({ search: "?_rsc=abc" }))).toMatchObject({ reason: "prefetch" });
    expect(decideVisit(req({ headers: { "user-agent": "curl/8" } }))).toMatchObject({ reason: "bot" });
  });
  it.each(["/_next/static/x.js", "/api/cron/sync", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon.svg", "/manifest.webmanifest", "/favicon.ico", "/llms.txt", "/logo.png"])(
    "excludes %s",
    (pathname) => expect(decideVisit(req({ pathname }))).toMatchObject({ reason: "excluded" }),
  );
  it("dedupes by cookie", () => expect(decideVisit(req({ hasCookie: true }))).toEqual({ notify: false, reason: "seen" }));
  it("keeps real pages", () => expect(decideVisit(req({ pathname: "/changelog/some-item" }))).toEqual({ notify: true }));
});

describe("createRateLimiter", () => {
  it("allows max per window, slides, and counts dropped", () => {
    let t = 0;
    const l = createRateLimiter(10, 60_000, () => t);
    for (let i = 0; i < 10; i++) expect(l.tryTake()).toBe(true);
    expect(l.tryTake()).toBe(false);
    expect(l.tryTake()).toBe(false);
    expect(l.takeDropped()).toBe(2);
    expect(l.takeDropped()).toBe(0);
    t = 60_000;
    expect(l.tryTake()).toBe(true);
  });
});

describe("buildVisitPayload", () => {
  it("builds the pt-BR embed without IP", () => {
    const p = buildVisitPayload({
      pathname: "/changelog/x",
      search: "?q=1",
      country: "br",
      userAgent: CHROME,
      referer: "https://www.google.com/search?q=a",
      ownHost: "meu.app",
      now: new Date("2026-11-13T12:00:00Z"),
    });
    const e = p.embeds[0];
    expect(e.title).toBe("👀 Novo acesso ao site");
    expect(e.footer.text).toBe("Changelog Shopify Dev · acesso");
    expect(e.timestamp).toBe("2026-11-13T12:00:00.000Z");
    expect(p.allowed_mentions).toEqual({ parse: [] });
    const by = Object.fromEntries(e.fields.map((f) => [f.name, f.value]));
    expect(by["Página"]).toBe("`/changelog/x?q=1`");
    expect(by["País"]).toBe("🇧🇷 BR");
    expect(by["Navegador/SO"]).toBe("Chrome 142 · Windows");
    expect(by["Origem"]).toBe("www.google.com");
    expect(JSON.stringify(p)).not.toMatch(/x-forwarded|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
  it("handles unknown country, own-host referer, mentions, clipping and dropped count", () => {
    const p = buildVisitPayload({
      pathname: "/@everyone",
      search: `?${"a".repeat(500)}<@123>`,
      country: null,
      referer: "https://meu.app/x",
      ownHost: "meu.app",
      droppedSinceLast: 3,
    });
    const e = p.embeds[0];
    const by = Object.fromEntries(e.fields.map((f) => [f.name, f.value]));
    expect(by["País"]).toBe("desconhecido");
    expect(by["Origem"]).toBe("direto");
    expect(by["Página"].length).toBeLessThanOrEqual(204);
    expect(by["Página"]).not.toContain("@everyone");
    expect(by["Não notificados"]).toContain("+3");
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});

describe("helpers", () => {
  it("safeText strips backticks/control and neutralizes mentions", () => {
    expect(safeText("a`b\n@everyone <@1>", 100)).not.toMatch(/`|\n|@everyone|<@/);
  });
  it("countryFlag", () => {
    expect(countryFlag("US")).toBe("🇺🇸");
    expect(countryFlag("xx")).toBe("");
    expect(countryFlag("USA")).toBe("");
  });
});

describe("buildStartPayload", () => {
  it("has no hostname and maps the environment", () => {
    const p = buildStartPayload({ nodeEnv: "production", nodeVersion: "v26.0.0", appVersion: "0.1.0" });
    const by = Object.fromEntries(p.embeds[0].fields.map((f) => [f.name, f.value]));
    expect(p.embeds[0].title).toBe("🟢 Aplicação iniciada");
    expect(by["Ambiente"]).toBe("production");
    expect(by["Máquina"]).toBe("local");
    expect(by["Versão do app"]).toBe("0.1.0");
    expect(buildStartPayload({ nodeEnv: "development", nodeVersion: "v1" }).embeds[0].fields[0].value).toBe("development");
  });
});

const ITEM: StoredItem = {
  guid: "https://shopify.dev/changelog/x",
  slug: "x",
  title: "Breaking thing",
  link: "https://shopify.dev/changelog/x",
  publishedAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  categories: ["Breaking API Change"],
  changeTypes: ["Breaking API Change"],
  areas: ["Admin API"],
  apiVersions: ["2026-10"],
  descriptionHtml: "<p>Body</p>",
  descriptionText: "Body",
  contentHash: "h",
  summaryPt: "Resumo salvo",
  notifyStatus: "sent",
  notifyAttempts: 1,
  notifiedAt: "2026-11-01T00:05:00.000Z",
} as unknown as StoredItem;

describe("replay of the latest item", () => {
  it("never mentions a role and prefixes content", () => {
    const p = buildReplayPayload(ITEM);
    expect(p.content).toBe(REPLAY_CONTENT);
    expect(p.content).not.toContain("<@&");
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(p.embeds[0].description).toContain("Resumo salvo");
  });
  it("is read-only: only latest() is called and the payload is sent", async () => {
    const source = { latest: vi.fn().mockResolvedValue(ITEM) } satisfies LatestItemSource;
    const send = vi.fn().mockResolvedValue(undefined);
    await replayLatestItem(source, send, () => undefined);
    expect(source.latest).toHaveBeenCalledTimes(1);
    expect(Object.keys(source)).toEqual(["latest"]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("skips silently on empty table or failure", async () => {
    const send = vi.fn();
    const log = vi.fn();
    await replayLatestItem({ latest: async () => null }, send, log);
    await replayLatestItem({ latest: async () => { throw new Error("secret"); } }, send, log);
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

describe("isActivityNoticesEnabled", () => {
  it("is on by default and off with ACTIVITY_NOTICES=0", () => {
    vi.stubEnv("ACTIVITY_NOTICES", "");
    expect(isActivityNoticesEnabled()).toBe(true);
    vi.stubEnv("ACTIVITY_NOTICES", "0");
    expect(isActivityNoticesEnabled()).toBe(false);
  });
});
