import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncResult } from "@/lib/types";

const runSync = vi.fn<() => Promise<SyncResult>>();

vi.mock("@/lib/sync/run", () => ({
  DEFAULT_SYNC_CONFIG: { sendTimeoutMs: 10_000 },
  runSync: (...args: unknown[]) => runSync(...(args as [])),
}));
vi.mock("@/lib/db/items", () => ({ createSupabaseItemsRepo: () => ({}) }));
vi.mock("@/lib/db/queries", () => ({ revalidateChangelog: vi.fn() }));

const { GET, runtime, maxDuration, dynamic } = await import("@/app/api/cron/sync/route");
const { isAuthorizedBearer } = await import("@/lib/sync/auth");

const SECRET = "s".repeat(40);
const OK: SyncResult = { status: "ok", seeded: false, inserted: 1, updated: 0, posted: 1, failed: 0, remaining: 0 };

function req(auth?: string): Request {
  return new Request("https://example.test/api/cron/sync", {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

describe("GET /api/cron/sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    runSync.mockReset();
    runSync.mockResolvedValue(OK);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exports the route segment config", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
    expect(dynamic).toBe("force-dynamic");
  });

  it.each([
    ["missing", undefined],
    ["wrong", `Bearer ${"x".repeat(40)}`],
    ["shorter", "Bearer abc"],
    ["no Bearer prefix", SECRET],
    ["empty bearer", "Bearer "],
  ])("401 with %s token, without running the sync", async (_label, auth) => {
    const res = await GET(req(auth));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runSync).not.toHaveBeenCalled();
  });

  it("200 with the SyncResult when the token is right", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(OK);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("locked → 200", async () => {
    runSync.mockResolvedValue({ ...OK, status: "locked", inserted: 0, posted: 0 });
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(200);
  });

  it("feed_error → 502", async () => {
    runSync.mockResolvedValue({ ...OK, status: "feed_error", inserted: 0, posted: 0 });
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(502);
  });

  it("unexpected error → 500 with a generic body (details only in logs)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    runSync.mockRejectedValue(new Error("Supabase claim_items_for_notify: secret detail"));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ error: "internal_error" }));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("secret detail"));
  });

  it("invalid optional vars (MAX_POSTS_PER_RUN, DISCORD_ALERT_ROLE_ID) never break the sync", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MAX_POSTS_PER_RUN", "lots");
    vi.stubEnv("DISCORD_ALERT_ROLE_ID", "@Devs");
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const deps = runSync.mock.calls[0] as unknown as [{ config: { maxPostsPerRun: number; alertRoleId: string | null } }];
    expect(deps[0].config).toMatchObject({ maxPostsPerRun: 5, alertRoleId: null });
  });

  it("CRON_SECRET missing or too short → 500, never authorizes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("CRON_SECRET", "short");
    const res = await GET(req("Bearer short"));
    expect(res.status).toBe(500);
    expect(runSync).not.toHaveBeenCalled();
  });
});

describe("isAuthorizedBearer", () => {
  it("accepts only the exact secret", () => {
    expect(isAuthorizedBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedBearer(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedBearer(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedBearer(null, SECRET)).toBe(false);
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
  });
});
