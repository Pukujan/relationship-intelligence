/**
 * Hybrid search over the workspace's Octo RAG index, server-side.
 *
 * The shared workspace index holds only promoted/shared source material
 * (private observations live in personal workspaces until approved), so a
 * workspace-key read here does not cross the per-person boundary. Matches are
 * evidence for the model, never canonical facts: they enter the prompt labelled
 * as search results with their locators.
 */
const BASE = (process.env.OCTO_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.OCTO_API_KEY ?? "";
const WS = process.env.OCTO_WORKSPACE_ID ?? "";

export interface RagMatch {
  text: string;
  locator: string;
}

export async function queryRag(query: string, limit = 4): Promise<RagMatch[]> {
  if (!BASE || !KEY || !WS) {
    console.warn("[rag] not configured: set OCTO_API_URL, OCTO_API_KEY, OCTO_WORKSPACE_ID");
    return [];
  }
  try {
    const response = await fetch(`${BASE}/api/rag/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: WS, query, limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`[rag] query answered ${response.status}`);
      return [];
    }
    const body = (await response.json()) as { matches?: unknown[] };
    return (body.matches ?? []).slice(0, limit).map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const text = String(item.text ?? item.content ?? item.chunk ?? item.snippet ?? "");
      const locator = String(item.locator ?? item.source ?? item.url ?? item.document ?? "");
      return { text: text.slice(0, 400), locator: locator.slice(0, 160) };
    }).filter((match) => match.text.length > 0);
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
