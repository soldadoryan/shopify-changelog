import { describe, expect, it, vi } from "vitest";
import { feedItemToRow, rowToStoredItem, toIso, type ItemRow } from "@/lib/db/mapping";
import type { FeedItem } from "@/lib/types";

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
  revalidateTag: () => {},
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }));

const { sanitizeSearchQuery } = await import("@/lib/db/queries");

const item: FeedItem = {
  guid: "https://shopify.dev/changelog/a",
  link: "https://shopify.dev/changelog/a",
  slug: "a",
  title: "T",
  publishedAt: "2025-01-02T03:04:05.000Z",
  updatedAt: "2025-01-03T00:00:00.000Z",
  categories: ["New", "2025-01"],
  changeTypes: ["New"],
  areas: [],
  apiVersions: ["2025-01"],
  descriptionHtml: "<p>x</p>",
  descriptionText: "x",
  contentHash: "h",
};

describe("row mapping", () => {
  it("maps FeedItem to snake_case columns", () => {
    expect(feedItemToRow(item)).toEqual({
      guid: item.guid,
      slug: "a",
      title: "T",
      link: item.link,
      published_at: item.publishedAt,
      updated_at: item.updatedAt,
      categories: ["New", "2025-01"],
      change_types: ["New"],
      areas: [],
      api_versions: ["2025-01"],
      description_html: "<p>x</p>",
      description_text: "x",
      content_hash: "h",
    });
  });

  it("maps a DB row back, normalizing timestamps", () => {
    const row: ItemRow = {
      ...feedItemToRow(item),
      published_at: "2025-01-02T03:04:05+00:00",
      updated_at: "2025-01-03T00:00:00+00:00",
      summary_pt: "resumo",
      summary_model: "m",
      notify_status: "sent",
      notify_attempts: 2,
      notify_claimed_at: null,
      notified_at: "2025-02-01T10:00:00+00:00",
      discord_message_id: "1",
      last_error: null,
      first_seen_at: "2025-01-02T00:00:00+00:00",
    };
    expect(rowToStoredItem(row)).toEqual({
      ...item,
      summaryPt: "resumo",
      notifyStatus: "sent",
      notifyAttempts: 2,
      notifiedAt: "2025-02-01T10:00:00.000Z",
    });
  });

  it("toIso keeps unparseable values", () => {
    expect(toIso("nope")).toBe("nope");
  });
});

describe("sanitizeSearchQuery", () => {
  it("strips filter delimiters and control chars, collapses whitespace", () => {
    expect(sanitizeSearchQuery("  graphql,\t(admin)\n api ")).toBe("graphql admin api");
  });
  it("keeps websearch operators", () => {
    expect(sanitizeSearchQuery('"rate limit" -deprecated or new')).toBe(
      '"rate limit" -deprecated or new',
    );
  });
  it("returns undefined for empty input and caps length", () => {
    expect(sanitizeSearchQuery("  , ")).toBeUndefined();
    expect(sanitizeSearchQuery(undefined)).toBeUndefined();
    expect(sanitizeSearchQuery("a".repeat(500))?.length).toBe(200);
  });
});
