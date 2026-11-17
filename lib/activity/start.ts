import type { TeamsPayload } from "@/lib/teams/card";
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

/** Mesmo aviso de início, como Adaptive Card para o Workflow do Teams (serve de teste do webhook). */
export function buildStartTeamsPayload(info: StartInfo): TeamsPayload {
  const env = info.nodeEnv === "production" ? "production" : "development";
  const when = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(info.now ?? new Date());
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body: [
            { type: "TextBlock", text: "🟢 Aplicação iniciada", wrap: true, size: "Large", weight: "Bolder", color: "Good" },
            { type: "TextBlock", text: `${when} · Changelog Shopify Dev · início`, wrap: true, size: "Small", isSubtle: true, spacing: "None" },
            {
              type: "FactSet",
              facts: [
                { title: "Ambiente", value: env },
                { title: "Máquina", value: "local" },
                { title: "Node", value: safeText(info.nodeVersion, 40) },
                { title: "Versão do app", value: safeText(info.appVersion || "desconhecida", 40) },
              ],
            },
          ],
          actions: [],
        },
      },
    ],
  };
}
