import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_POSTS_PER_RUN,
  getCronSecret,
  getDiscordAlertRoleId,
  getMaxPostsPerRun,
} from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getMaxPostsPerRun (lenient)", () => {
  it("defaults to 5 when unset or empty", () => {
    vi.stubEnv("MAX_POSTS_PER_RUN", "");
    expect(getMaxPostsPerRun()).toBe(DEFAULT_MAX_POSTS_PER_RUN);
    expect(DEFAULT_MAX_POSTS_PER_RUN).toBe(5);
  });

  it.each([
    ["3", 3],
    [" 7 ", 7],
    ["10", 10],
    ["11", 10],
    ["999", 10],
    ["0", 1],
    ["1", 1],
  ])("%j → %i (clamped to 1..10)", (raw, expected) => {
    vi.stubEnv("MAX_POSTS_PER_RUN", raw);
    expect(getMaxPostsPerRun()).toBe(expected);
  });

  it.each(["abc", "-3", "2.5", "1e3", "5 posts"])("invalid %j → warning + default, never throws", (raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MAX_POSTS_PER_RUN", raw);
    expect(getMaxPostsPerRun()).toBe(5);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("getDiscordAlertRoleId (lenient)", () => {
  it("returns undefined when unset and the id when numeric", () => {
    vi.stubEnv("DISCORD_ALERT_ROLE_ID", "");
    expect(getDiscordAlertRoleId()).toBeUndefined();
    vi.stubEnv("DISCORD_ALERT_ROLE_ID", "123456789012345678");
    expect(getDiscordAlertRoleId()).toBe("123456789012345678");
  });

  it.each(["@Devs", "<@&123>", "12 34", "abc"])("invalid %j → warning + undefined, never throws", (raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DISCORD_ALERT_ROLE_ID", raw);
    expect(getDiscordAlertRoleId()).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("getCronSecret stays strict", () => {
  it("throws when missing or shorter than 32 chars", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(() => getCronSecret()).toThrow();
    vi.stubEnv("CRON_SECRET", "short");
    expect(() => getCronSecret()).toThrow();
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect(getCronSecret()).toBe("s".repeat(32));
  });
});
