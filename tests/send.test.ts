import { describe, expect, it, vi } from "vitest";
import { buildDiscordPayload } from "@/lib/discord/embed";
import { sendDiscordWebhook } from "@/lib/discord/send";
import type { FeedItem } from "@/lib/types";

const WEBHOOK = "https://discord.com/api/webhooks/123/SECRET-TOKEN";
const item: FeedItem = {
  guid: "g",
  link: "https://shopify.dev/changelog/x",
  slug: "x",
  title: "X",
  publishedAt: "2026-01-05T10:00:00.000Z",
  updatedAt: "2026-01-05T10:00:00.000Z",
  categories: [],
  changeTypes: [],
  areas: [],
  apiVersions: [],
  descriptionHtml: "<p>x</p>",
  descriptionText: "x",
  contentHash: "h",
};
const payload = buildDiscordPayload(item);

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("sendDiscordWebhook", () => {
  it("posts with ?wait=true and returns the message id", async () => {
    const fetchMock = vi.fn(async () =>
      json({ id: "999" }, 200, { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "1.5" }),
    );
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toEqual({ kind: "ok", messageId: "999", rateLimit: { remaining: 0, resetAfterMs: 1500 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WEBHOOK}?wait=true`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("classifies 429 using retry_after from the body", async () => {
    const fetchMock = vi.fn(async () => json({ message: "rate limited", retry_after: 2.5, global: false }, 429));
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toEqual({ kind: "rate_limited", retryAfterMs: 2500, global: false });
  });

  it("falls back to Retry-After header on 429", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 429, headers: { "retry-after": "3" } }));
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "rate_limited", retryAfterMs: 3000 });
  });

  it("marks 5xx as retryable failures", async () => {
    const fetchMock = vi.fn(async () => json({ message: "boom" }, 503));
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: true, status: 503 });
  });

  it("marks 4xx as non-retryable failures", async () => {
    const fetchMock = vi.fn(async () => json({ message: "Invalid Form Body" }, 400));
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: false, status: 400 });
    expect(res.kind === "failed" && res.error).toContain("Invalid Form Body");
  });

  it("marks only 500/502/503/504 as retryable; other 5xx are not", async () => {
    for (const status of [500, 502, 503, 504]) {
      const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: async () => json({}, status), dryRun: false });
      expect(res).toMatchObject({ kind: "failed", retryable: true, status });
    }
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: async () => json({}, 520), dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: false, status: 520 });
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])(
    "treats %s (never connected) as retryable and never leaks the webhook URL",
    async (code) => {
      const fetchMock = vi.fn(async () => {
        throw Object.assign(new TypeError(`fetch failed for ${WEBHOOK}?wait=true`), { cause: Object.assign(new Error("x"), { code }) });
      });
      const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
      expect(res).toMatchObject({ kind: "failed", retryable: true });
      expect(res).not.toHaveProperty("ambiguous");
      expect(JSON.stringify(res)).not.toContain("SECRET-TOKEN");
    },
  );

  it("treats AggregateError of ECONNREFUSED as retryable", async () => {
    const fetchMock = vi.fn(async () => {
      const agg = Object.assign(new AggregateError([{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }]), {});
      throw Object.assign(new TypeError("fetch failed"), { cause: agg });
    });
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: true });
  });

  it("treats ECONNRESET, unknown socket errors and bare network errors as ambiguous", async () => {
    const errors = [
      Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }),
      Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET" }) }),
      new TypeError(`fetch failed for ${WEBHOOK}?wait=true`),
    ];
    for (const err of errors) {
      const res = await sendDiscordWebhook(payload, {
        webhookUrl: WEBHOOK,
        fetch: async () => {
          throw err;
        },
        dryRun: false,
      });
      expect(res).toMatchObject({ kind: "failed", retryable: false, ambiguous: true });
      expect(JSON.stringify(res)).not.toContain("SECRET-TOKEN");
    }
  });

  it.each(["TimeoutError", "AbortError"])("treats %s as ambiguous", async (name) => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("timed out", name);
    });
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: false, ambiguous: true });
  });

  it("defaults the send timeout to 20 s", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: async () => json({ id: "1" }, 200), dryRun: false });
    expect(spy).toHaveBeenCalledWith(20_000);
    spy.mockRestore();
  });

  it("fails without retry when a 2xx has no message id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: false });
    expect(res).toMatchObject({ kind: "failed", retryable: false });
  });

  it("dry run logs the payload without calling fetch or leaking the URL", async () => {
    const fetchMock = vi.fn();
    const log = vi.fn();
    const res = await sendDiscordWebhook(payload, { webhookUrl: WEBHOOK, fetch: fetchMock, dryRun: true, log });
    expect(res).toEqual({ kind: "dry_run" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).not.toContain("SECRET-TOKEN");
  });
});
