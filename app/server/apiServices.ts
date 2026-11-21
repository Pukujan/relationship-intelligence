/**
 * Outside-API service connectors (RI-0021 extension). Unlike the personal
 * OAuth connectors, these attach arbitrary external APIs by key/header:
 *   - tinyfish: the TinyFish web-agent API (agent runs, fetch, search).
 *   - rest: any generic REST service (base URL + default auth headers).
 *
 * Credentials live server-side in ri_console.api_service and NEVER reach the
 * browser (list/test return masked views only). Rows are principal-private
 * within the workspace, mirroring schedules.ts ownership and tenancy choke.
 */
import { randomUUID } from "node:crypto";
import type { OctoClientConfig } from "./octo.js";
import { octoSql } from "./world.js";

type Json = Record<string, unknown>;
const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

export const API_SERVICE_DDL = [
  `CREATE TABLE IF NOT EXISTS ri_console.api_service (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    cred_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'needs_setup',
    last_test TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export interface ApiServiceCtx {
  config: OctoClientConfig;
  token: string;
  workspaceId: string;
  octoContainerId: string;
  principalId: string;
  body?: Record<string, unknown>;
}

const ensured = new Set<string>();
async function ensureDdl(ctx: ApiServiceCtx) {
  if (ensured.has(ctx.octoContainerId)) return;
  for (const statement of API_SERVICE_DDL)
    await octoSql(ctx.config, ctx.token, ctx.octoContainerId, statement);
  ensured.add(ctx.octoContainerId);
}

/* ---------------- external adapters ---------------- */

const TF_AGENT = "https://agent.tinyfish.ai";
const TF_FETCH = "https://api.fetch.tinyfish.ai";
const TF_SEARCH = "https://api.search.tinyfish.ai";

async function rawFetch(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; ok: boolean; data: unknown; text: string }> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  };
  if (opts.body !== undefined)
    init.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, ok: res.ok, data, text };
}

const errText = (data: unknown, text: string): string => {
  if (data && typeof data === "object") {
    const o = data as Record<string, any>;
    return (
      o.error?.message ||
      o.error?.code ||
      o.message ||
      JSON.stringify(data).slice(0, 300)
    );
  }
  return String(text || "").slice(0, 300);
};

export async function tinyfishWallet(apiKey: string) {
  return rawFetch(`${TF_AGENT}/v1/wallet`, {
    headers: { "X-API-Key": apiKey },
    timeoutMs: 20_000,
  });
}

export async function tinyfishAgent(
  apiKey: string,
  p: {
    url: string;
    goal: string;
    browserProfile?: string;
    outputSchema?: unknown;
    maxDurationSeconds?: number;
  },
) {
  if (!p.url || !p.goal)
    throw new Error("TinyFish agent needs a target URL and a goal.");
  const body: Json = {
    url: p.url,
    goal: p.goal,
    browser_profile: p.browserProfile === "stealth" ? "stealth" : "lite",
  };
  if (
    p.outputSchema &&
    typeof p.outputSchema === "object" &&
    Object.keys(p.outputSchema as object).length
  )
    body.output_schema = p.outputSchema;
  const max = Math.min(Number(p.maxDurationSeconds) || 300, 900);
  if (max > 0) body.agent_config = { max_duration_seconds: max };
  const r = await rawFetch(`${TF_AGENT}/v1/automation/run`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body,
    timeoutMs: (max + 90) * 1000,
  });
  if (!r.ok)
    throw new Error(
      `TinyFish run failed (HTTP ${r.status}): ${errText(r.data, r.text)}`,
    );
  const j = (r.data ?? {}) as Record<string, any>;
  if (j.error)
    throw new Error(
      "TinyFish run error: " +
        (j.error.message ||
          j.error.code ||
          JSON.stringify(j.error).slice(0, 300)),
    );
  if (j.status && j.status !== "COMPLETED")
    throw new Error(`TinyFish run ended with status ${j.status}`);
  return {
    runId: j.run_id,
    status: j.status,
    result: j.result,
    steps: j.num_of_steps,
  };
}

export async function tinyfishFetch(
  apiKey: string,
  p: { urls: string[] | string; format?: string },
) {
  const list = (
    Array.isArray(p.urls) ? p.urls : String(p.urls || "").split(/\n|,/)
  )
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!list.length) throw new Error("TinyFish fetch needs at least one URL.");
  const r = await rawFetch(`${TF_FETCH}/`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: {
      urls: list,
      format: p.format || "markdown",
      links: false,
      image_links: false,
    },
    timeoutMs: 120_000,
  });
  if (!r.ok)
    throw new Error(
      "TinyFish fetch failed (HTTP " +
        r.status +
        "): " +
        errText(r.data, r.text),
    );
  return r.data;
}

export async function tinyfishSearch(
  apiKey: string,
  p: { query: string; purpose?: string },
) {
  if (!p.query) throw new Error("TinyFish search needs a query.");
  const u = new URL(`${TF_SEARCH}/`);
  u.searchParams.set("query", p.query);
  if (p.purpose) u.searchParams.set("purpose", p.purpose);
  const r = await rawFetch(u.toString(), {
    headers: { "X-API-Key": apiKey },
    timeoutMs: 60_000,
  });
  if (!r.ok)
    throw new Error(
      "TinyFish search failed (HTTP " +
        r.status +
        "): " +
        errText(r.data, r.text),
    );
  return r.data;
}

export async function restRequest(p: {
  method?: string;
  url: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}) {
  let url = p.url || "";
  if (p.baseUrl && url.startsWith("/"))
    url = p.baseUrl.replace(/\/+$/, "") + url;
  if (!/^https?:\/\//i.test(url))
    throw new Error("REST request needs an absolute http(s) URL.");
  const headers = { ...(p.headers || {}) };
  let body: unknown;
  const method = (p.method || "GET").toUpperCase();
  if (
    p.body !== undefined &&
    p.body !== null &&
    p.body !== "" &&
    !["GET", "DELETE", "HEAD"].includes(method)
  ) {
    if (typeof p.body === "string") {
      try {
        body = JSON.parse(p.body);
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
      } catch {
        body = p.body;
        headers["Content-Type"] = headers["Content-Type"] || "text/plain";
      }
    } else {
      body = p.body;
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
  }
  const r = await rawFetch(url, {
    method,
    headers,
    body,
    timeoutMs: p.timeoutMs ?? 30_000,
  });
  if (!r.ok)
    throw new Error(`HTTP ${r.status} from ${url}: ${errText(r.data, r.text)}`);
  return { status: r.status, data: r.data };
}

/* ---------------- view / test ---------------- */

interface ServiceRow {
  id: string;
  provider: string;
  name: string;
  base_url: string;
  cred_json: string;
  status: string;
  last_test: string | null;
}

const parseCred = (row: ServiceRow): Record<string, any> => {
  try {
    return JSON.parse(row.cred_json || "{}");
  } catch {
    return {};
  }
};

const maskKey = (v: string) =>
  v && v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v ? "set" : "";

/** Browser-safe view: never carries the raw key or auth headers. */
export function serviceView(row: ServiceRow) {
  const cred = parseCred(row);
  let lastTest: unknown = null;
  try {
    lastTest = row.last_test ? JSON.parse(row.last_test) : null;
  } catch {
    lastTest = null;
  }
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    baseUrl: row.base_url || "",
    status: row.status,
    keyHint: row.provider === "tinyfish" ? maskKey(cred.apiKey || "") : "",
    hasHeaders:
      row.provider === "rest"
        ? Boolean(cred.headers && Object.keys(cred.headers).length)
        : false,
    lastTest,
  };
}

export async function testService(
  row: ServiceRow,
): Promise<{ ok: boolean; message: string }> {
  const cred = parseCred(row);
  try {
    if (row.provider === "tinyfish") {
      if (!cred.apiKey)
        return {
          ok: false,
          message:
            "No API key set. Add your X-API-Key from agent.tinyfish.ai → API Keys.",
        };
      const r = await tinyfishWallet(cred.apiKey);
      if (r.status === 401 || r.status === 403)
        return {
          ok: false,
          message: `TinyFish rejected the API key (HTTP ${r.status}).`,
        };
      if (!r.ok)
        return {
          ok: false,
          message:
            "TinyFish wallet check failed (HTTP " +
            r.status +
            "): " +
            errText(r.data, r.text),
        };
      const bal = (r.data as any)?.balance ?? (r.data as any)?.wallet?.balance;
      return {
        ok: true,
        message:
          "Connected to TinyFish ✓" +
          (bal !== undefined ? ` — wallet balance: ${bal}` : ""),
      };
    }
    if (row.provider === "rest") {
      const target = cred.testUrl || row.base_url;
      if (!target)
        return {
          ok: true,
          message: "Saved ✓ — no test URL set, so no request was made.",
        };
      const r = await rawFetch(target, {
        headers: cred.headers || {},
        timeoutMs: 20_000,
      });
      if (!r.ok)
        return {
          ok: false,
          message:
            "Test request failed (HTTP " +
            r.status +
            "): " +
            errText(r.data, r.text),
        };
      return {
        ok: true,
        message: `Test request succeeded ✓ (HTTP ${r.status})`,
      };
    }
    return { ok: false, message: `Unknown provider: ${row.provider}` };
  } catch (e) {
    return {
      ok: false,
      message:
        "Connection test error: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}

/* ---------------- routes ---------------- */

const readJson = (req: import("node:http").IncomingMessage): Promise<Json> =>
  new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (c: Buffer) => {
      text += c.toString("utf8");
      if (text.length > 65_536) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(text ? (JSON.parse(text) as Json) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });

export async function handleApiServiceRoutes(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  ctx: ApiServiceCtx,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/app-api/services")) return false;
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const owns = `workspace_id = ${lit(ctx.workspaceId)} AND principal_id = ${lit(ctx.principalId)}`;
  const sql = (q: string) =>
    octoSql(ctx.config, ctx.token, ctx.octoContainerId, q);
  try {
    await ensureDdl(ctx);

    if (path === "/app-api/services" && req.method === "GET") {
      const rows = (await sql(
        `SELECT * FROM ri_console.api_service WHERE ${owns} ORDER BY created_at ASC`,
      )) as unknown as ServiceRow[];
      send(200, { services: rows.map(serviceView) });
      return true;
    }

    if (path === "/app-api/services" && req.method === "POST") {
      const body = (ctx.body as Json | undefined) ?? (await readJson(req));
      const provider = String(body.provider || "");
      if (!["tinyfish", "rest"].includes(provider)) {
        send(400, {
          error: "BAD_PROVIDER",
          detail: "provider must be tinyfish or rest",
        });
        return true;
      }
      const id = randomUUID();
      const name = String(
        body.name ||
          (provider === "tinyfish" ? "TinyFish Web Agent" : "REST API"),
      ).slice(0, 120);
      const baseUrl = String(body.baseUrl || "").slice(0, 500);
      const cred: Json =
        provider === "tinyfish"
          ? { apiKey: String(body.apiKey || "") }
          : {
              headers: body.headers || {},
              testUrl: String(body.testUrl || ""),
            };
      const row: ServiceRow = {
        id,
        provider,
        name,
        base_url: baseUrl,
        cred_json: JSON.stringify(cred),
        status: "needs_setup",
        last_test: null,
      };
      const test = await testService(row);
      row.status = test.ok ? "connected" : "needs_setup";
      row.last_test = JSON.stringify({ ...test, at: new Date().toISOString() });
      await sql(
        `INSERT INTO ri_console.api_service (id, workspace_id, principal_id, provider, name, base_url, cred_json, status, last_test)
         VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)}, ${lit(provider)}, ${lit(name)}, ${lit(baseUrl)}, ${lit(row.cred_json)}, ${lit(row.status)}, ${lit(row.last_test)})`,
      );
      send(200, { service: serviceView(row) });
      return true;
    }

    const m = path.match(/^\/app-api\/services\/([^/]+)(\/test|\/run)?$/);
    if (m) {
      const id = m[1];
      const action = m[2] || "";
      const rows = (await sql(
        `SELECT * FROM ri_console.api_service WHERE id = ${lit(id)} AND ${owns}`,
      )) as unknown as ServiceRow[];
      const row = rows[0];
      if (!row) {
        send(404, { error: "NOT_FOUND" });
        return true;
      }
      if (req.method === "DELETE" && !action) {
        await sql(
          `DELETE FROM ri_console.api_service WHERE id = ${lit(id)} AND ${owns}`,
        );
        send(200, { id, deleted: true });
        return true;
      }
      if (req.method === "POST" && action === "/test") {
        const test = await testService(row);
        const status = test.ok ? "connected" : "needs_setup";
        const lastTest = JSON.stringify({
          ...test,
          at: new Date().toISOString(),
        });
        await sql(
          `UPDATE ri_console.api_service SET status = ${lit(status)}, last_test = ${lit(lastTest)} WHERE id = ${lit(id)} AND ${owns}`,
        );
        send(200, { test });
        return true;
      }
      if (req.method === "POST" && action === "/run") {
        const body = (ctx.body as Json | undefined) ?? (await readJson(req));
        const cred = parseCred(row);
        let result: unknown;
        if (row.provider === "tinyfish") {
          const op = String(body.operation || "agent");
          if (op === "fetch")
            result = await tinyfishFetch(cred.apiKey, {
              urls: body.urls as string[],
              format: String(body.format || "markdown"),
            });
          else if (op === "search") {
            const sp: { query: string; purpose?: string } = {
              query: String(body.query || ""),
            };
            if (body.goal) sp.purpose = String(body.goal);
            result = await tinyfishSearch(cred.apiKey, sp);
          } else
            result = await tinyfishAgent(cred.apiKey, {
              url: String(body.url || ""),
              goal: String(body.goal || ""),
              browserProfile: String(body.browserProfile || "lite"),
              outputSchema: body.outputSchema,
              maxDurationSeconds: Number(body.maxDurationSeconds) || 300,
            });
        } else {
          result = await restRequest({
            method: String(body.method || "GET"),
            url: String(body.url || ""),
            baseUrl: row.base_url,
            headers: cred.headers || {},
            body: body.body,
            timeoutMs: Number(body.timeoutMs) || 30_000,
          });
        }
        send(200, { result });
        return true;
      }
    }
  } catch (error) {
    send(502, {
      error: "SERVICE_FAILED",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return true;
  }
  return false;
}
