import { describe, expect, it } from "vitest";
import { slugSuffix } from "@/lib/feed/classify";
import { diffFeed, type KnownItemRef } from "@/lib/sync/diff";
import type { FeedItem } from "@/lib/types";

function item(slug: string, overrides: Partial<FeedItem> = {}): FeedItem {
  const link = `https://shopify.dev/changelog/${slug}`;
  return {
    guid: link,
    link,
    slug,
    title: slug,
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    categories: [],
    changeTypes: [],
    areas: [],
    apiVersions: [],
    descriptionHtml: "",
    descriptionText: "",
    contentHash: `hash-${slug}`,
    ...overrides,
  };
}

function known(i: FeedItem, overrides: Partial<KnownItemRef> = {}): KnownItemRef {
  return { guid: i.guid, slug: i.slug, contentHash: i.contentHash, ...overrides };
}

describe("diffFeed", () => {
  it("separates new, changed and unchanged items", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const diff = diffFeed([known(a), known(b, { contentHash: "old" })], [a, b, c]);
    expect(diff.toInsert.map((i) => i.guid)).toEqual([c.guid]);
    expect(diff.toUpdate.map((i) => i.guid)).toEqual([b.guid]);
    expect(diff.unchanged).toBe(1);
    expect(diff.duplicates).toBe(0);
  });

  it("everything is new when the DB is empty, and nothing when the feed matches", () => {
    const list = [item("a"), item("b")];
    expect(diffFeed([], list).toInsert).toHaveLength(2);
    const same = diffFeed(list.map((i) => known(i)), list);
    expect(same.toInsert).toEqual([]);
    expect(same.toUpdate).toEqual([]);
    expect(same.unchanged).toBe(2);
  });

  it("never proposes removals for items missing from the feed", () => {
    const a = item("a");
    const diff = diffFeed([known(a), known(item("gone"))], [a]);
    expect(diff.toInsert).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
  });

  it("resolves a new item's slug against a DB row owned by a different guid", () => {
    const existing = item("foo", { guid: "https://shopify.dev/changelog/old/foo" });
    const fresh = item("foo");
    const diff = diffFeed([known(existing)], [fresh]);
    expect(diff.toInsert).toHaveLength(1);
    expect(diff.toInsert[0].slug).toBe(`foo-${slugSuffix(fresh.guid)}`);
    expect(diff.toInsert[0].guid).toBe(fresh.guid);
  });

  it("falls back to a counter when even the suffixed slug is taken", () => {
    const fresh = item("foo");
    const suffixed = `foo-${slugSuffix(fresh.guid)}`;
    const diff = diffFeed(
      [known(item("x1", { guid: "g1", slug: "foo" })), known(item("x2", { guid: "g2", slug: suffixed }))],
      [fresh],
    );
    expect(diff.toInsert[0].slug).toBe(`${suffixed}-2`);
  });

  it("does not collide two new items with each other after resolution", () => {
    const a = item("foo", { guid: "ga", link: "https://shopify.dev/changelog/foo" });
    const b = item("foo-x", { guid: "gb", link: "https://shopify.dev/changelog/foo-x" });
    const diff = diffFeed([known(item("z", { guid: "gz", slug: "foo" }))], [a, b]);
    const slugs = diff.toInsert.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs).not.toContain("foo");
  });

  it("keeps the DB slug for edited items even if the parse assigned another", () => {
    const stored = item("foo", { contentHash: "old" });
    const edited = { ...stored, slug: "foo-abcdef", contentHash: "new", title: "edited" };
    const diff = diffFeed([known(stored)], [edited]);
    expect(diff.toUpdate).toEqual([{ ...edited, slug: "foo" }]);
  });

  it("ignores repeated guids in the feed (first wins)", () => {
    const a = item("a");
    const diff = diffFeed([], [a, { ...a, title: "dup" }]);
    expect(diff.toInsert).toEqual([a]);
    expect(diff.duplicates).toBe(1);
  });

  it("is pure (does not mutate inputs)", () => {
    const existing = item("foo", { guid: "other" });
    const fresh = item("foo");
    const parsed = [fresh];
    const snapshot = structuredClone(parsed);
    diffFeed([known(existing)], parsed);
    expect(parsed).toEqual(snapshot);
  });
});
