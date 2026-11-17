import { getDiscordWebhookUrl, getTeamsWebhookUrl, isActivityNoticesEnabled, isDiscordDryRun } from "@/lib/env";
import { sendDiscordWebhook } from "@/lib/discord/send";
import type { DiscordPayload } from "@/lib/discord/embed";
import type { TeamsPayload } from "@/lib/teams/card";
import { sendTeamsWebhook } from "@/lib/teams/send";
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

/** Avisos ligados e TEAMS_WEBHOOK_URL válida. */
export function teamsActivityConfigured(): boolean {
  return isActivityNoticesEnabled() && getTeamsWebhookUrl() !== undefined;
}

/** Mesmo contrato do aviso do Discord, mas para o Workflow do Teams: sem retry, nunca lança. */
export async function sendTeamsActivityNotice(payload: TeamsPayload): Promise<void> {
  try {
    if (!isActivityNoticesEnabled()) return;
    const webhookUrl = getTeamsWebhookUrl();
    if (!webhookUrl) return;
    const result = await sendTeamsWebhook(payload, {
      webhookUrl,
      dryRun: isDiscordDryRun(),
      timeoutMs: ACTIVITY_SEND_TIMEOUT_MS,
      log: (m) => console.log(m.slice(0, 600)),
    });
    if (result.kind === "ok") console.log("[activity] aviso de início enviado ao Teams");
    else if (result.kind === "failed") console.warn(`[activity] aviso ao Teams descartado: ${result.error}`.slice(0, 200));
  } catch {
    console.warn("[activity] aviso ao Teams descartado: erro inesperado");
  }
}
