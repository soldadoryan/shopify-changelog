import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Cliente Supabase com a service role (ignora RLS). Somente servidor.
 * Singleton por processo; sem sessão/refresh de token; `fetch` do Next não
 * deve cachear (o cache é feito em lib/db/queries.ts via unstable_cache).
 */
export function createServiceClient(): SupabaseClient {
  if (!client) {
    client = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
  }
  return client;
}
