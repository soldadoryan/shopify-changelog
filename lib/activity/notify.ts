import { getDiscordWebhookUrl, isActivityNoticesEnabled, isDiscordDryRun } from "@/lib/env";
import { sendDiscordWebhook } from "@/lib/discord/send";
import type { DiscordPayload } from "@/lib/discord/embed";
import type { ActivityPayload } from "./types";

export const ACTIVITY_SEND_TIMEOUT_MS = 5_000;

/** Avisos ligados (kill switch) e com destino: webhook configurado ou dry run. */
export function activityConfigured(): boolean {
  if (!isActivityNoticesEnabled()) return false;
  if (isDiscordDryRun()) return true;
  try {
    getDiscordWebhookUrl();
    return true;
  } catch {
    return false;
  }
}

/** Envia sem retry e sem lançar; qualquer falha vira uma linha curta de log (sem a URL do webhook). */
export async function sendActivityNotice(payload: ActivityPayload | DiscordPayload): Promise<void> {
  try {
    if (!activityConfigured()) return;
    const dryRun = isDiscordDryRun();
    const result = await sendDiscordWebhook(payload, {
      dryRun,
      webhookUrl: dryRun ? undefined : getDiscordWebhookUrl(),
      timeoutMs: ACTIVITY_SEND_TIMEOUT_MS,
      log: (m) => console.log(m.slice(0, 600)),
    });
    if (result.kind === "rate_limited") console.warn("[activity] aviso descartado: Discord 429");
    else if (result.kind === "failed") console.warn(`[activity] aviso descartado: ${result.error}`.slice(0, 200));
  } catch {
    console.warn("[activity] aviso descartado: erro inesperado");
  }
}
