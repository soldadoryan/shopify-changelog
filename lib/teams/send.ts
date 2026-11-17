import type { TeamsPayload } from "./card";

// Envio ao Workflow do Teams. A URL (com a assinatura `sig=`) é segredo:
// nunca aparece em logs, resultados ou mensagens de erro.

export const DEFAULT_TEAMS_TIMEOUT_MS = 10_000;

export type TeamsSendResult = { kind: "ok" } | { kind: "dry_run" } | { kind: "failed"; error: string; status?: number };

export type TeamsSendOptions = {
  webhookUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
};

function describeError(err: unknown, secret: string): string {
  const name = err instanceof Error ? err.name : "Error";
  if (name === "TimeoutError" || name === "AbortError") return "timeout ao enviar ao Teams";
  const raw = err instanceof Error ? err.message : String(err);
  return `${name}: ${raw.split(secret).join("[webhook]")}`.slice(0, 300);
}

export async function sendTeamsWebhook(payload: TeamsPayload, options: TeamsSendOptions): Promise<TeamsSendResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  if (options.dryRun) {
    log(`[teams] dry run, payload não enviado: ${JSON.stringify(payload)}`);
    return { kind: "dry_run" };
  }

  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TEAMS_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: "failed", error: describeError(err, options.webhookUrl) };
  }

  // O Workflow responde 202 (aceito) sem corpo; qualquer 2xx conta como entregue.
  if (res.ok) return { kind: "ok" };
  return { kind: "failed", error: `Teams respondeu ${res.status}`, status: res.status };
}
