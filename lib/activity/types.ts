import type { DiscordEmbedField } from "@/lib/discord/embed";

export type ActivityEmbed = {
  title: string;
  color: number;
  fields: DiscordEmbedField[];
  timestamp: string;
  footer: { text: string };
};

export type ActivityPayload = {
  username: string;
  allowed_mentions: { parse: never[] };
  embeds: [ActivityEmbed];
};

export const ACTIVITY_USERNAME = "Changelog Shopify Dev";

export const ACTIVITY_COLORS = {
  visit: 0x0094d5,
  start: 0x29845a,
} as const;
