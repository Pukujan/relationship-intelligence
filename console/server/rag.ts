/**
 * Per-request RAG transport for the copilot server.
 *
 * The app adapter forwards a short-lived capability in the
 * `x-ri-rag-capability-forward` header of each proxied /api/* request. We
 * store it in AsyncLocalStorage so queryRag() keeps its two-argument signature
 * at its three call sites (server/index.ts:454,546,735); request handlers run
 * inside the ALS context installed in createServer below.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RagTransport {
  /** Origin of the signed-in app adapter, e.g. http://127.0.0.1:8787. */
  adapterBaseUrl: string;
  /** Short-lived sealed capability minted by the adapter for this request. */
  capability: string;
}

export const ragTransportStorage = new AsyncLocalStorage<RagTransport | null>();

/**
 * RAG retrieval for the copilot, server-side.
 *
 * No Octo credentials live here. queryRag() keeps its existing signature: it
 * calls a relative /app-api/rag/query endpoint on the same origin when the
 * adapter has attached a capability to this request, and otherwise falls back
 * to the labelled offline behaviour of returning no matches. The adapter owns
 * sign-in, calls Octo with the signed-in principal's token, and validates the
 * response with Zod before it reaches the prompt.
 */

export interface RagMatch {
  text: string;
  locator: string;
}

export async function queryRag(query: string, limit = 4): Promise<RagMatch[]> {
  const transport = ragTransportStorage.getStore();
  if (!transport) {
    console.warn("[rag] no signed-in adapter transport; skipping retrieval");
    return [];
  }
  // Same-origin relative URL in production (the app serves the console under
  // /console/); an explicit APP_ADAPTER_URL is used only for standalone dev.
  const url = new URL("/app-api/rag/query", transport.adapterBaseUrl);
  url.searchParams.set("q", query.slice(0, 2_000));
  url.searchParams.set("limit", String(limit));
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-ri-rag-capability": transport.capability },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`[rag] adapter query answered ${response.status}`);
      return [];
    }
    const body = (await response.json()) as { matches?: unknown[] };
    return (Array.isArray(body.matches) ? body.matches : []).flatMap((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const text = String(item.text ?? "").slice(0, 400);
      const locator = String(item.locator ?? "").slice(0, 160);
      return text ? [{ text, locator }] : [];
    });
  } catch (error) {
    console.warn("[rag] query failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

export const ragPromptBlock = (matches: RagMatch[]) =>
  matches.length
    ? `\n\nHYBRID SEARCH MATCHES (evidence, not canonical facts):\n${matches
        .map((match, index) => `${index + 1}. ${match.text}${match.locator ? ` [${match.locator}]` : ""}`)
        .join("\n")}`
    : "\n\nHYBRID SEARCH MATCHES: none — the workspace index is thin; say what is unverified instead of inventing it.";
