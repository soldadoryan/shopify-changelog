import { describe, expect, it, vi } from "vitest";
import { buildDiscordPayload } from "@/lib/discord/embed";
import { MAX_NOTIFY_ATTEMPTS, type InitialNotifyStatus, type ItemsRepo, type KnownItem } from "@/lib/db/items";
import type { DiscordPayload } from "@/lib/discord/embed";
import type { SendResult } from "@/lib/discord/send";
import { FeedFetchError, FeedParseError } from "@/lib/feed/errors";
import { slugSuffix } from "@/lib/feed/classify";
import type { SummaryResult } from "@/lib/summarize";
import { runSync, type SyncConfig, type SyncDeps } from "@/lib/sync/run";
import type { FeedItem, NotifyStatus, StoredItem } from "@/lib/types";

vi.mock("@/lib/discord/embed", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/discord/embed")>();
  return { ...mod, buildDiscordPayload: vi.fn(mod.buildDiscordPayload) };
});

const T0 = Date.parse("2026-11-13T12:00:00.000Z");
const STALE_MS = 10 * 60 * 1000;

class Clock {
  t = T0;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

type Row = StoredItem & {
  summaryModel: string | null;
  notifyClaimedAt: number | null;
  discordMessageId: string | null;
  lastError: string | null;
};

function feedPart(r: FeedItem): FeedItem {
  return structuredClone({
    guid: r.guid,
    link: r.link,
    slug: r.slug,
    title: r.title,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    categories: r.categories,
    changeTypes: r.changeTypes,
    areas: r.areas,
    apiVersions: r.apiVersions,
    descriptionHtml: r.descriptionHtml,
    descriptionText: r.descriptionText,
    contentHash: r.contentHash,
  });
}

class MemoryRepo implements ItemsRepo {
  rows = new Map<string, Row>();
  state = {
    seededAt: null as string | null,
    lockOwner: null as string | null,
    lockUntil: null as number | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
  };
  events: string[] = [];
  failMarkSent = 0;

  constructor(private clock: Clock) {}

  async acquireLock(owner: string, ttlSeconds: number) {
    const now = this.clock.now();
    if (this.state.lockUntil === null || this.state.lockUntil < now) {
      this.state.lockOwner = owner;
      this.state.lockUntil = now + ttlSeconds * 1000;
      return true;
    }
    return false;
  }
  async releaseLock(owner: string) {
    if (this.state.lockOwner === owner) {
      this.state.lockOwner = null;
      this.state.lockUntil = null;
    }
  }
  async isSeeded() {
    return this.state.seededAt !== null;
  }
  async markSeeded(at: string) {
    this.state.seededAt = at;
  }
  async listKnownItems(): Promise<KnownItem[]> {
    return [...this.rows.values()].map((r) => ({ guid: r.guid, slug: r.slug, contentHash: r.contentHash }));
  }
  private assertSlugFree(slug: string, guid: string) {
    for (const r of this.rows.values()) {
      if (r.slug === slug && r.guid !== guid) throw new Error(`duplicate key value violates unique constraint (slug=${slug})`);
    }
  }
  async insertItems(items: FeedItem[], status: InitialNotifyStatus) {
    let n = 0;
    for (const item of items) {
      if (this.rows.has(item.guid)) continue;
      this.assertSlugFree(item.slug, item.guid);
      this.rows.set(item.guid, {
        ...structuredClone(item),
        summaryPt: null,
        summaryModel: null,
        notifyStatus: status,
        notifyAttempts: 0,
        notifiedAt: null,
        notifyClaimedAt: null,
        discordMessageId: null,
        lastError: null,
      });
      n++;
    }
    return n;
  }
  async updateEditedItems(items: FeedItem[]) {
    let n = 0;
    for (const item of items) {
      const row = this.rows.get(item.guid);
      if (!row) continue;
      this.assertSlugFree(item.slug, item.guid);
      Object.assign(row, structuredClone(item));
      if (["pending", "sending", "failed", "sent"].includes(row.notifyStatus)) {
        row.summaryPt = null;
        row.summaryModel = null;
      }
      n++;
    }
    return n;
  }
  async claimForNotify(limit: number): Promise<StoredItem[]> {
    const now = this.clock.now();
    for (const r of this.rows.values()) {
      if (
        r.notifyStatus === "sending" &&
        r.notifyAttempts >= MAX_NOTIFY_ATTEMPTS &&
        r.notifyClaimedAt !== null &&
        r.notifyClaimedAt < now - STALE_MS
      ) {
        r.notifyStatus = "failed";
        r.lastError = "stale sending (attempts exhausted)";
      }
    }
    const picked = [...this.rows.values()]
      .filter(
        (r) =>
          r.notifyStatus === "pending" ||
          (r.notifyStatus === "failed" && r.notifyAttempts < MAX_NOTIFY_ATTEMPTS) ||
          (r.notifyStatus === "sending" &&
            r.notifyAttempts < MAX_NOTIFY_ATTEMPTS &&
            r.notifyClaimedAt !== null &&
            r.notifyClaimedAt < now - STALE_MS),
      )
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.guid.localeCompare(b.guid))
      .slice(0, Math.max(limit, 0));
    for (const r of picked) {
      r.notifyStatus = "sending";
      r.notifyClaimedAt = now;
      r.notifyAttempts += 1;
    }
    this.events.push(`claim:${picked.length}`);
    return picked.map(
      (r): StoredItem => ({
        ...feedPart(r),
        summaryPt: r.summaryPt,
        notifyStatus: r.notifyStatus,
        notifyAttempts: r.notifyAttempts,
        notifiedAt: r.notifiedAt,
      }),
    );
  }
  async saveSummary(guid: string, summaryPt: string, model: string) {
    const r = this.rows.get(guid)!;
    r.summaryPt = summaryPt;
    r.summaryModel = model;
    this.events.push(`saveSummary:${guid}`);
  }
  async markSent(guid: string, args: { messageId: string | null; notifiedAt: string }) {
    if (this.failMarkSent > 0) {
      this.failMarkSent--;
      throw new Error("Supabase mark sent: connection reset");
    }
    const r = this.rows.get(guid)!;
    r.notifyStatus = "sent";
    r.notifiedAt = args.notifiedAt;
    r.discordMessageId = args.messageId;
    r.lastError = null;
    this.events.push(`sent:${guid}`);
  }
  async markFailed(guid: string, error: string) {
    const r = this.rows.get(guid)!;
    r.notifyStatus = "failed";
    r.lastError = error;
    this.events.push(`failed:${guid}`);
  }
  async markFailedTerminal(guid: string, error: string) {
    const r = this.rows.get(guid)!;
    r.notifyStatus = "failed";
    r.notifyAttempts = MAX_NOTIFY_ATTEMPTS;
    r.lastError = error;
    this.events.push(`failedTerminal:${guid}`);
  }
  async returnToPending(guids: string[], opts?: { refundAttempt?: boolean }) {
    const refund = opts?.refundAttempt ?? true;
    for (const g of guids) {
      const r = this.rows.get(g);
      if (!r || r.notifyStatus !== "sending") continue;
      r.notifyStatus = "pending";
      if (refund) r.notifyAttempts = Math.max(r.notifyAttempts - 1, 0);
    }
    this.events.push(`returnToPending:${guids.length}`);
  }
  async countRemaining() {
    return [...this.rows.values()].filter(
      (r) =>
        r.notifyStatus === "pending" ||
        r.notifyStatus === "sending" ||
        (r.notifyStatus === "failed" && r.notifyAttempts < MAX_NOTIFY_ATTEMPTS),
    ).length;
  }
  async recordError(error: string) {
    this.state.lastError = error;
  }
  async recordSuccess(at: string) {
    this.state.lastSuccessAt = at;
    this.state.lastError = null;
  }

  row(n: number) {
    return this.rows.get(guidOf(n))!;
  }
  status(n: number): NotifyStatus {
    return this.row(n).notifyStatus;
  }
}

function guidOf(n: number) {
  return `https://shopify.dev/changelog/item-${n}`;
}

function feedItem(n: number, overrides: Partial<FeedItem> = {}): FeedItem {
  const day = String(n).padStart(2, "0");
  return {
    guid: guidOf(n),
    link: guidOf(n),
    slug: `item-${n}`,
    title: `Item ${n}`,
    publishedAt: `2026-10-${day}T10:00:00.000Z`,
    updatedAt: `2026-10-${day}T10:00:00.000Z`,
    categories: ["New"],
    changeTypes: ["New"],
    areas: [],
    apiVersions: [],
    descriptionHtml: `<p>Body ${n}</p>`,
    descriptionText: `Body ${n}`,
    contentHash: `hash-${n}`,
    ...overrides,
  };
}

function range(from: number, to: number) {
  const out: FeedItem[] = [];
  for (let n = from; n <= to; n++) out.push(feedItem(n));
  return out;
}

const ok = (id: string, rateLimit = { remaining: 4 as number | null, resetAfterMs: 1000 as number | null }): SendResult => ({
  kind: "ok",
  messageId: id,
  rateLimit,
});
const fail5xx: SendResult = { kind: "failed", error: "Discord respondeu 503", retryable: true, status: 503 };

type Harness = {
  clock: Clock;
  repo: MemoryRepo;
  feed: { items: FeedItem[]; error: Error | null };
  sent: DiscordPayload[];
  replies: Array<SendResult | (() => Promise<SendResult>)>;
  sendDurationMs: number;
  summarize: ReturnType<typeof vi.fn<(item: StoredItem) => Promise<SummaryResult | null>>> | null;
  revalidate: ReturnType<typeof vi.fn<() => void>>;
  sleeps: number[];
  logs: string[];
  config: Partial<SyncConfig>;
  deps: () => SyncDeps;
  run: () => ReturnType<typeof runSync>;
};

function harness(initial: Partial<Pick<Harness, "config">> = {}): Harness {
  const clock = new Clock();
  const repo = new MemoryRepo(clock);
  let nextId = 1000;
  let owners = 0;
  const h: Harness = {
    clock,
    repo,
    feed: { items: [], error: null },
    sent: [],
    replies: [],
    sendDurationMs: 0,
    summarize: null,
    revalidate: vi.fn<() => void>(),
    sleeps: [],
    logs: [],
    config: initial.config ?? {},
    deps: () => ({
      repo,
      fetchFeed: async () => {
        if (h.feed.error) throw h.feed.error;
        return "<rss/>";
      },
      parseFeed: () => structuredClone(h.feed.items),
      send: async (payload) => {
        repo.events.push("send");
        h.sent.push(payload);
        clock.advance(h.sendDurationMs);
        const next = h.replies.shift();
        if (next === undefined) return ok(String(nextId++));
        return typeof next === "function" ? next() : next;
      },
      summarize: h.summarize,
      revalidate: h.revalidate,
      now: clock.now,
      sleep: async (ms) => {
        h.sleeps.push(ms);
        clock.advance(ms);
      },
      log: (level, message) => {
        h.logs.push(`${level} ${message}`);
      },
      createLockId: () => `owner-${++owners}`,
      config: { maxPostsPerRun: 5, ...h.config },
    }),
    run: () => runSync(h.deps()),
  };
  return h;
}

async function seeded(config: Partial<SyncConfig> = {}) {
  const h = harness({ config });
  h.feed.items = range(1, 3);
  const r = await h.run();
  expect(r.seeded).toBe(true);
  h.revalidate.mockClear();
  return h;
}

function titles(h: Harness) {
  return h.sent.map((p) => p.embeds[0].title);
}

describe("runSync — seed", () => {
  it("first run inserts everything as skipped and posts nothing", async () => {
    const h = harness();
    h.feed.items = range(1, 3);
    const r = await h.run();
    expect(r).toEqual({ status: "ok", seeded: true, inserted: 3, updated: 0, posted: 0, failed: 0, remaining: 0 });
    expect(h.sent).toHaveLength(0);
    expect([1, 2, 3].map((n) => h.repo.status(n))).toEqual(["skipped", "skipped", "skipped"]);
    expect(h.repo.state.seededAt).not.toBeNull();
    expect(h.repo.state.lockUntil).toBeNull();
    expect(h.revalidate).toHaveBeenCalledTimes(1);
    expect(h.repo.events).not.toContain("claim:0");
  });

  it("an interrupted seed (items inserted, seeded_at not set) is completed without posting", async () => {
    const h = harness();
    await h.repo.insertItems(range(1, 2), "skipped");
    h.feed.items = range(1, 4);
    const r = await h.run();
    expect(r.seeded).toBe(true);
    expect(r.inserted).toBe(2);
    expect(r.posted).toBe(0);
    expect(h.repo.status(4)).toBe("skipped");
  });
});

describe("runSync — notification", () => {
  it("posts a new item exactly once across runs", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    const r1 = await h.run();
    expect(r1).toEqual({ status: "ok", seeded: false, inserted: 1, updated: 0, posted: 1, failed: 0, remaining: 0 });
    expect(titles(h)).toEqual(["Item 4"]);
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sent", discordMessageId: "1000", notifyAttempts: 1 });
    expect(h.revalidate).toHaveBeenCalledTimes(1);

    const r2 = await h.run();
    expect(r2.posted).toBe(0);
    expect(r2.inserted).toBe(0);
    expect(h.sent).toHaveLength(1);
    expect(h.revalidate).toHaveBeenCalledTimes(1);
    expect(h.repo.state.lastSuccessAt).not.toBeNull();
    expect(h.repo.state.lastError).toBeNull();
  });

  it("posts oldest first and respects maxPostsPerRun", async () => {
    const h = await seeded({ maxPostsPerRun: 2 });
    h.feed.items = [...range(4, 6)].reverse();
    const r = await h.run();
    expect(titles(h)).toEqual(["Item 4", "Item 5"]);
    expect(r.remaining).toBe(1);
    await h.run();
    expect(titles(h)).toEqual(["Item 4", "Item 5", "Item 6"]);
  });

  it("a concurrent second run gets `locked` and never double-posts", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.replies.push(async () => {
      await gate;
      return ok("first");
    });
    const first = h.run();
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    const second = await h.run();
    expect(second).toEqual({ status: "locked", seeded: false, inserted: 0, updated: 0, posted: 0, failed: 0, remaining: 0 });
    release();
    expect((await first).posted).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(h.repo.state.lockUntil).toBeNull();
    expect((await h.run()).status).toBe("ok");
    expect(h.sent).toHaveLength(1);
  });

  it("an expired lock (crashed run) can be taken over after the TTL", async () => {
    const h = await seeded();
    await h.repo.acquireLock("dead-run", 120);
    expect((await h.run()).status).toBe("locked");
    h.clock.advance(121_000);
    expect((await h.run()).status).toBe("ok");
  });

  it("Discord 5xx → failed and batch stopped; next run retries and posts it", async () => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    h.replies.push(ok("a"), fail5xx);
    const r1 = await h.run();
    expect(r1).toMatchObject({ posted: 1, failed: 1, remaining: 2 });
    expect(h.repo.row(4).notifyStatus).toBe("sent");
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "failed", notifyAttempts: 1, lastError: "Discord respondeu 503" });
    expect(h.repo.row(6)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });

    const r2 = await h.run();
    expect(r2).toMatchObject({ posted: 2, failed: 0, remaining: 0 });
    expect(titles(h)).toEqual(["Item 4", "Item 5", "Item 5", "Item 6"]);
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "sent", notifyAttempts: 2, lastError: null });
  });

  it("an item failing MAX_NOTIFY_ATTEMPTS times is no longer claimed", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    for (let i = 0; i < MAX_NOTIFY_ATTEMPTS; i++) {
      h.replies.push(fail5xx);
      await h.run();
    }
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: MAX_NOTIFY_ATTEMPTS });
    const r = await h.run();
    expect(r).toMatchObject({ posted: 0, remaining: 0 });
    expect(h.sent).toHaveLength(MAX_NOTIFY_ATTEMPTS);
  });

  it("item-specific 4xx (400) → failed, batch continues", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    h.replies.push({ kind: "failed", error: "Discord respondeu 400: Invalid Form Body", retryable: false, status: 400 });
    const r = await h.run();
    expect(r).toMatchObject({ posted: 1, failed: 1 });
    expect(h.repo.status(4)).toBe("failed");
    expect(h.repo.status(5)).toBe("sent");
  });

  it("2xx without message id → sent (messageId null) and never re-posted", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push({ kind: "failed", error: "resposta 204 sem id de mensagem", retryable: false, status: 204 });
    const r = await h.run();
    expect(r).toMatchObject({ posted: 1, failed: 0, remaining: 0 });
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sent", discordMessageId: null });
    await h.run();
    h.clock.advance(STALE_MS * 2);
    await h.run();
    expect(h.sent).toHaveLength(1);
  });

  it.each([401, 404])("%i (webhook invalid/deleted) → batch stopped, attempts refunded, error recorded", async (status) => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    h.replies.push({ kind: "failed", error: `Discord respondeu ${status}: Unknown Webhook`, retryable: false, status });
    const r = await h.run();
    expect(r).toMatchObject({ posted: 0, failed: 0, remaining: 3 });
    expect(h.sent).toHaveLength(1);
    for (const n of [4, 5, 6]) expect(h.repo.row(n)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.state.lastError).toContain("Unknown Webhook");
    expect(h.repo.state.lastSuccessAt).not.toBeNull();
  });

  it("missing/invalid webhook config (non-retryable, no status) is treated as config error", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push({ kind: "failed", error: "Variável de ambiente obrigatória ausente: DISCORD_WEBHOOK_URL", retryable: false });
    await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.state.lastError).toContain("DISCORD_WEBHOOK_URL");
  });

  it("429 with short retry_after → waits and retries once", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push({ kind: "rate_limited", retryAfterMs: 2000, global: false });
    const r = await h.run();
    expect(r.posted).toBe(1);
    expect(h.sleeps).toEqual([2000]);
    expect(h.sent).toHaveLength(2);
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sent", notifyAttempts: 1 });
  });

  it("429 twice in a row → stop, item back to pending without burning an attempt", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    h.replies.push(
      { kind: "rate_limited", retryAfterMs: 1000, global: false },
      { kind: "rate_limited", retryAfterMs: 1000, global: false },
    );
    const r = await h.run();
    expect(r).toMatchObject({ posted: 0, failed: 0, remaining: 2 });
    expect(h.sent).toHaveLength(2);
    for (const n of [4, 5]) expect(h.repo.row(n)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
  });

  it("429 with long retry_after → stop batch, rest stays pending", async () => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    h.replies.push(ok("a"), { kind: "rate_limited", retryAfterMs: 30_000, global: true });
    const r = await h.run();
    expect(r).toMatchObject({ posted: 1, failed: 0, remaining: 2 });
    expect(h.sleeps).toEqual([]);
    expect(h.sent).toHaveLength(2);
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.row(6)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    await h.run();
    expect(h.repo.status(5)).toBe("sent");
    expect(h.repo.status(6)).toBe("sent");
  });

  it("honors X-RateLimit-Remaining=0 by waiting Reset-After before the next post", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    h.replies.push(ok("a", { remaining: 0, resetAfterMs: 1500 }), ok("b", { remaining: 0, resetAfterMs: 1500 }));
    const r = await h.run();
    expect(r.posted).toBe(2);
    expect(h.sleeps).toEqual([1500]);
  });

  it("Remaining=0 with a reset beyond the time budget → stop, rest pending", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    h.replies.push(ok("a", { remaining: 0, resetAfterMs: 60_000 }));
    const r = await h.run();
    expect(r).toMatchObject({ posted: 1, remaining: 1 });
    expect(h.sleeps).toEqual([]);
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
  });

  it("time budget exhausted → unprocessed items go back to pending (refunded)", async () => {
    const h = await seeded();
    h.feed.items = range(1, 8);
    h.sendDurationMs = 15_000;
    const r = await h.run();
    expect(r).toMatchObject({ posted: 3, failed: 0, remaining: 2 });
    expect([4, 5, 6].map((n) => h.repo.status(n))).toEqual(["sent", "sent", "sent"]);
    for (const n of [7, 8]) expect(h.repo.row(n)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.state.lockUntil).toBeNull();
  });

  it("dry run: nothing posted or marked sent; items back to pending with attempts refunded", async () => {
    const h = await seeded({ dryRun: true });
    h.feed.items = range(1, 5);
    h.summarize = vi.fn(async () => ({ text: "resumo", model: "m" }));
    const r = await h.run();
    expect(r).toMatchObject({ posted: 0, failed: 0, remaining: 2 });
    expect(h.sent).toHaveLength(0);
    for (const n of [4, 5]) expect(h.repo.row(n)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0, summaryPt: "resumo" });
    expect(h.logs.some((l) => l.includes("dry run, payload não enviado") && l.includes("Item 4"))).toBe(true);
  });
});

describe("runSync — summary", () => {
  it("is saved before sending and not regenerated on retry", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.summarize = vi.fn(async () => ({ text: "- resumo pt", model: "claude-x" }));
    h.replies.push(fail5xx);
    await h.run();
    expect(h.repo.events.indexOf(`saveSummary:${guidOf(4)}`)).toBeLessThan(h.repo.events.indexOf("send"));
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", summaryPt: "- resumo pt", summaryModel: "claude-x" });

    await h.run();
    expect(h.summarize).toHaveBeenCalledTimes(1);
    expect(h.repo.status(4)).toBe("sent");
    expect(h.sent[1].embeds[0].description).toContain("resumo pt");
  });

  it("summary failure (null) → posts without summary", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.summarize = vi.fn(async () => null);
    const r = await h.run();
    expect(r.posted).toBe(1);
    expect(h.repo.row(4).summaryPt).toBeNull();
  });

  it("summary that exceeds summaryTimeoutMs is abandoned and the item is still posted", async () => {
    const h = await seeded({ summaryTimeoutMs: 5 });
    h.feed.items = range(1, 4);
    h.summarize = vi.fn(() => new Promise<SummaryResult | null>(() => {}));
    const r = await h.run();
    expect(r.posted).toBe(1);
  });

  it("not enough time for the summary → posts WITHOUT summary instead of deferring", async () => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    h.summarize = vi.fn(async () => {
      h.clock.advance(25_000);
      return { text: "r", model: "m" };
    });
    const r = await h.run();
    expect(r.posted).toBe(3);
    expect(h.repo.row(4).summaryPt).toBe("r");
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "sent", summaryPt: null });
    expect(h.repo.row(6)).toMatchObject({ notifyStatus: "sent", summaryPt: null });
    expect(h.summarize).toHaveBeenCalledTimes(1);
    expect(h.logs.some((l) => l.includes("postando sem resumo"))).toBe(true);
  });

  it("not enough time even for the send → deferred to next run (refunded)", async () => {
    const h = await seeded({ notifyBudgetMs: 50_000 });
    h.feed.items = range(1, 6);
    h.summarize = vi.fn(async () => {
      h.clock.advance(35_000);
      return { text: "r", model: "m" };
    });
    const r = await h.run();
    expect(r.posted).toBe(1);
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.row(6)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
  });

  it("editing a sent item clears its summary", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.summarize = vi.fn(async () => ({ text: "velho", model: "m" }));
    await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sent", summaryPt: "velho", summaryModel: "m" });
    h.feed.items = [...range(1, 3), feedItem(4, { title: "Item 4 (edited)", contentHash: "hash-4b" })];
    await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sent", summaryPt: null, summaryModel: null });
  });
});

describe("runSync — edits, flood guard, slugs", () => {
  it("edit of a sent item → content updated, not re-posted", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    await h.run();
    h.feed.items = [...range(1, 3), feedItem(4, { title: "Item 4 (edited)", contentHash: "hash-4b" })];
    const r = await h.run();
    expect(r).toMatchObject({ updated: 1, inserted: 0, posted: 0 });
    expect(h.repo.row(4)).toMatchObject({ title: "Item 4 (edited)", notifyStatus: "sent" });
    expect(h.sent).toHaveLength(1);
    expect(h.revalidate).toHaveBeenCalledTimes(2);
  });

  it("edit of a skipped (seeded) item updates content and keeps it skipped", async () => {
    const h = await seeded();
    h.feed.items = [feedItem(1, { title: "edited", contentHash: "x" }), ...range(2, 3)];
    const r = await h.run();
    expect(r).toMatchObject({ updated: 1, posted: 0 });
    expect(h.repo.row(1)).toMatchObject({ title: "edited", notifyStatus: "skipped" });
  });

  it("edit of a pending item → summary cleared and regenerated from the new content", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.summarize = vi.fn(async (item: StoredItem) => ({ text: `resumo de ${item.title}`, model: "m" }));
    h.replies.push(fail5xx);
    await h.run();
    expect(h.repo.row(4).summaryPt).toBe("resumo de Item 4");

    h.feed.items = [...range(1, 3), feedItem(4, { title: "Item 4 v2", contentHash: "hash-4b" })];
    h.replies.push({ kind: "rate_limited", retryAfterMs: 30_000, global: false });
    await h.run();
    expect(h.repo.row(4).title).toBe("Item 4 v2");
    expect(h.repo.row(4).summaryPt).toBe("resumo de Item 4 v2");
    expect(h.summarize).toHaveBeenCalledTimes(2);
  });

  it("flood guard: more than 50 new items after seed → all skipped, nothing posted", async () => {
    const h = await seeded();
    const flood = Array.from({ length: 51 }, (_, i) => feedItem(100 + i, { publishedAt: "2026-11-01T00:00:00.000Z" }));
    h.feed.items = [...range(1, 3), ...flood];
    const r = await h.run();
    expect(r).toMatchObject({ status: "ok", inserted: 51, posted: 0, remaining: 0 });
    expect(h.sent).toHaveLength(0);
    expect(h.repo.row(100).notifyStatus).toBe("skipped");
    expect(h.repo.state.lastError).toContain("flood guard");
    expect(h.revalidate).toHaveBeenCalledTimes(1);
  });

  it("exactly 50 new items is not a flood (posted 5 per run)", async () => {
    const h = await seeded();
    const batch = Array.from({ length: 50 }, (_, i) => feedItem(100 + i, { publishedAt: "2026-11-01T00:00:00.000Z" }));
    h.feed.items = [...range(1, 3), ...batch];
    const r = await h.run();
    expect(r).toMatchObject({ inserted: 50, posted: 5, remaining: 45 });
  });

  it("new item whose slug is taken by a different guid in the DB gets a suffixed slug", async () => {
    const h = await seeded();
    const clash = feedItem(9, { guid: "https://shopify.dev/changelog/2026/item-1", link: "https://shopify.dev/changelog/2026/item-1", slug: "item-1" });
    h.feed.items = [...range(1, 3), clash];
    const r = await h.run();
    expect(r).toMatchObject({ inserted: 1, posted: 1 });
    const row = h.repo.rows.get(clash.guid)!;
    expect(row.slug).toBe(`item-1-${slugSuffix(clash.guid)}`);
    expect(h.repo.row(1).slug).toBe("item-1");
  });
});

describe("runSync — failures", () => {
  it.each([
    ["fetch", new FeedFetchError("http", "Feed respondeu HTTP 503", { status: 503 })],
    ["parse", new FeedParseError("XML inválido")],
  ])("feed %s error → feed_error, items untouched, lock released", async (_kind, error) => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    await h.run();
    const before = structuredClone([...h.repo.rows.values()]);
    const sentBefore = h.sent.length;
    h.feed.error = error;
    const r = await h.run();
    expect(r).toEqual({ status: "feed_error", seeded: false, inserted: 0, updated: 0, posted: 0, failed: 0, remaining: 0 });
    expect([...h.repo.rows.values()]).toEqual(before);
    expect(h.sent).toHaveLength(sentBefore);
    expect(h.repo.state.lastError).toContain(error.message);
    expect(h.repo.state.lockUntil).toBeNull();
  });

  it("feed error does not drain pending items either", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push(fail5xx);
    await h.run();
    h.feed.error = new FeedFetchError("timeout", "timeout");
    await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: 1 });
  });

  it("an empty parse result is a feed error", async () => {
    const h = await seeded();
    h.feed.items = [];
    expect((await h.run()).status).toBe("feed_error");
  });

  it("DB failure after Discord accepted: markSent retried once", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.repo.failMarkSent = 1;
    const r = await h.run();
    expect(r.posted).toBe(1);
    expect(h.repo.status(4)).toBe("sent");
    expect(h.sleeps).toEqual([500]);
  });

  it("markSent failing twice: run throws, lock released, posted item stays `sending` (not refunded), others refunded", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    h.repo.failMarkSent = 2;
    await expect(h.run()).rejects.toThrow("mark sent");
    expect(h.repo.state.lockUntil).toBeNull();
    expect(h.repo.state.lastError).toContain("mark sent");
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "sending", notifyAttempts: 1 });
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });

    h.clock.advance(60_000);
    await h.run();
    expect(titles(h)).toEqual(["Item 4", "Item 5"]);
    h.clock.advance(STALE_MS);
    await h.run();
    expect(titles(h)).toEqual(["Item 4", "Item 5", "Item 4"]);
  });

  it("unexpected repo error → rethrown, last_error recorded, lock released", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.repo.listKnownItems = async () => {
      throw new Error("Supabase list items: boom");
    };
    await expect(h.run()).rejects.toThrow("boom");
    expect(h.repo.state.lastError).toContain("boom");
    expect(h.repo.state.lockUntil).toBeNull();
  });

  it("revalidate throwing does not fail the run", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.revalidate.mockImplementation(() => {
      throw new Error("no static generation store");
    });
    expect((await h.run()).posted).toBe(1);
  });
});

describe("runSync — poison items (H1)", () => {
  const build = vi.mocked(buildDiscordPayload);
  const realBuild = build.getMockImplementation()!;

  it("payload builder throwing for A → A failed (attempt kept), B posted; A stops being claimed after 5 runs", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    build.mockImplementation((item, opts) => {
      if (item.link === guidOf(4)) throw new Error("boom payload");
      return realBuild(item, opts);
    });
    try {
      const r1 = await h.run();
      expect(r1).toMatchObject({ posted: 1, failed: 1 });
      expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: 1 });
      expect(h.repo.row(4).lastError).toMatch(/^payload: .*boom payload/);
      expect(h.repo.status(5)).toBe("sent");
      expect(titles(h)).toEqual(["Item 5"]);

      for (let run = 2; run <= 5; run++) {
        h.clock.advance(60_000);
        await h.run();
        expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: run });
      }
      const claimsBefore = h.repo.events.filter((e) => e === "claim:1").length;
      const r6 = await h.run();
      expect(r6).toMatchObject({ posted: 0, failed: 0, remaining: 0 });
      expect(h.repo.events.filter((e) => e === "claim:1").length).toBe(claimsBefore);
      expect(h.repo.row(4).notifyAttempts).toBe(5);
      expect(h.sent).toHaveLength(1);
    } finally {
      build.mockImplementation(realBuild);
    }
  });

  it("an exception mid-item (markFailed itself failing) keeps that item's attempt; untouched items are refunded", async () => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    build.mockImplementation((item, opts) => {
      if (item.link === guidOf(4)) throw new Error("boom payload");
      return realBuild(item, opts);
    });
    h.repo.markFailed = async () => {
      throw new Error("Supabase mark failed: down");
    };
    try {
      await expect(h.run()).rejects.toThrow("mark failed");
    } finally {
      build.mockImplementation(realBuild);
    }
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 1 });
    expect(h.repo.row(5)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.row(6)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.state.lockUntil).toBeNull();
  });
});

describe("runSync — ambiguous sends (H2)", () => {
  const ambiguous: SendResult = { kind: "failed", error: "timeout ao enviar ao Discord", retryable: false, ambiguous: true };

  it("timeout after sending → failed terminal (attempts=5, ambiguous: prefix), batch stops, rest refunded, never auto-retried", async () => {
    const h = await seeded();
    h.feed.items = range(1, 6);
    h.replies.push(ambiguous);
    const r = await h.run();
    expect(r).toMatchObject({ posted: 0, failed: 1, remaining: 2 });
    expect(h.sent).toHaveLength(1);
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: MAX_NOTIFY_ATTEMPTS });
    expect(h.repo.row(4).lastError).toMatch(/^ambiguous: /);
    for (const n of [5, 6]) expect(h.repo.row(n)).toMatchObject({ notifyStatus: "pending", notifyAttempts: 0 });
    expect(h.repo.state.lastError).toContain("ambiguous");

    await h.run();
    expect(titles(h)).toEqual(["Item 4", "Item 5", "Item 6"]);
    await h.run();
    expect(h.sent).toHaveLength(3);
    expect(h.repo.row(4).notifyStatus).toBe("failed");
  });

  it("markFailedTerminal is retried once; a retryable (never connected) failure still goes through markFailed", async () => {
    const h = await seeded();
    h.feed.items = range(1, 5);
    const real = h.repo.markFailedTerminal.bind(h.repo);
    let calls = 0;
    h.repo.markFailedTerminal = async (g, e) => {
      if (calls++ === 0) throw new Error("db blip");
      return real(g, e);
    };
    h.replies.push(ambiguous);
    await h.run();
    expect(calls).toBe(2);
    expect(h.repo.row(4).notifyAttempts).toBe(MAX_NOTIFY_ATTEMPTS);

    const h2 = await seeded();
    h2.feed.items = range(1, 5);
    h2.replies.push({ kind: "failed", error: "ECONNREFUSED", retryable: true });
    await h2.run();
    expect(h2.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: 1 });
    expect(h2.repo.row(4).lastError).not.toMatch(/^ambiguous/);
  });

  it("an ambiguous result on the 429 retry is also terminal", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push({ kind: "rate_limited", retryAfterMs: 1000, global: false }, ambiguous);
    await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", notifyAttempts: MAX_NOTIFY_ATTEMPTS });
  });
});

describe("runSync — stale exhausted sending (M1)", () => {
  async function withExhaustedSending(claimedAgoMs: number) {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push(fail5xx);
    await h.run();
    const row = h.repo.row(4);
    row.notifyStatus = "sending";
    row.notifyAttempts = MAX_NOTIFY_ATTEMPTS;
    row.notifyClaimedAt = h.clock.now() - claimedAgoMs;
    return h;
  }

  it("sending with attempts>=5 older than 10 min is flipped to failed on claim and not counted as remaining", async () => {
    const h = await withExhaustedSending(STALE_MS + 1000);
    const sentBefore = h.sent.length;
    const r = await h.run();
    expect(h.repo.row(4)).toMatchObject({ notifyStatus: "failed", lastError: "stale sending (attempts exhausted)" });
    expect(r).toMatchObject({ posted: 0, remaining: 0 });
    expect(h.sent).toHaveLength(sentBefore);
  });

  it("a recent in-flight sending with attempts>=5 is left alone", async () => {
    const h = await withExhaustedSending(60_000);
    const r = await h.run();
    expect(h.repo.status(4)).toBe("sending");
    expect(r.remaining).toBe(1);
  });

  it("failed with attempts>=5 is not counted as remaining", async () => {
    const h = await seeded();
    h.feed.items = range(1, 4);
    h.replies.push({ kind: "failed", error: "x", retryable: false, ambiguous: true });
    expect(await h.run()).toMatchObject({ remaining: 0 });
  });
});
