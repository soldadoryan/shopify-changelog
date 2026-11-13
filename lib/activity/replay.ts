import { buildDiscordPayload, type DiscordPayload } from "@/lib/discord/embed";
import type { StoredItem } from "@/lib/types";

export const REPLAY_CONTENT = "🔁 Última novidade do changelog (reenvio ao iniciar)";

/** Fonte somente leitura do item mais recente (published_at). */
export interface LatestItemSource {
  latest(): Promise<StoredItem | null>;
}

/** Embed normal de item novo, sem menção a cargo e sem chamar o resumo: usa o resumo já gravado. */
export function buildReplayPayload(item: StoredItem): DiscordPayload {
  const payload = buildDiscordPayload(item, { summaryPt: item.summaryPt ?? null, alertRoleId: null });
  payload.content = REPLAY_CONTENT;
  payload.allowed_mentions = { parse: [] };
  return payload;
}

/** Lê o item mais recente e o envia. Nunca lança; sem item/fonte = uma linha de log. */
export async function replayLatestItem(
  source: LatestItemSource,
  send: (payload: DiscordPayload) => Promise<void>,
  log: (message: string) => void = (m) => console.log(m),
): Promise<void> {
  try {
    const item = await source.latest();
    if (!item) {
      log("[activity] reenvio ao iniciar ignorado: nenhum item no banco");
      return;
    }
    await send(buildReplayPayload(item));
  } catch {
    log("[activity] reenvio ao iniciar ignorado: banco indisponível");
  }
}
