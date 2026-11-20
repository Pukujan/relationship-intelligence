/**
 * Provider pool, model chooser, reasoning control, and rate-limit-aware routing.
 *
 * Routes are configured from the environment (keys never leave the server):
 * Qwen/Alibaba (Token Plan), InferHub, the WorkBuddy router, Anthropic and
 * OpenRouter's free models. Where a vault working key (`*_VAULT_KEY`, an
 * `octo_tmp_…` lease) is set, the vendor is reached through Octo's vault proxy
 * and this server never holds the vendor's own secret (#62). Routing is explicit
 * policy, not vendor preference: a request may name a route, otherwise a
 * per-tier chain applies (overridable with `COPILOT_CHAIN_ASK`,
 * `COPILOT_CHAIN_DESIGN` and `COPILOT_CHAIN_VOICE`), and a rate-limited or failing provider is skipped
 * for a cooldown window instead of burning retries against it.
 *
 * The ranking policy here is deliberately small and readable. The
 * inference-recommendation-engine package is the intended future advisor for
 * price/supply-weighted choices; this module keeps the adapter boundary it
 * expects (normalized routes, no credentials in the policy).
 */

export type Reasoning = "off" | "low" | "medium" | "high";
export type Tier = "ask" | "design" | "voice";

export interface Provider {
  id: string;
  displayName: string;
  baseUrl: string;
  key: string;
  reasoning: "effort" | "thinking" | "none";
  /** Recommended models: listed first in the menu and used when a chain names none. */
  seedModels: string[];
  /** How the key is sent. Defaults to `Authorization: Bearer`. */
  auth?: "bearer" | "x-api-key";
  /** False for vendors that reject OpenAI's `response_format: json_object`. */
  jsonMode?: boolean;
  /** False for vendors whose models reject a `temperature` setting. */
  temperature?: boolean;
  /** When set, only matching model ids are offered or routed. */
  allow?: RegExp;
}

export interface Route {
  provider: Provider;
  model: string;
}

const env = process.env;

/** Octo's vault proxy, path form: the upstream URL follows the proxy path. */
const VAULT_PROXY = (env.OCTO_VAULT_PROXY_URL ?? "https://octodb.design-bakery.com/api/vault/proxy").replace(/\/$/, "");
const viaVault = (upstream: string) => `${VAULT_PROXY}/${upstream}`;

export const authHeaders = (provider: Provider): Record<string, string> =>
  provider.auth === "x-api-key"
    ? { "x-api-key": provider.key }
    : { Authorization: `Bearer ${provider.key}` };

export const allowed = (provider: Provider, model: string) =>
  !provider.allow || provider.allow.test(model);

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
    // A vault working key wins; the raw key is the fallback for older setups.
    baseUrl: env.INFERHUB_VAULT_KEY
      ? viaVault("https://api.inferhub.dev/v1")
      : (env.INFERHUB_BASE_URL ?? "https://api.inferhub.dev/v1").replace(/\/$/, ""),
    key: env.INFERHUB_VAULT_KEY ?? env.IINFERHUB_API_KEY ?? "",
    reasoning: "effort",
    seedModels: ["cb/deepseek-v4.1-flash-sg", "ali/qwen4-max", "ali/qwen3.8-omni-flash"],
  },
  {
    id: "workbuddy",
    displayName: "WorkBuddy router (Octo vault proxy)",
    baseUrl: (env.WORKBUDDY_BASE_URL ?? "https://octodb.design-bakery.com/api/vault/proxy/v1").replace(/\/$/, ""),
    key: env.WORKBUDDY_ROUTER_KEY ?? "",
    reasoning: "effort",
    seedModels: ["hy4flash-free", "hy4flash", "deepseek-v4.1-flash-sg"],
  },
  {
    id: "anthropic",
    displayName: "Claude · Anthropic (Octo vault proxy)",
    baseUrl: viaVault("https://api.anthropic.com/v1"),
    key: env.ANTHROPIC_VAULT_KEY ?? "",
    reasoning: "none",
    seedModels: ["claude-haiku-5-5", "claude-sonnet-5-5"],
    auth: "x-api-key",
    jsonMode: false,
    temperature: false,
    // The owner's vault item allows Haiku and Sonnet only.
    allow: /haiku|sonnet/,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter free models (Octo vault proxy)",
    baseUrl: viaVault("https://openrouter.ai/api/v1"),
    key: env.OPENROUTER_VAULT_KEY ?? "",
    reasoning: "none",
    // The owner's rule: always an exact free model, never an auto-router.
    seedModels: ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free"],
    allow: /:free$/,
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
          headers: authHeaders(provider),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: { id?: string }[] };
          const ids = (body.data ?? [])
            .map((m) => String(m.id ?? ""))
            .filter((id) => id && allowed(provider, id));
          if (ids.length) {
            // Recommended models first, so a short menu shows the useful ones.
            const seeds = provider.seedModels.filter((seed) => ids.includes(seed));
            models = [...seeds, ...ids.filter((id) => !seeds.includes(id))];
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

type Chain = [string, string][];

/**
 * Default chains. `ask` is the everyday turn: a fast cheap model first, then
 * the free one. (The free model took 20 to 40 seconds on a full workspace
 * digest when tried on 2026-11-20, too slow to lead; put it first with
 * `COPILOT_CHAIN_ASK` if cost matters more than speed.) `design` is the harder
 * turn: a strong model first.
 */
const DEFAULT_POLICY: Record<Tier, Chain> = {
  ask: [
    ["qwen", "qwen3.6-flash"],
    ["workbuddy", "hy4flash-free"],
    ["inferhub", "cb/deepseek-v4.1-flash-sg"],
    ["anthropic", "claude-haiku-5-5"],
    ["openrouter", ""],
  ],
  design: [
    ["qwen", "qwen4-max-preview"],
    ["anthropic", "claude-sonnet-5-5"],
    ["inferhub", "ali/qwen4-max"],
    ["qwen", "qwen3.7-plus"],
    ["workbuddy", "hy4flash-free"],
  ],
  // A spoken turn: the reply is a sentence or two and the person is waiting
  // in silence, so the fastest model leads (Haiku answered in about 3.5 s
  // against 7 to 14 s for Qwen flash when tried on 2026-11-20).
  voice: [
    ["anthropic", "claude-haiku-5-5"],
    ["qwen", "qwen3.6-flash"],
    ["inferhub", "cb/deepseek-v4.1-flash-sg"],
    ["workbuddy", "hy4flash-free"],
  ],
};

/**
 * Parse `provider/model, provider/model, …`. A bare `provider` means that
 * provider's first recommended model. Model ids may contain slashes.
 */
export function parseChain(spec: string | undefined): Chain {
  if (!spec) return [];
  const chain: Chain = [];
  for (const raw of spec.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    const providerId = (slash === -1 ? entry : entry.slice(0, slash)).trim();
    const model = slash === -1 ? "" : entry.slice(slash + 1).trim();
    if (providerId) chain.push([providerId, model]);
  }
  return chain;
}

const fromEnv = (spec: string | undefined, fallback: Chain): Chain => {
  const parsed = parseChain(spec);
  return parsed.length ? parsed : fallback;
};

const POLICY: Record<Tier, Chain> = {
  ask: fromEnv(env.COPILOT_CHAIN_ASK, DEFAULT_POLICY.ask),
  design: fromEnv(env.COPILOT_CHAIN_DESIGN, DEFAULT_POLICY.design),
  voice: fromEnv(env.COPILOT_CHAIN_VOICE, DEFAULT_POLICY.voice),
};

/** The chains in force, for the health endpoint and the model menu. */
export const chains = () =>
  Object.fromEntries(
    (Object.keys(POLICY) as Tier[]).map((tier) => [
      tier,
      resolveRoute(undefined, tier).map((route) => `${route.provider.id}/${route.model}`),
    ]),
  );

/** Ordered candidates: explicit choice first, then the tier policy, skipping cooled providers. */
export function resolveRoute(requested: string | undefined, tier: Tier): Route[] {
  const chain: [string, string][] = [];
  if (requested && requested !== "auto") {
    const [providerId, ...rest] = requested.split("/");
    const model = rest.join("/");
    const provider = providers.find((p) => p.id === providerId);
    if (provider && model && allowed(provider, model)) chain.push([providerId, model]);
  }
  chain.push(...POLICY[tier]);
  const routes: Route[] = [];
  for (const [providerId, model] of chain) {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !available(provider)) continue;
    const chosen = model || provider.seedModels[0] || "";
    if (!chosen || !allowed(provider, chosen)) continue;
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
  signal?: AbortSignal,
): Promise<ChatOutcome> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // The prompts already demand JSON; this only adds the vendor's JSON mode
  // where the vendor accepts it.
  if (route.provider.jsonMode !== false) body.response_format = { type: "json_object" };
  if (route.provider.temperature !== false) body.temperature = 0.2;
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
        ...authHeaders(route.provider),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
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

/**
 * Try candidates in order; back off within a provider, cool it down and move
 * on on 429. `check` lets the caller reject an answer that arrived but does
 * not fit its schema: it throws, and the next route is tried instead of the
 * whole turn failing on one model's malformed reply.
 */
export async function askWithFailover(
  routes: Route[],
  system: string,
  user: string,
  reasoning: Reasoning,
  timeoutMs: number,
  signal?: AbortSignal,
  check?: (content: string) => void,
): Promise<FailoverResult> {
  if (routes.length === 0) throw new Error("no available provider (all cooled or unconfigured)");
  let attempts = 0;
  let failovers = 0;
  let lastError = "no route tried";
  for (const route of routes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      const outcome = await chat(route, system, user, reasoning, timeoutMs, signal);
      if (outcome.status === 200 && outcome.content) {
        try {
          check?.(outcome.content);
          return { content: outcome.content, provider: route.provider.id, model: route.model, attempts, failovers };
        } catch {
          lastError = `${route.provider.id}/${route.model} answered in the wrong shape`;
          break;
        }
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

/**
 * Parse a model's JSON answer. Some strong models wrap the one object they
 * were asked for in a single-element array; unwrap that instead of failing the
 * whole turn on a shape the schema check would reject.
 */
export function parseModelJson(content: string): unknown {
  const parsed: unknown = JSON.parse(content);
  if (
    Array.isArray(parsed) &&
    parsed.length === 1 &&
    parsed[0] !== null &&
    typeof parsed[0] === "object" &&
    !Array.isArray(parsed[0])
  ) {
    return parsed[0];
  }
  return parsed;
}
