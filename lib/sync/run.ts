import { MAX_NOTIFY_ATTEMPTS, type ItemsRepo } from "@/lib/db/items";
import { buildDiscordPayload, type DiscordPayload } from "@/lib/discord/embed";
import type { SendResult } from "@/lib/discord/send";
import type { SummaryResult } from "@/lib/summarize";
import { diffFeed } from "@/lib/sync/diff";
import type { FeedItem, StoredItem, SyncResult } from "@/lib/types";

/*
 * Orquestração do sync. Todos os efeitos colaterais chegam por `deps`.
 *
 * Máquina de estados de `notify_status` (ver também claim_items_for_notify no SQL):
 *   (novo, pós-seed)          -> pending
 *   (seed ou flood guard)     -> skipped                       (terminal; nunca postado)
 *   pending | failed(<5) | sending(stale >10min, <5) --claim--> sending   (attempts+1)
 *   sending --2xx com id / 2xx sem id--> sent                   (terminal)
 *   sending --500/502/503/504 ou conexão nunca estabelecida--> failed (lote interrompido)
 *   sending --timeout/socket após o envio (ambíguo)--> failed, attempts=5 (terminal; lote interrompido;
 *                                  last_error "ambiguous: ..."; a mensagem pode ter sido postada)
 *   sending --exceção ao preparar o item (resumo/payload)--> failed ("payload: ...", tentativa mantida;
 *                                  o lote continua)
 *   sending --4xx do item (400, 413...)--> failed               (lote continua)
 *   sending --401/403/404/webhook ausente--> pending (estorno)  (lote interrompido)
 *   sending --429 (longo ou repetido)--> pending (estorno)      (lote interrompido)
 *   sending --dry run--> pending (estorno)
 *   sending --sem tempo / não tentado--> pending (estorno)
 *   sending --processo morreu--> sending; reclamado após 10 min (única janela de duplicata)
 *   sending com attempts >= 5 e claim > 10 min --claim--> failed ("stale sending (attempts exhausted)")
 *   failed com attempts >= 5 fica parado (visível em last_error).
 */

export type SyncLogLevel = "info" | "warn" | "error";
export type SyncLogger = (level: SyncLogLevel, message: string) => void;

export type SyncConfig = {
  /** Itens reclamados por run (MAX_POSTS_PER_RUN). */
  maxPostsPerRun: number;
  /** DISCORD_ALERT_ROLE_ID. */
  alertRoleId: string | null;
  /** DISCORD_DRY_RUN: reclama, monta e loga o payload, devolve tudo para pending (estorno). */
  dryRun: boolean;
  /** TTL do lock global; maior que maxDuration (60 s) da rota. */
  lockTtlSeconds: number;
  /** Nenhuma notificação começa depois disto desde o início do run (= hardDeadlineMs - sendTimeoutMs). */
  notifyBudgetMs: number;
  /** Nenhuma operação externa (resumo, envio, espera) pode terminar depois disto. */
  hardDeadlineMs: number;
  /** Teto do resumo (corrida contra summarize). */
  summaryTimeoutMs: number;
  /** Timeout do POST ao Discord (o mesmo passado a sendDiscordWebhook). */
  sendTimeoutMs: number;
  /** Teto do espelhamento no Teams (corrida contra mirror). */
  mirrorTimeoutMs: number;
  /** 429 com retry_after até este valor: espera e tenta 1x. */
  maxRateLimitWaitMs: number;
  /** Mais itens novos que isto (pós-seed) -> inseridos como skipped. */
  floodThreshold: number;
};

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  maxPostsPerRun: 5,
  alertRoleId: null,
  dryRun: false,
  lockTtlSeconds: 120,
  notifyBudgetMs: 32_000,
  hardDeadlineMs: 52_000,
  summaryTimeoutMs: 20_000,
  sendTimeoutMs: 20_000,
  mirrorTimeoutMs: 10_000,
  maxRateLimitWaitMs: 5_000,
  floodThreshold: 50,
};

export type SyncDeps = {
  repo: ItemsRepo;
  fetchFeed: () => Promise<string>;
  parseFeed: (xml: string) => FeedItem[];
  send: (payload: DiscordPayload) => Promise<SendResult>;
  /**
   * Espelha no Teams um item que o Discord aceitou. Melhor esforço: lançar = falha só logada; nunca
   * altera notify_status. null/ausente = sem TEAMS_WEBHOOK_URL.
   */
  mirror?: ((item: StoredItem, summaryPt: string | null) => Promise<void>) | null;
  /** null = sem ANTHROPIC_API_KEY (sem resumo). */
  summarize: ((item: StoredItem) => Promise<SummaryResult | null>) | null;
  /** revalidateChangelog(); chamado quando algo foi inserido/atualizado. */
  revalidate: () => void;
  /** Relógio em ms (epoch). */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: SyncLogger;
  /** uuid do dono do lock. */
  createLockId: () => string;
  config?: Partial<SyncConfig>;
};

/** Status HTTP que indicam webhook inválido/apagado/sem permissão: problema de config, não do item. */
const WEBHOOK_CONFIG_STATUSES = new Set([401, 403, 404]);
const MARK_SENT_RETRY_DELAY_MS = 500;

function emptyResult(status: SyncResult["status"]): SyncResult {
  return { status, seeded: false, inserted: 0, updated: 0, posted: 0, failed: 0, remaining: 0 };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Resolve com o valor de `promise` ou `null` após `ms` (timer real; a promessa perdedora é abandonada). */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const cfg: SyncConfig = { ...DEFAULT_SYNC_CONFIG, ...deps.config };
  const { repo, log } = deps;
  const startedAt = deps.now();
  const owner = deps.createLockId();

  if (!(await repo.acquireLock(owner, cfg.lockTtlSeconds))) {
    log("info", "[sync] lock ocupado por outro run; nada a fazer");
    return emptyResult("locked");
  }

  try {
    return await syncLocked(deps, cfg, startedAt);
  } catch (err) {
    const message = errorMessage(err);
    log("error", `[sync] falhou: ${message}`);
    try {
      await repo.recordError(`sync falhou: ${message}`);
    } catch (recordErr) {
      log("error", `[sync] não gravou last_error: ${errorMessage(recordErr)}`);
    }
    throw err;
  } finally {
    try {
      await repo.releaseLock(owner);
    } catch (err) {
      // O TTL (120 s) libera sozinho.
      log("error", `[sync] falha ao liberar o lock: ${errorMessage(err)}`);
    }
  }
}

async function syncLocked(deps: SyncDeps, cfg: SyncConfig, startedAt: number): Promise<SyncResult> {
  const { repo, log } = deps;
  const isoNow = () => new Date(deps.now()).toISOString();

  // 2. Fetch + parse. Qualquer falha aqui não toca nos itens.
  let parsed: FeedItem[];
  try {
    const xml = await deps.fetchFeed();
    parsed = deps.parseFeed(xml);
    if (parsed.length === 0) throw new Error("feed sem itens");
  } catch (err) {
    const message = errorMessage(err);
    log("warn", `[sync] erro no feed: ${message}`);
    try {
      await repo.recordError(`feed: ${message}`);
    } catch (recordErr) {
      log("error", `[sync] não gravou last_error: ${errorMessage(recordErr)}`);
    }
    return emptyResult("feed_error");
  }

  // 3. Diff.
  const known = await repo.listKnownItems();
  const diff = diffFeed(known, parsed);
  if (diff.duplicates > 0) log("warn", `[sync] ${diff.duplicates} guid(s) repetido(s) no feed ignorado(s)`);

  const revalidateIfChanged = (inserted: number, updated: number) => {
    if (inserted + updated === 0) return;
    try {
      deps.revalidate();
    } catch (err) {
      log("warn", `[sync] revalidate falhou: ${errorMessage(err)}`);
    }
  };

  // 4. Seed: grava tudo como skipped, não posta. seeded_at só depois do insert, então um
  // seed interrompido é refeito (como skipped) no próximo run.
  if (!(await repo.isSeeded())) {
    const inserted = diff.toInsert.length > 0 ? await repo.insertItems(diff.toInsert, "skipped") : 0;
    const updated = diff.toUpdate.length > 0 ? await repo.updateEditedItems(diff.toUpdate) : 0;
    await repo.markSeeded(isoNow());
    revalidateIfChanged(inserted, updated);
    log("info", `[sync] seed: ${inserted} itens gravados como skipped`);
    await finish(deps, []);
    return { status: "ok", seeded: true, inserted, updated, posted: 0, failed: 0, remaining: await countRemaining(deps) };
  }

  // 5. Insert/update.
  const issues: string[] = [];
  const flood = diff.toInsert.length > cfg.floodThreshold;
  if (flood) {
    const msg = `flood guard: ${diff.toInsert.length} itens novos (> ${cfg.floodThreshold}) gravados como skipped`;
    log("warn", `[sync] ${msg}`);
    issues.push(msg);
  }
  const inserted = diff.toInsert.length > 0 ? await repo.insertItems(diff.toInsert, flood ? "skipped" : "pending") : 0;
  const updated = diff.toUpdate.length > 0 ? await repo.updateEditedItems(diff.toUpdate) : 0;
  revalidateIfChanged(inserted, updated);

  // 6. Notificar.
  const { posted, failed } = await notify(deps, cfg, startedAt, issues);

  // 7. Estado final.
  await finish(deps, issues);
  const remaining = await countRemaining(deps);
  log("info", `[sync] ok: inserted=${inserted} updated=${updated} posted=${posted} failed=${failed} remaining=${remaining}`);
  return { status: "ok", seeded: false, inserted, updated, posted, failed, remaining };
}

/** last_success_at sempre; last_error = problemas não fatais do run (flood guard, webhook inválido). */
async function finish(deps: SyncDeps, issues: string[]): Promise<void> {
  try {
    await deps.repo.recordSuccess(new Date(deps.now()).toISOString());
    if (issues.length > 0) await deps.repo.recordError(issues.join("; "));
  } catch (err) {
    deps.log("error", `[sync] não gravou sync_state: ${errorMessage(err)}`);
  }
}

async function countRemaining(deps: SyncDeps): Promise<number> {
  try {
    return await deps.repo.countRemaining();
  } catch (err) {
    deps.log("error", `[sync] countRemaining falhou: ${errorMessage(err)}`);
    return 0;
  }
}

async function notify(
  deps: SyncDeps,
  cfg: SyncConfig,
  startedAt: number,
  issues: string[],
): Promise<{ posted: number; failed: number }> {
  const { repo, log } = deps;
  const elapsed = () => deps.now() - startedAt;
  const isoNow = () => new Date(deps.now()).toISOString();

  if (elapsed() >= cfg.notifyBudgetMs) {
    log("warn", "[sync] sem tempo para notificar neste run");
    return { posted: 0, failed: 0 };
  }

  const claimed = await repo.claimForNotify(cfg.maxPostsPerRun);
  let posted = 0;
  let failed = 0;
  let dryRuns = 0;
  /** Itens com estado final gravado (sent/failed). */
  const finalized = new Set<string>();
  /** Item cujo POST pode ter chegado ao Discord e ainda não teve o estado final gravado. */
  let inFlight: string | null = null;

  const deliver = async (payload: DiscordPayload): Promise<SendResult> => {
    const first = await deps.send(payload);
    if (first.kind !== "rate_limited") return first;
    const wait = first.retryAfterMs;
    if (wait > cfg.maxRateLimitWaitMs || elapsed() + wait + cfg.sendTimeoutMs > cfg.hardDeadlineMs) return first;
    log("info", `[sync] 429 do Discord; aguardando ${wait} ms e tentando de novo`);
    await deps.sleep(wait);
    return deps.send(payload);
  };

  /** markSent é a escrita crítica (falhar = possível duplicata): uma retentativa. */
  const markSent = async (guid: string, messageId: string | null) => {
    const args = { messageId, notifiedAt: isoNow() };
    try {
      await repo.markSent(guid, args);
    } catch (err) {
      log("warn", `[sync] markSent falhou, tentando de novo: ${errorMessage(err)}`);
      await deps.sleep(MARK_SENT_RETRY_DELAY_MS);
      await repo.markSent(guid, args);
    }
  };

  /** Envio extra ao Teams depois do sent; nunca lança. */
  const mirror = async (item: StoredItem, summaryPt: string | null) => {
    if (!deps.mirror) return;
    if (elapsed() + cfg.mirrorTimeoutMs > cfg.hardDeadlineMs) {
      log("warn", `[sync] sem tempo para enviar ${item.guid} ao Teams; pulado`);
      return;
    }
    try {
      const done = await withTimeout(
        deps.mirror(item, summaryPt).then(() => true),
        cfg.mirrorTimeoutMs,
      );
      if (done === null) log("warn", `[sync] Teams: timeout ao enviar ${item.guid}`);
    } catch (err) {
      log("warn", `[sync] Teams: ${item.guid} não enviado: ${errorMessage(err)}`);
    }
  };

  /** Item cujo processamento lançou exceção (fora do envio): mantém a tentativa gasta. */
  let faulted: string | null = null;

  /** Processa um item reclamado. "stop" interrompe o lote; os itens restantes são estornados no finally. */
  const processItem = async (item: StoredItem, index: number): Promise<"next" | "stop"> => {
    // Sem tempo nem para o envio: adia (volta para pending com estorno).
    if (elapsed() + cfg.sendTimeoutMs > cfg.hardDeadlineMs) {
      log("info", `[sync] sem tempo para enviar ${item.guid}; adiado para o próximo run`);
      return "stop";
    }

    // a-b. Preparação: resumo + payload. Qualquer exceção aqui é do item (não do Discord): marca failed
    // mantendo a tentativa (senão o mesmo item envenenaria todo run) e segue para o próximo.
    let payload: DiscordPayload;
    let summaryPt = item.summaryPt;
    try {
      if (summaryPt === null && deps.summarize !== null) {
        if (elapsed() + cfg.summaryTimeoutMs + cfg.sendTimeoutMs > cfg.hardDeadlineMs) {
          log("info", `[sync] sem tempo para resumo de ${item.guid}; postando sem resumo`);
        } else {
          let summary: SummaryResult | null = null;
          try {
            summary = await withTimeout(deps.summarize(item), cfg.summaryTimeoutMs);
          } catch (err) {
            log("warn", `[sync] resumo falhou: ${errorMessage(err)}`);
          }
          if (summary === null) {
            log("info", `[sync] ${item.guid} segue sem resumo`);
          } else {
            summaryPt = summary.text;
            try {
              await repo.saveSummary(item.guid, summary.text, summary.model);
            } catch (err) {
              log("warn", `[sync] não salvou o resumo de ${item.guid}: ${errorMessage(err)}`);
            }
          }
        }
      }
      payload = buildDiscordPayload(item, { summaryPt, alertRoleId: cfg.alertRoleId });
    } catch (err) {
      const message = `payload: ${errorMessage(err)}`;
      log("error", `[sync] ${item.guid}: falha ao preparar o item; marcado como failed: ${message}`);
      await repo.markFailed(item.guid, message);
      finalized.add(item.guid);
      failed += 1;
      return "next";
    }

    // c. Envio.
    let res: SendResult;
    if (cfg.dryRun) {
      log("info", `[sync] dry run, payload não enviado: ${JSON.stringify(payload)}`);
      res = { kind: "dry_run" };
    } else {
      inFlight = item.guid;
      res = await deliver(payload);
    }

    // d-g. Resultado.
    if (res.kind === "ok") {
      await markSent(item.guid, res.messageId);
      finalized.add(item.guid);
      inFlight = null;
      posted += 1;
      await mirror(item, summaryPt);
      const { remaining, resetAfterMs } = res.rateLimit;
      const hasMore = index + 1 < claimed.length;
      if (hasMore && remaining === 0 && resetAfterMs !== null && resetAfterMs > 0) {
        if (elapsed() + resetAfterMs >= cfg.notifyBudgetMs) {
          log("info", `[sync] bucket do Discord esgotado (reset em ${resetAfterMs} ms); restante fica para o próximo run`);
          return "stop";
        }
        await deps.sleep(resetAfterMs);
      }
      return "next";
    }

    if (res.kind === "dry_run") {
      // Nada foi postado: volta para pending com estorno (no finally).
      inFlight = null;
      dryRuns += 1;
      return "next";
    }

    if (res.kind === "rate_limited") {
      inFlight = null;
      log("warn", `[sync] 429 do Discord (retry_after=${res.retryAfterMs} ms, global=${res.global}); lote interrompido`);
      return "stop";
    }

    // res.kind === "failed"
    if (res.status !== undefined && res.status >= 200 && res.status < 300) {
      // O Discord aceitou (2xx) mas não devolveu id: a mensagem foi postada. Marcar failed faria o
      // claim repostar. Fica sent sem message id.
      log("warn", `[sync] ${item.guid}: ${res.error}; marcado como sent sem message id`);
      await markSent(item.guid, null);
      finalized.add(item.guid);
      inFlight = null;
      posted += 1;
      await mirror(item, summaryPt);
      return "next";
    }

    if (res.ambiguous) {
      // O POST pode ter chegado ao Discord (timeout/socket depois do envio): retentar arriscaria duplicata.
      // Terminal (attempts = máx.), revisão manual; o lote para (Discord instável).
      const error = `ambiguous: ${res.error}`;
      const msg = `${item.guid}: envio ambíguo (a mensagem pode ter sido postada); não será retentado automaticamente`;
      log("error", `[sync] ${msg}: ${res.error}`);
      issues.push(`ambiguous: ${msg}`);
      try {
        await repo.markFailedTerminal(item.guid, error);
      } catch (err) {
        log("warn", `[sync] markFailedTerminal falhou, tentando de novo: ${errorMessage(err)}`);
        await deps.sleep(MARK_SENT_RETRY_DELAY_MS);
        await repo.markFailedTerminal(item.guid, error);
      }
      finalized.add(item.guid);
      inFlight = null;
      failed += 1;
      return "stop";
    }

    const isConfigError = !res.retryable && (res.status === undefined || WEBHOOK_CONFIG_STATUSES.has(res.status));
    if (isConfigError) {
      // Webhook ausente/inválido/apagado: afeta todos os itens. Não queima tentativas.
      inFlight = null;
      const msg = `Discord webhook: ${res.error}; lote interrompido`;
      log("error", `[sync] ${msg}`);
      issues.push(msg);
      return "stop";
    }

    await repo.markFailed(item.guid, res.error);
    finalized.add(item.guid);
    inFlight = null;
    failed += 1;
    const exhausted = item.notifyAttempts >= MAX_NOTIFY_ATTEMPTS ? " (tentativas esgotadas)" : "";
    log("warn", `[sync] ${item.guid} falhou${exhausted}: ${res.error}`);
    // Discord fora/instável: só o item da frente gasta tentativa; o resto espera o próximo run.
    return res.retryable ? "stop" : "next";
  };

  try {
    for (let index = 0; index < claimed.length; index++) {
      const item = claimed[index];

      if (elapsed() >= cfg.notifyBudgetMs) {
        log("info", `[sync] orçamento de tempo esgotado; ${claimed.length - index} item(ns) voltam para pending`);
        break;
      }

      let outcome: "next" | "stop";
      try {
        outcome = await processItem(item, index);
      } catch (err) {
        // Exceção inesperada (ex.: repo): se o POST não saiu, o item mantém a tentativa gasta.
        if (inFlight === null) faulted = item.guid;
        throw err;
      }
      if (outcome === "stop") break;
    }
  } finally {
    // Estorna só quem nunca foi alcançado. `faulted` volta para pending sem estorno; `inFlight` fica em sending.
    const leftovers = claimed
      .map((c) => c.guid)
      .filter((g) => !finalized.has(g) && g !== inFlight && g !== faulted);
    if (inFlight !== null) {
      log("error", `[sync] estado final de ${inFlight} não gravado; fica em sending até o reclaim (10 min)`);
    }
    if (leftovers.length > 0) {
      try {
        await repo.returnToPending(leftovers, { refundAttempt: true });
      } catch (err) {
        // Ficam em sending e são reclamados após 10 min.
        log("error", `[sync] returnToPending falhou: ${errorMessage(err)}`);
      }
    }
    if (faulted !== null) {
      try {
        await repo.returnToPending([faulted], { refundAttempt: false });
      } catch (err) {
        log("error", `[sync] returnToPending falhou: ${errorMessage(err)}`);
      }
    }
    if (dryRuns > 0) log("info", `[sync] dry run: ${dryRuns} payload(s) logado(s), itens devolvidos para pending`);
  }

  return { posted, failed };
}
