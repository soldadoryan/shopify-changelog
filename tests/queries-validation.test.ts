import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM_COLUMNS, type ItemRow } from "@/lib/db/mapping";

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
  revalidateTag: () => {},
}));

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
const fromSpy = vi.fn();

function builder() {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "contains", "textSearch", "order", "eq"]) {
    b[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return b;
    };
  }
  b.range = async () => ({ data: [], count: 0, error: null });
  b.maybeSingle = async () => ({ data: null, error: null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (...args: unknown[]) => {
      fromSpy(...args);
      return builder();
    },
  }),
}));

const { listItems, getItemBySlug, cleanAreaParam, cleanTypeParam, cleanVersionParam } = await import("@/lib/db/queries");

const containsCalls = () => calls.filter((c) => c.method === "contains").map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  fromSpy.mockClear();
});

describe("filter validation (M5)", () => {
  it("type must be one of CHANGE_TYPES (exact canonical spelling)", () => {
    expect(cleanTypeParam("Action Required")).toBe("Action Required");
    expect(cleanTypeParam(" New ")).toBe("New");
    expect(cleanTypeParam("new")).toBeUndefined();
    expect(cleanTypeParam('New","x')).toBeUndefined();
    expect(cleanTypeParam("")).toBeUndefined();
    expect(cleanTypeParam(undefined)).toBeUndefined();
  });

  it("version must be YYYY-MM or YYYY-MM-DD", () => {
    expect(cleanVersionParam("2026-01")).toBe("2026-01");
    expect(cleanVersionParam("2026-01-15")).toBe("2026-01-15");
    for (const bad of ["2026", "2026-1", "2026-01-1", "26-01", "2026-01}", "2026-01,2026-02", "x2026-01"]) {
      expect(cleanVersionParam(bad)).toBeUndefined();
    }
  });

  it("area is dropped when longer than 80 chars or containing \" { } , \\ or control chars", () => {
    expect(cleanAreaParam("Admin GraphQL API")).toBe("Admin GraphQL API");
    expect(cleanAreaParam("a".repeat(80))).toBe("a".repeat(80));
    expect(cleanAreaParam("a".repeat(81))).toBeUndefined();
    for (const bad of ['a"b', "a{b", "a}b", "a,b", "a\\b", "a\nb", "a\u0000b"]) {
      expect(cleanAreaParam(bad)).toBeUndefined();
    }
  });

  it("listItems only forwards valid filters to the DB query", async () => {
    await listItems({ type: "bogus", version: "latest", area: 'x"},{"' });
    expect(containsCalls()).toEqual([]);
    calls.length = 0;
    await listItems({ type: "Update", version: "2026-01", area: "Webhooks" });
    expect(containsCalls()).toEqual([
      ["change_types", ["Update"]],
      ["areas", ["Webhooks"]],
      ["api_versions", ["2026-01"]],
    ]);
  });
});

describe("getItemBySlug validation (M5)", () => {
  it.each(["", "a b", "a/b", "a%20b", 'a"b', "a,b", "x".repeat(201), "café", "a\nb"])(
    "invalid slug %j → null without querying",
    async (slug) => {
      expect(await getItemBySlug(slug)).toBeNull();
      expect(fromSpy).not.toHaveBeenCalled();
    },
  );

  it("valid slugs query with explicit columns (no search tsvector, no *)", async () => {
    expect(await getItemBySlug("some-item_v1.2")).toBeNull();
    expect(await getItemBySlug("x".repeat(200))).toBeNull();
    expect(fromSpy).toHaveBeenCalledTimes(2);
    const select = calls.find((c) => c.method === "select");
    expect(select?.args[0]).toBe(ITEM_COLUMNS);
  });
});

describe("ITEM_COLUMNS (L6)", () => {
  it("lists exactly the ItemRow columns, never `search` or `*`", () => {
    const row: Record<keyof ItemRow, true> = {
      guid: true, slug: true, title: true, link: true, published_at: true, updated_at: true,
      categories: true, change_types: true, areas: true, api_versions: true, description_html: true,
      description_text: true, content_hash: true, summary_pt: true, summary_model: true,
      notify_status: true, notify_attempts: true, notify_claimed_at: true, notified_at: true,
      discord_message_id: true, last_error: true, first_seen_at: true,
    };
    const cols = ITEM_COLUMNS.split(",").map((c) => c.trim());
    expect(new Set(cols)).toEqual(new Set(Object.keys(row)));
    expect(cols).toHaveLength(Object.keys(row).length);
    expect(cols).not.toContain("search");
  });
});
