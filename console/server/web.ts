/**
 * Live web research via TinyFish. Results are evidence candidates, never
 * canonical facts: they enter prompts labelled unverified until a human
 * approves them into the ledger. Missing key or upstream failure degrades to
 * an empty list so a turn never dies on search.
 */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

// A vault working key (an `octo_tmp_…` lease) wins: the search then goes
// through Octo's vault proxy and this server never holds TinyFish's own key.
const VAULT_KEY = process.env.TINYFISH_VAULT_KEY ?? "";
const VAULT_PROXY = (process.env.OCTO_VAULT_PROXY_URL ?? "https://octodb.design-bakery.com/api/vault/proxy").replace(/\/$/, "");
const KEY = VAULT_KEY || (process.env.TINYFISH_API_KEY ?? process.env.tinyfish_api_key ?? "");
const DIRECT = (process.env.TINYFISH_BASE_URL ?? "https://agent.tinyfish.ai").replace(/\/$/, "");
const BASE = VAULT_KEY ? `${VAULT_PROXY}/https://agent.tinyfish.ai` : DIRECT;

export async function webSearch(query: string, limit = 4): Promise<WebResult[]> {
  if (!KEY || !query.trim()) return [];
  try {
    const response = await fetch(
      `${BASE}/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { "X-API-Key": KEY }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: unknown[]; data?: unknown[] };
    const rows = body.results ?? body.data ?? [];
    return rows.slice(0, limit).map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        title: String(item.title ?? item.name ?? "").slice(0, 160),
        url: String(item.url ?? item.link ?? (item.site_name ? `https://${item.site_name}` : "")).slice(0, 300),
        snippet: String(item.snippet ?? item.content ?? item.description ?? "").slice(0, 400),
      };
    }).filter((r) => r.url || r.snippet);
  } catch {
    return [];
  }
}

export const webPromptBlock = (results: WebResult[]) =>
  results.length
    ? `\n\nWEB RESULTS (unverified until sourced — cite url, never treat as canonical):\n${results
        .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} [${r.url}]`)
        .join("\n")}`
    : "";
