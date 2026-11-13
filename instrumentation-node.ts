import pkg from "./package.json";
import { activityConfigured, sendActivityNotice } from "@/lib/activity/notify";
import { supabaseLatestItem } from "@/lib/activity/latest-item";
import { replayLatestItem } from "@/lib/activity/replay";
import { buildStartPayload } from "@/lib/activity/start";

// Só carregado no runtime Node.js (ver instrumentation.ts). Aviso de início local + reenvio da última novidade.

export async function registerNode(): Promise<void> {
  if (process.env.VERCEL) return;
  try {
    const flags = globalThis as { __activityStartNoticeSent?: boolean };
    if (flags.__activityStartNoticeSent) return;
    flags.__activityStartNoticeSent = true;
    if (!activityConfigured()) return;

    void (async () => {
      await sendActivityNotice(
        buildStartPayload({
          nodeEnv: process.env.NODE_ENV,
          nodeVersion: process.version,
          appVersion: pkg.version,
        }),
      );
      await replayLatestItem(supabaseLatestItem, sendActivityNotice);
    })().catch(() => undefined);
  } catch {
    // Nunca derruba a inicialização.
  }
}
