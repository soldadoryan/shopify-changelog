import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeedItem, StoredItem } from "@/lib/types";
import {
  feedItemToRow,
  rowToStoredItem,
  type ItemRow,
} from "@/lib/db/mapping";

export type InitialNotifyStatus = "pending" | "skipped";

export type KnownItem = { guid: string; slug: string; contentHash: string };

/**
 * Repositório usado por runSync. Existe como interface para
 * que run.test.ts use uma implementação em memória.
 */
export interface ItemsRepo {
  /** Lock global (RPC acquire_sync_lock). true = adquirido. */
  acquireLock(owner: string, ttlSeconds: number): Promise<boolean>;
  /** Libera o lock só se `owner` for o dono (RPC release_sync_lock). */
  releaseLock(owner: string): Promise<void>;

  /** sync_state.seeded_at != null */
  isSeeded(): Promise<boolean>;
  /** Grava sync_state.seeded_at = at (ISO). */
  markSeeded(at: string): Promise<void>;

  /** guid + slug + content_hash de TODOS os itens (para diff e colisão de slug). */
  listKnownItems(): Promise<KnownItem[]>;

  /**
   * Insere itens novos (em lotes), ignorando guids já existentes.
   * Retorna quantos foram de fato inseridos.
   */
  insertItems(items: FeedItem[], status: InitialNotifyStatus): Promise<number>;
  /**
   * Atualiza só conteúdo/derivados (nunca notify_status/attempts/notified_at).
   * Zera summary_pt/summary_model dos itens editados (pending/sending/failed e também sent: o resumo
   * antigo ficou desatualizado; skipped nunca teve resumo).
   * Retorna quantos foram atualizados.
   */
  updateEditedItems(items: FeedItem[]): Promise<number>;

  /** Reclama até `limit` itens (RPC claim_items_for_notify), do mais antigo ao mais novo. */
  claimForNotify(limit: number): Promise<StoredItem[]>;
  /** Persiste o resumo logo após gerar (retentativas não pagam de novo). */
  saveSummary(guid: string, summaryPt: string, model: string): Promise<void>;
  /** status='sent', notified_at, discord_message_id, last_error=null. messageId pode ser null. */
  markSent(guid: string, args: { messageId: string | null; notifiedAt: string }): Promise<void>;
  /** status='failed', last_error=error (truncado). */
  markFailed(guid: string, error: string): Promise<void>;
  /**
   * status='failed', last_error=error e notify_attempts=MAX_NOTIFY_ATTEMPTS: nunca mais reclamado
   * automaticamente (envio ambíguo: a mensagem pode ter sido postada). Requeue manual via SQL.
   */
  markFailedTerminal(guid: string, error: string): Promise<void>;
  /**
   * Devolve itens reclamados e não tentados para 'pending'. Por padrão
   * estorna a tentativa contada no claim (notify_attempts - 1, mín. 0).
   */
  returnToPending(guids: string[], opts?: { refundAttempt?: boolean }): Promise<void>;
  /** Itens que ainda serão notificados: pending, sending, ou failed com attempts < 5. */
  countRemaining(): Promise<number>;

  /** sync_state.last_error = error (last_run_at já é marcado pelo lock). */
  recordError(error: string): Promise<void>;
  /** sync_state.last_success_at = at, last_error = null. */
  recordSuccess(at: string): Promise<void>;
}

export const MAX_NOTIFY_ATTEMPTS = 5;
/** 811 linhas ≈ 2 MB; 100 por requisição fica ~250 KB, bem abaixo dos limites. */
export const UPSERT_CHUNK_SIZE = 100;
const UPDATE_CONCURRENCY = 8;
const MAX_ERROR_LENGTH = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fail(op: string, error: { message: string }): never {
  throw new Error(`Supabase ${op}: ${error.message}`);
}

function clip(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? text.slice(0, MAX_ERROR_LENGTH) : text;
}

export function createSupabaseItemsRepo(
  client: SupabaseClient = createServiceClient(),
): ItemsRepo {
  const items = () => client.from("changelog_items");
  const state = () => client.from("sync_state");

  return {
    async acquireLock(owner, ttlSeconds) {
      const { data, error } = await client.rpc("acquire_sync_lock", {
        p_owner: owner,
        p_ttl_seconds: ttlSeconds,
      });
      if (error) fail("acquire_sync_lock", error);
      return data === true;
    },

    async releaseLock(owner) {
      const { error } = await client.rpc("release_sync_lock", { p_owner: owner });
      if (error) fail("release_sync_lock", error);
    },

    async isSeeded() {
      const { data, error } = await state().select("seeded_at").eq("id", 1).single();
      if (error) fail("read sync_state", error);
      return data.seeded_at != null;
    },

    async markSeeded(at) {
      const { error } = await state().update({ seeded_at: at }).eq("id", 1);
      if (error) fail("mark seeded", error);
    },

    async listKnownItems() {
      const out: KnownItem[] = [];
      const page = 1000; // limite padrão do PostgREST
      for (let from = 0; ; from += page) {
        const { data, error } = await items()
          .select("guid, slug, content_hash")
          .order("guid", { ascending: true })
          .range(from, from + page - 1);
        if (error) fail("list items", error);
        for (const r of data) {
          out.push({ guid: r.guid, slug: r.slug, contentHash: r.content_hash });
        }
        if (data.length < page) break;
      }
      return out;
    },

    async insertItems(list, status) {
      let inserted = 0;
      for (const part of chunk(list, UPSERT_CHUNK_SIZE)) {
        const rows = part.map((i) => ({ ...feedItemToRow(i), notify_status: status }));
        const { data, error } = await items()
          .upsert(rows, { onConflict: "guid", ignoreDuplicates: true })
          .select("guid");
        if (error) fail("insert items", error);
        inserted += data.length;
      }
      return inserted;
    },

    async updateEditedItems(list) {
      let updated = 0;
      for (const part of chunk(list, UPDATE_CONCURRENCY)) {
        await Promise.all(
          part.map(async (item) => {
            const { guid, ...content } = feedItemToRow(item);
            const { data, error } = await items()
              .update(content)
              .eq("guid", guid)
              .select("guid");
            if (error) fail("update item", error);
            if (data.length === 0) return;
            updated += 1;
            // O resumo antigo ficou desatualizado (inclusive em itens já enviados).
            const reset = await items()
              .update({ summary_pt: null, summary_model: null })
              .eq("guid", guid)
              .in("notify_status", ["pending", "sending", "failed", "sent"]);
            if (reset.error) fail("reset summary", reset.error);
          }),
        );
      }
      return updated;
    },

    async claimForNotify(limit) {
      const { data, error } = await client.rpc("claim_items_for_notify", {
        p_limit: limit,
      });
      if (error) fail("claim_items_for_notify", error);
      return ((data ?? []) as ItemRow[]).map(rowToStoredItem);
    },

    async saveSummary(guid, summaryPt, model) {
      const { error } = await items()
        .update({ summary_pt: summaryPt, summary_model: model })
        .eq("guid", guid);
      if (error) fail("save summary", error);
    },

    async markSent(guid, { messageId, notifiedAt }) {
      const { error } = await items()
        .update({
          notify_status: "sent",
          notified_at: notifiedAt,
          discord_message_id: messageId,
          last_error: null,
        })
        .eq("guid", guid);
      if (error) fail("mark sent", error);
    },

    async markFailed(guid, message) {
      const { error } = await items()
        .update({ notify_status: "failed", last_error: clip(message) })
        .eq("guid", guid);
      if (error) fail("mark failed", error);
    },

    async markFailedTerminal(guid, message) {
      const { error } = await items()
        .update({ notify_status: "failed", notify_attempts: MAX_NOTIFY_ATTEMPTS, last_error: clip(message) })
        .eq("guid", guid);
      if (error) fail("mark failed terminal", error);
    },

    async returnToPending(guids, opts) {
      if (guids.length === 0) return;
      const refund = opts?.refundAttempt ?? true;
      if (!refund) {
        const { error } = await items()
          .update({ notify_status: "pending" })
          .in("guid", guids)
          .eq("notify_status", "sending");
        if (error) fail("return to pending", error);
        return;
      }
      const { data, error } = await items()
        .select("guid, notify_attempts")
        .in("guid", guids)
        .eq("notify_status", "sending");
      if (error) fail("read attempts", error);
      for (const r of data) {
        const res = await items()
          .update({
            notify_status: "pending",
            notify_attempts: Math.max(r.notify_attempts - 1, 0),
          })
          .eq("guid", r.guid)
          .eq("notify_status", "sending");
        if (res.error) fail("return to pending", res.error);
      }
    },

    async countRemaining() {
      const { count, error } = await items()
        .select("guid", { count: "exact", head: true })
        .or(
          `notify_status.in.(pending,sending),and(notify_status.eq.failed,notify_attempts.lt.${MAX_NOTIFY_ATTEMPTS})`,
        );
      if (error) fail("count remaining", error);
      return count ?? 0;
    },

    async recordError(message) {
      const { error } = await state().update({ last_error: clip(message) }).eq("id", 1);
      if (error) fail("record error", error);
    },

    async recordSuccess(at) {
      const { error } = await state()
        .update({ last_success_at: at, last_error: null })
        .eq("id", 1);
      if (error) fail("record success", error);
    },
  };
}
