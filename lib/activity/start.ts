import { ACTIVITY_COLORS, ACTIVITY_USERNAME, type ActivityPayload } from "./types";
import { safeText } from "./text";

export type StartInfo = {
  nodeEnv?: string;
  nodeVersion: string;
  appVersion?: string;
  now?: Date;
};

/** Embed do aviso de início local. Sem hostname/usuário: a máquina é sempre "local". */
export function buildStartPayload(info: StartInfo): ActivityPayload {
  const env = info.nodeEnv === "production" ? "production" : "development";
  return {
    username: ACTIVITY_USERNAME,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "🟢 Aplicação iniciada",
        color: ACTIVITY_COLORS.start,
        fields: [
          { name: "Ambiente", value: env, inline: true },
          { name: "Máquina", value: "local", inline: true },
          { name: "Node", value: safeText(info.nodeVersion, 40), inline: true },
          { name: "Versão do app", value: safeText(info.appVersion || "desconhecida", 40), inline: true },
        ],
        timestamp: (info.now ?? new Date()).toISOString(),
        footer: { text: "Changelog Shopify Dev · início" },
      },
    ],
  };
}
