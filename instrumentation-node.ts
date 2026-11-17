import pkg from "./package.json";
import {
  activityConfigured,
  sendActivityNotice,
  sendTeamsActivityNotice,
  teamsActivityConfigured,
} from "@/lib/activity/notify";
import { supabaseLatestItem } from "@/lib/activity/latest-item";
import { replayLatestItem } from "@/lib/activity/replay";
import { buildStartPayload, buildStartTeamsPayload } from "@/lib/activity/start";

// Só carregado no runtime Node.js (ver instrumentation.ts). Aviso de início local (Discord e Teams)
// + reenvio da última novidade no Discord.

export async function registerNode(): Promise<void> {
  if (process.env.VERCEL) return;
  try {
    const flags = globalThis as { __activityStartNoticeSent?: boolean };
    if (flags.__activityStartNoticeSent) return;
    flags.__activityStartNoticeSent = true;

    const info = {
      nodeEnv: process.env.NODE_ENV,
      nodeVersion: process.version,
      appVersion: pkg.version,
    };

    if (teamsActivityConfigured()) {
      void sendTeamsActivityNotice(buildStartTeamsPayload(info)).catch(() => undefined);
    }

    if (activityConfigured()) {
      void (async () => {
        await sendActivityNotice(buildStartPayload(info));
        await replayLatestItem(supabaseLatestItem, sendActivityNotice);
      })().catch(() => undefined);
    }
  } catch {
    // Nunca derruba a inicialização.
  }
}
