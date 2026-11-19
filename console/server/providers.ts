/**
 * Provider pool, model chooser, reasoning control, and rate-limit-aware routing.
 *
 * Three routes are configured from the environment (keys never leave the
 * server): Qwen/Alibaba (Token Plan), InferHub, and the WorkBuddy router reached
 * through Octo's vault proxy. Routing is explicit policy, not vendor preference:
 * a request may name a route, otherwise a per-tier default chain applies, and a
 * rate-limited or failing provider is skipped for a cooldown window instead of
 * burning retries against it.
 *
 * The ranking policy here is deliberately small and readable. The
 * inference-recommendation-engine package is the intended future advisor for
 * price/supply-weighted choices; this module keeps the adapter boundary it
 * expects (normalized routes, no credentials in the policy).
 */

export type Reasoning = "off" | "low" | "medium" | "high";
export type Tier = "ask" | "design";

export interface Provider {
  id: string;
  displayName: string;
  baseUrl: string;
  key: string;
  reasoning: "effort" | "thinking" | "none";
  seedModels: string[];
}

export interface Route {
  provider: Provider;
  model: string;
}

const env = process.env;

export const providers: Provider[] = ([
  {
    id: "qwen",
    displayName: "Qwen · Alibaba Cloud",
    baseUrl: (env.TOKEN_PLAN_BASE_URL ?? "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""),
    key: env.ALIBABA_API_KEY ?? env.TOKEN_PLAN_API_KEY ?? "",
    reasoning: "thinking",
    seedModels: ["qwen3.6-flash", "qwen3.7-plus", "qwen3.8-flash", "qwen4-max-preview", "deepseek-v4.1-flash"],
  },
  {
    id: "inferhub",
    displayName: "InferHub",
    baseUrl: (env.INFERHUB_BASE_URL ?? "https://api.inferhub.dev/v1").replace(/\/$/, ""),
    key: env.IINFERHUB_API_KEY ?? "",
    reasoning: "effort",
    seedModels: ["cb/deepseek-v4.1-flash-sg", "ali/qwen4-max", "ali/qwen3.8-omni-flash"],
  },
  {
    id: "workbuddy",
    displayName: "WorkBuddy router (Octo vault proxy)",
    baseUrl: (env.WORKBUDDY_BASE_URL ?? "https://octodb.design-bakery.com/api/vault/proxy/v1").replace(/\/$/, ""),
    key: env.WORKBUDDY_ROUTER_KEY ?? "",
    reasoning: "effort",
    seedModels: [],
  },
] as Provider[]).filter((provider) => Boolean(provider.key));

const cooldownUntil = new Map<string, number>();
const modelCache = new Map<string, { at: number; models: string[] }>();
const MODEL_CACHE_MS = 5 * 60_000;

export const markCooldown = (providerId: string, seconds = 30) => {
  cooldownUntil.set(providerId, Date.now() + seconds * 1000);
};

export const cooldowns = () =>
  Object.fromEntries(
    [...cooldownUntil.entries()]
      .filter(([, until]) => until > Date.now())
      .map(([id, until]) => [id, Math.ceil((until - Date.now()) / 1000)]),
  );

const available = (provider: Provider) => (cooldownUntil.get(provider.id) ?? 0) <= Date.now();

export async function listModels(): Promise<
  { provider: string; displayName: string; reasoning: string; models: string[]; cooledSeconds?: number }[]
> {
  const out = [];
  for (const provider of providers) {
    const cached = modelCache.get(provider.id);
    let models = cached && Date.now() - cached.at < MODEL_CACHE_MS ? cached.models : provider.seedModels;
    if (!cached || Date.now() - cached.at >= MODEL_CACHE_MS) {
      try {
        const response = await fetch(`${provider.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${provider.key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: { id?: string }[] };
          const ids = (body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
          if (ids.length) {
            models = ids;
            modelCache.set(provider.id, { at: Date.now(), models });
          }
        }
      } catch {
        // keep seed models; discovery is best-effort
      }
    }
    const cooled = cooldowns()[provider.id];
    out.push({
      provider: provider.id,
      displayName: provider.displayName,
      reasoning: provider.reasoning,
      models,
      ...(cooled ? { cooledSeconds: cooled } : {}),
    });
  }
  return out;
}

const POLICY: Record<Tier, [string, string][]> = {
  ask: [
    ["qwen", "qwen3.6-flash"],
    ["inferhub", "cb/deepseek-v4.1-flash-sg"],
    ["workbuddy", ""],
  ],
  design: [
    ["qwen", "qwen3.7-plus"],
    ["inferhub", "ali/qwen4-max"],
    ["workbuddy", ""],
  ],
};

/** Ordered candidates: explicit choice first, then the tier policy, skipping cooled providers. */
export function resolveRoute(requested: string | undefined, tier: Tier): Route[] {
  const chain: [string, string][] = [];
  if (requested && requested !== "auto") {
    const [providerId, ...rest] = requested.split("/");
    const model = rest.join("/");
    const provider = providers.find((p) => p.id === providerId);
    if (provider && model) chain.push([providerId, model]);
  }
  chain.push(...POLICY[tier]);
  const routes: Route[] = [];
  for (const [providerId, model] of chain) {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !available(provider)) continue;
    const chosen = model || provider.seedModels[0] || "";
    if (!chosen) continue;
    if (routes.some((r) => r.provider.id === provider.id && r.model === chosen)) continue;
    routes.push({ provider, model: chosen });
  }
  return routes;
}

export interface ChatOutcome {
  content?: string;
  status: number;
  retryAfterSeconds?: number;
  error?: string;
}

export async function chat(
  route: Route,
  system: string,
  user: string,
  reasoning: Reasoning,
  timeoutMs: number,
): Promise<ChatOutcome> {
  const body: Record<string, unknown> = {
    model: route.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (reasoning !== "off") {
    if (route.provider.reasoning === "effort") body.reasoning_effort = reasoning;
    if (route.provider.reasoning === "thinking") body.enable_thinking = true;
  } else if (route.provider.reasoning === "thinking") {
    body.enable_thinking = false;
  }
  try {
    const response = await fetch(`${route.provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${route.provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        status: response.status,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        error: `upstream ${response.status}`,
      };
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { status: 502, error: "empty model response" };
    // Some routes (WorkBuddy/codebuddy2api) fence their JSON in markdown.
    const unfenced = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return { status: 200, content: unfenced };
  } catch (error) {
    return { status: 502, error: error instanceof Error ? error.message : "network error" };
  }
}

export interface FailoverResult {
  content: string;
  provider: string;
  model: string;
  attempts: number;
  failovers: number;
}

/** Try candidates in order; back off within a provider, cool it down and move on on 429. */
export async function askWithFailover(
  routes: Route[],
  system: string,
  user: string,
  reasoning: Reasoning,
  timeoutMs: number,
): Promise<FailoverResult> {
  if (routes.length === 0) throw new Error("no available provider (all cooled or unconfigured)");
  let attempts = 0;
  let failovers = 0;
  let lastError = "no route tried";
  for (const route of routes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      const outcome = await chat(route, system, user, reasoning, timeoutMs);
      if (outcome.status === 200 && outcome.content) {
        return { content: outcome.content, provider: route.provider.id, model: route.model, attempts, failovers };
      }
      lastError = outcome.error ?? `upstream ${outcome.status}`;
      if (outcome.status === 429) {
        markCooldown(route.provider.id, outcome.retryAfterSeconds ?? 30);
        break;
      }
      if (outcome.status >= 500 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      break;
    }
    failovers++;
  }
  throw new Error(`model unavailable: ${lastError}`);
}
