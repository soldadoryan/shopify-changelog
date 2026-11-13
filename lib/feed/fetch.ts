import { getFeedUrl } from "@/lib/env";
import { FeedFetchError } from "./errors";

export const FEED_FETCH_TIMEOUT_MS = 15_000;
export const FEED_USER_AGENT = "shopify-changelog-notifier";

function isAbort(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Baixa o XML bruto do feed: sem cache, timeout de 15 s,
 * User-Agent fixo. Lança `FeedFetchError` em timeout, rede, status != 200 ou corpo vazio.
 */
export async function fetchFeed(url: string = getFeedUrl()): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": FEED_USER_AGENT },
    });
  } catch (error) {
    if (isAbort(error)) {
      throw new FeedFetchError("timeout", `Timeout ao buscar o feed (${FEED_FETCH_TIMEOUT_MS} ms)`, { cause: error });
    }
    throw new FeedFetchError("network", `Falha de rede ao buscar o feed: ${String(error)}`, { cause: error });
  }

  if (response.status !== 200) {
    throw new FeedFetchError("http", `Feed respondeu HTTP ${response.status}`, { status: response.status });
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw new FeedFetchError(isAbort(error) ? "timeout" : "network", `Falha ao ler o corpo do feed: ${String(error)}`, {
      cause: error,
    });
  }
  if (body.trim() === "") {
    throw new FeedFetchError("empty", "Feed retornou corpo vazio", { status: response.status });
  }
  return body;
}
