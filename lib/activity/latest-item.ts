import "server-only";
import { ITEM_COLUMNS, rowToStoredItem, type ItemRow } from "@/lib/db/mapping";
import { createServiceClient } from "@/lib/supabase/server";
import type { LatestItemSource } from "./replay";

/** Leitura direta (sem unstable_cache; roda fora de request). Somente SELECT. */
export const supabaseLatestItem: LatestItemSource = {
  async latest() {
    const { data, error } = await createServiceClient()
      .from("changelog_items")
      .select(ITEM_COLUMNS)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("consulta falhou");
    return data ? rowToStoredItem(data as unknown as ItemRow) : null;
  },
};
