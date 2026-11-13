import { randomUUID } from "node:crypto";
import { createSupabaseItemsRepo } from "@/lib/db/items";
import { revalidateChangelog } from "@/lib/db/queries";
import { sendDiscordWebhook } from "@/lib/discord/send";
import {
  getAnthropicApiKey,
  getCronSecret,
  getDiscordAlertRoleId,
  getMaxPostsPerRun,
  isDiscordDryRun,
} from "@/lib/env";
import { fetchFeed, parseFeed } from "@/lib/feed";
import { summarizePt } from "@/lib/summarize";
import { isAuthorizedBearer } from "@/lib/sync/auth";
import { DEFAULT_SYNC_CONFIG, runSync, type SyncLogger } from "@/lib/sync/run";
import type { SyncResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const log: SyncLogger = (level, message) => {
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
};

function statusFor(result: SyncResult): number {
  return result.status === "feed_error" ? 502 : 200;
}

export async function GET(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch (err) {
    console.error(`[sync] CRON_SECRET indisponível: ${err instanceof Error ? err.message : "erro"}`);
    return json({ error: "internal_error" }, 500);
  }
  if (!isAuthorizedBearer(request.headers.get("authorization"), secret)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const apiKey = getAnthropicApiKey();
    const summarizeLog = (m: string) => console.warn(m);
    const result = await runSync({
      repo: createSupabaseItemsRepo(),
      fetchFeed: () => fetchFeed(),
      parseFeed,
      send: (payload) =>
        sendDiscordWebhook(payload, { timeoutMs: DEFAULT_SYNC_CONFIG.sendTimeoutMs, dryRun: false }),
      summarize: apiKey ? (item) => summarizePt(item, { apiKey, log: summarizeLog }) : null,
      revalidate: revalidateChangelog,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
      createLockId: () => randomUUID(),
      config: {
        maxPostsPerRun: getMaxPostsPerRun(),
        alertRoleId: getDiscordAlertRoleId() ?? null,
        dryRun: isDiscordDryRun(),
      },
    });
    return json(result, statusFor(result));
  } catch (err) {
    console.error(`[sync] erro inesperado: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    return json({ error: "internal_error" }, 500);
  }
}
