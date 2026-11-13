import { getDiscordWebhookUrl, isDiscordDryRun } from "@/lib/env";
import type { ActivityPayload } from "@/lib/activity/types";
import type { DiscordPayload } from "./embed";

// Envio ao webhook do Discord. A URL do webhook é segredo:
// nunca aparece em logs, resultados ou mensagens de erro.

export const DEFAULT_SEND_TIMEOUT_MS = 20_000;

/** Respostas em que o Discord certamente não aceitou a mensagem. */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

export type RateLimitInfo = { remaining: number | null; resetAfterMs: number | null };

export type SendResult =
  | { kind: "ok"; messageId: string; rateLimit: RateLimitInfo }
  | { kind: "dry_run" }
  | { kind: "rate_limited"; retryAfterMs: number; global: boolean }
  | {
      kind: "failed";
      error: string;
      retryable: boolean;
      status?: number;
      /**
       * A requisição pode ter chegado ao Discord (timeout/abort ou erro de socket depois do envio):
       * a mensagem pode ter sido postada. Nunca retentar automaticamente (duplicata). Implica retryable=false.
       */
      ambiguous?: true;
    };

export type SendOptions = {
  webhookUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
};

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readRateLimit(headers: Headers): RateLimitInfo {
  const reset = parseNumber(headers.get("x-ratelimit-reset-after"));
  return {
    remaining: parseNumber(headers.get("x-ratelimit-remaining")),
    resetAfterMs: reset === null ? null : Math.ceil(reset * 1000),
  };
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Erros em que a conexão nunca foi estabelecida: o Discord não recebeu nada. */
const NOT_CONNECTED_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function collectCodes(err: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 4 || err === null || typeof err !== "object") return out;
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string") out.push(e.code);
  collectCodes(e.cause, depth + 1, out);
  if (Array.isArray(e.errors)) for (const inner of e.errors) collectCodes(inner, depth + 1, out);
  return out;
}

/**
 * true só quando é certo que a conexão não foi estabelecida (retentar é seguro). Qualquer outra falha
 * (timeout/abort, ECONNRESET, erro de socket, desconhecido) é ambígua: o POST pode ter sido processado.
 */
export function isNotConnectedError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return false;
  const codes = collectCodes(err);
  return codes.length > 0 && codes.every((c) => NOT_CONNECTED_CODES.has(c));
}

function describeError(err: unknown, secret: string): string {
  const name = err instanceof Error ? err.name : "Error";
  if (name === "TimeoutError" || name === "AbortError") return "timeout ao enviar ao Discord";
  const raw = err instanceof Error ? err.message : String(err);
  const message = secret === "" ? raw : raw.split(secret).join("[webhook]");
  return `${name}: ${message}`.slice(0, 300);
}

export async function sendDiscordWebhook(payload: DiscordPayload | ActivityPayload, options: SendOptions = {}): Promise<SendResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const dryRun = options.dryRun ?? isDiscordDryRun();
  if (dryRun) {
    log(`[discord] dry run, payload não enviado: ${JSON.stringify(payload)}`);
    return { kind: "dry_run" };
  }

  let webhookUrl: string;
  try {
    webhookUrl = options.webhookUrl ?? getDiscordWebhookUrl();
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : "webhook não configurado", retryable: false };
  }

  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return { kind: "failed", error: "DISCORD_WEBHOOK_URL inválida", retryable: false };
  }
  url.searchParams.set("wait", "true");

  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const error = describeError(err, webhookUrl);
    if (isNotConnectedError(err)) return { kind: "failed", error, retryable: true };
    return { kind: "failed", error, retryable: false, ambiguous: true };
  }

  if (res.status === 429) {
    const body = await readJson(res);
    const fromBody = typeof body?.retry_after === "number" ? body.retry_after : null;
    const seconds =
      fromBody ??
      parseNumber(res.headers.get("retry-after")) ??
      parseNumber(res.headers.get("x-ratelimit-reset-after")) ??
      1;
    return {
      kind: "rate_limited",
      retryAfterMs: Math.max(0, Math.ceil(seconds * 1000)),
      global: body?.global === true || res.headers.get("x-ratelimit-global") === "true",
    };
  }

  if (res.ok) {
    const body = await readJson(res);
    const id = body?.id;
    if (typeof id === "string" && id !== "") {
      return { kind: "ok", messageId: id, rateLimit: readRateLimit(res.headers) };
    }
    // Aceito mas sem id: o Discord provavelmente já postou; não retentar evita duplicata.
    return { kind: "failed", error: `resposta ${res.status} sem id de mensagem`, retryable: false, status: res.status };
  }

  const body = await readJson(res);
  const detail = typeof body?.message === "string" ? `: ${body.message}` : "";
  return {
    kind: "failed",
    error: `Discord respondeu ${res.status}${detail}`.slice(0, 300),
    retryable: RETRYABLE_STATUSES.has(res.status),
    status: res.status,
  };
}
