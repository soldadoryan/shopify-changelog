import "server-only";
import { z } from "zod";

// Leitura tipada e preguiçosa das variáveis de ambiente.
// Cada acessor lê process.env no momento da chamada e valida com zod; nada é
// validado no import, então módulos que não precisam de um segredo não quebram.
// Este módulo importa "server-only": segredos nunca chegam ao bundle do cliente.

export const DEFAULT_FEED_URL = "https://shopify.dev/changelog/feed.xml";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const DEFAULT_MAX_POSTS_PER_RUN = 5;

/** Valor bruto da variável; string vazia conta como ausente. */
function readRaw(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function parseValue<T>(name: string, schema: z.ZodType<T>, raw: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "valor inválido";
    throw new Error(`Variável de ambiente ${name} inválida: ${message}`);
  }
  return result.data;
}

function requiredEnv<T>(name: string, schema: z.ZodType<T>): T {
  const raw = readRaw(name);
  if (raw === undefined) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return parseValue(name, schema, raw);
}

function optionalEnv<T>(name: string, schema: z.ZodType<T>): T | undefined {
  const raw = readRaw(name);
  return raw === undefined ? undefined : parseValue(name, schema, raw);
}

// --- Obrigatórias ----------------------------------------------------------

/** URL do projeto Supabase. */
export function getSupabaseUrl(): string {
  return requiredEnv("SUPABASE_URL", z.url());
}

/** Service role key do Supabase (somente servidor). */
export function getSupabaseServiceRoleKey(): string {
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY", z.string());
}

/** Bearer da rota de sync; exige >= 32 caracteres aleatórios. */
export function getCronSecret(): string {
  return requiredEnv("CRON_SECRET", z.string().min(32, "precisa ter pelo menos 32 caracteres"));
}

/** Webhook do canal do Discord. */
export function getDiscordWebhookUrl(): string {
  return requiredEnv("DISCORD_WEBHOOK_URL", z.url());
}

// --- Opcionais -------------------------------------------------------------

/**
 * Cargo mencionado em Action Required / Breaking API Change. Opcional: valor inválido (não numérico)
 * vira aviso + ausência de menção, nunca derruba o sync.
 */
export function getDiscordAlertRoleId(): string | undefined {
  const raw = readRaw("DISCORD_ALERT_ROLE_ID");
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    console.warn("[env] DISCORD_ALERT_ROLE_ID inválida (deve ser um ID numérico); ignorada, sem menção a cargo");
    return undefined;
  }
  return raw;
}

/** Chave da Anthropic; ausente = sem resumo em pt-BR. */
export function getAnthropicApiKey(): string | undefined {
  return optionalEnv("ANTHROPIC_API_KEY", z.string());
}

/** Modelo do resumo; padrão claude-haiku-5-5. */
export function getAnthropicModel(): string {
  return optionalEnv("ANTHROPIC_MODEL", z.string()) ?? DEFAULT_ANTHROPIC_MODEL;
}

/** URL do feed RSS; padrão shopify.dev/changelog/feed.xml. */
export function getFeedUrl(): string {
  return optionalEnv("FEED_URL", z.url()) ?? DEFAULT_FEED_URL;
}

export const MIN_POSTS_PER_RUN = 1;
export const MAX_POSTS_PER_RUN_LIMIT = 10;

/**
 * Máximo de posts por execução do sync; padrão 5, limitado a 1..10. Opcional: valor inválido vira
 * aviso + padrão, nunca derruba o sync.
 */
export function getMaxPostsPerRun(): number {
  const raw = readRaw("MAX_POSTS_PER_RUN");
  if (raw === undefined) return DEFAULT_MAX_POSTS_PER_RUN;
  if (!/^\d+$/.test(raw)) {
    console.warn(`[env] MAX_POSTS_PER_RUN inválida; usando o padrão ${DEFAULT_MAX_POSTS_PER_RUN}`);
    return DEFAULT_MAX_POSTS_PER_RUN;
  }
  const n = Number(raw);
  return Math.min(Math.max(n, MIN_POSTS_PER_RUN), MAX_POSTS_PER_RUN_LIMIT);
}

/** `1` = dry run (loga payload, não posta, não marca sent). */
export function isDiscordDryRun(): boolean {
  return readRaw("DISCORD_DRY_RUN") === "1";
}

/** `ACTIVITY_NOTICES=0` desliga os avisos de acesso/início/deploy; qualquer outro valor (ou ausente) liga. */
export function isActivityNoticesEnabled(): boolean {
  return readRaw("ACTIVITY_NOTICES") !== "0";
}

/** URL pública do site (metadata/OG). */
export function getSiteUrl(): string | undefined {
  return optionalEnv("SITE_URL", z.url());
}
