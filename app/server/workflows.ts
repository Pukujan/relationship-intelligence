/**
 * Visual workflows (RI-0021 extension). An n8n-style node graph stored as JSON
 * in ri_console.workflow, executed server-side. Nodes compose outside-API
 * service calls (apiServices.ts), scheduled research jobs (schedules.ts shape),
 * copilot steps, conditions and logs. Runs are principal-private and recorded
 * in ri_console.workflow_run with per-node results.
 */
import { randomUUID } from "node:crypto";
import type { OctoClientConfig } from "./octo.js";
import { octoSql } from "./world.js";
import { tinyfishAgent, tinyfishFetch, tinyfishSearch, restRequest } from "./apiServices.js";
import { copilotTarget } from "./copilotProxy.js";
import { WORKFLOW_NODE_DEFS, type WorkflowNode, type WorkflowEdge } from "../shared/contracts.js";

type Json = Record<string, unknown>;
const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
const now = () => new Date().toISOString();

export const WORKFLOW_DDL = [
  `CREATE TABLE IF NOT EXISTS ri_console.workflow (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    graph_json TEXT NOT NULL,
    paused BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.workflow_run (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error TEXT,
    results_json TEXT NOT NULL DEFAULT '[]',
    log_json TEXT NOT NULL DEFAULT '[]'
  )`,
];

export interface WorkflowCtx {
  config: OctoClientConfig;
  token: string;
  workspaceId: string;
  octoContainerId: string;
  principalId: string;
  body?: Record<string, unknown>;
}

const ensured = new Set<string>();
async function ensureDdl(ctx: WorkflowCtx) {
  if (ensured.has(ctx.octoContainerId)) return;
  for (const s of WORKFLOW_DDL) await octoSql(ctx.config, ctx.token, ctx.octoContainerId, s);
  ensured.add(ctx.octoContainerId);
}

const nodeDef = (t: string) => WORKFLOW_NODE_DEFS.find((d) => d.type === t);

/* ---------------- templates ---------------- */

function getPath(obj: unknown, path: string): unknown {
  const parts = String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
const stringify = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v));
function resolveTemplate(value: unknown, ctx: Json): unknown {
  if (typeof value !== "string") return value;
  const whole = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (whole) return getPath(ctx, (whole[1] ?? "").trim());
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => stringify(getPath(ctx, String(e).trim())));
}
function resolveConfig(config: Json, ctx: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(config || {})) out[k] = resolveTemplate(v, ctx);
  return out;
}

/* ---------------- node execution ---------------- */

async function execNode(node: WorkflowNode, cfg: Json, ctx: Json, run: RunState, wfCtx: WorkflowCtx): Promise<unknown> {
  const sql = (q: string) => octoSql(wfCtx.config, wfCtx.token, wfCtx.octoContainerId, q);
  const owns = `workspace_id = ${lit(wfCtx.workspaceId)} AND principal_id = ${lit(wfCtx.principalId)}`;

  if (node.type.startsWith("trigger.")) return ctx.payload;

  switch (node.type) {
    case "action.api_service": {
      const rows = await sql(`SELECT * FROM ri_console.api_service WHERE id = ${lit(String(cfg.serviceId || ""))} AND ${owns}`);
      const row = rows[0] as any;
      if (!row) throw new Error("Select an attached API service in this node (Connectors → API services).");
      let cred: any = {};
      try { cred = JSON.parse(row.cred_json || "{}"); } catch { cred = {}; }
      if (row.provider === "tinyfish") {
        const op = String(cfg.operation || "agent");
        if (op === "fetch") return tinyfishFetch(cred.apiKey, { urls: (cfg.urls as string[]) || String(cfg.urls || ""), format: String(cfg.format || "markdown") });
        if (op === "search") return tinyfishSearch(cred.apiKey, { query: String(cfg.query || "") });
        return tinyfishAgent(cred.apiKey, {
          url: String(cfg.url || ""), goal: String(cfg.goal || ""),
          browserProfile: String(cfg.browserProfile || "lite"),
          outputSchema: cfg.outputSchema, maxDurationSeconds: Number(cfg.maxDurationSeconds) || 300,
        });
      }
      return restRequest({
        method: String(cfg.method || "GET"), url: String(cfg.url || ""),
        baseUrl: row.base_url, headers: cred.headers || {}, body: cfg.body,
        timeoutMs: Number(cfg.timeoutMs) || 30_000,
      });
    }
    case "action.schedule": {
      const id = randomUUID();
      const cadence = ["daily", "weekly", "once"].includes(String(cfg.cadence)) ? String(cfg.cadence) : "weekly";
      const d = new Date();
      if (cadence === "daily") d.setDate(d.getDate() + 1);
      else if (cadence === "weekly") d.setDate(d.getDate() + 7);
      else d.setFullYear(d.getFullYear() + 100);
      const prompt = String(cfg.prompt || "").slice(0, 2000);
      if (!prompt) throw new Error("Schedule node needs a prompt.");
      await sql(
        `INSERT INTO ri_console.schedule (id, workspace_id, principal_id, cadence, scope_kind, scope_id, prompt, next_run_at)
         VALUES (${lit(id)}, ${lit(wfCtx.workspaceId)}, ${lit(wfCtx.principalId)}, ${lit(cadence)}, ${lit(cfg.scopeKind ?? "workspace")}, ${lit(cfg.scopeId ?? "")}, ${lit(prompt)}, ${lit(d.toISOString())})`,
      );
      return { scheduleId: id, cadence, nextRunAt: d.toISOString() };
    }
    case "action.copilot": {
      const prompt = String(cfg.prompt || "");
      if (!prompt) throw new Error("Copilot node needs a prompt.");
      try {
        const res = await fetch(copilotTarget() + "/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], stream: false }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error("HTTP " + res.status);
        try {
          const j = JSON.parse(text);
          return { text: j.choices?.[0]?.message?.content ?? j.content ?? text.slice(0, 2000) };
        } catch {
          return { text: text.slice(0, 2000) };
        }
      } catch (e) {
        return { text: "[copilot unavailable] " + (e instanceof Error ? e.message : String(e)), note: "The copilot gateway did not answer; the rest of the workflow continued." };
      }
    }
    case "action.condition": {
      const left = cfg.left;
      const right = cfg.right;
      const op = String(cfg.operator || "eq");
      const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
      let result = false;
      switch (op) {
        case "eq": result = String(left ?? "") === String(right ?? ""); break;
        case "neq": result = String(left ?? "") !== String(right ?? ""); break;
        case "gt": result = num(left) > num(right); break;
        case "gte": result = num(left) >= num(right); break;
        case "lt": result = num(left) < num(right); break;
        case "lte": result = num(left) <= num(right); break;
        case "contains": result = stringify(left).toLowerCase().includes(String(right ?? "").toLowerCase()); break;
        case "truthy": result = left !== undefined && left !== null && left !== "" && left !== false && left !== 0 && !(Array.isArray(left) && !left.length) && !(typeof left === "object" && !Array.isArray(left) && !Object.keys(left as object).length); break;
        case "empty": result = left === undefined || left === null || left === "" || (Array.isArray(left) && !left.length); break;
      }
      return { __branch: result ? "true" : "false", result, value: left };
    }
    case "action.log": {
      const message = String(cfg.message || "");
      run.log.push({ at: now(), nodeId: node.id, message });
      return { logged: message };
    }
    default:
      throw new Error("Unknown node type: " + node.type);
  }
}

/* ---------------- graph walk ---------------- */

interface RunState {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  nodeResults: { nodeId: string; type: string; status: string; output?: unknown; error?: string | null }[];
  log: { at: string; nodeId: string; message: string }[];
}

const cap = (v: unknown): unknown => {
  try {
    const s = JSON.stringify(v);
    if (s && s.length > 60_000) return { __truncated: true, preview: s.slice(0, 60_000) };
  } catch {
    return { __unserializable: true, preview: String(v).slice(0, 2000) };
  }
  return v === undefined ? null : v;
};

async function persistRun(wfCtx: WorkflowCtx, run: RunState) {
  await octoSql(wfCtx.config, wfCtx.token, wfCtx.octoContainerId,
    `UPDATE ri_console.workflow_run SET status = ${lit(run.status)}, finished_at = ${run.finishedAt ? lit(run.finishedAt) : "NULL"}, error = ${run.error ? lit(run.error) : "NULL"}, results_json = ${lit(JSON.stringify(run.nodeResults))}, log_json = ${lit(JSON.stringify(run.log))} WHERE id = ${lit(run.id)}`);
}

async function executeGraph(wfCtx: WorkflowCtx, nodes: WorkflowNode[], edges: WorkflowEdge[], run: RunState, payload: Json) {
  const outputs: Record<string, unknown> = {};
  const executed = new Set<string>();
  const triggers = nodes.filter((n) => n.type.startsWith("trigger."));
  if (!triggers.length) throw new Error("Workflow has no trigger node.");
  const queue: { node: WorkflowNode; input: unknown }[] = triggers.map((node) => ({ node, input: payload }));
  let steps = 0;
  let anyError = false;

  while (queue.length) {
    if (++steps > 500) throw new Error("Execution stopped: more than 500 node steps (cycle?).");
    const { node, input } = queue.shift()!;
    if (executed.has(node.id)) continue;
    executed.add(node.id);
    const def = nodeDef(node.type);
    const result: RunState["nodeResults"][number] = { nodeId: node.id, type: node.type, status: "running", error: null };
    run.nodeResults.push(result);
    await persistRun(wfCtx, run);
    const ctx: Json = { input, payload, nodes: outputs, now: now() };
    try {
      if (!def) throw new Error("Unknown node type: " + node.type);
      const cfg = resolveConfig(node.config || {}, ctx);
      const output = await execNode(node, cfg, ctx, run, wfCtx);
      outputs[node.id] = output;
      result.status = "success";
      result.output = cap(output);
      await persistRun(wfCtx, run);
      const branch = output && typeof output === "object" ? (output as any).__branch : undefined;
      for (const edge of edges.filter((e) => e.source === node.id)) {
        if (def.outputs.length > 1 && (edge.sourceHandle || "out") !== branch) continue;
        const child = nodes.find((n) => n.id === edge.target);
        if (child && !executed.has(child.id)) queue.push({ node: child, input: outputs[node.id] });
      }
    } catch (e) {
      anyError = true;
      result.status = "error";
      result.error = e instanceof Error ? e.message : String(e);
      run.log.push({ at: now(), nodeId: node.id, message: "ERROR: " + result.error });
      await persistRun(wfCtx, run);
    }
  }
  return anyError;
}

export async function runWorkflow(wfCtx: WorkflowCtx, workflowId: string, trigger: string, payload: Json = {}): Promise<RunState> {
  const sql = (q: string) => octoSql(wfCtx.config, wfCtx.token, wfCtx.octoContainerId, q);
  const owns = `workspace_id = ${lit(wfCtx.workspaceId)} AND principal_id = ${lit(wfCtx.principalId)}`;
  const rows = await sql(`SELECT * FROM ri_console.workflow WHERE id = ${lit(workflowId)} AND ${owns}`);
  const wf = rows[0] as any;
  if (!wf) throw new Error("Workflow not found.");
  let graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
  try { graph = JSON.parse(wf.graph_json); } catch { throw new Error("Workflow graph is corrupt."); }
  const run: RunState = {
    id: randomUUID(), workflowId, workflowName: wf.name, trigger,
    status: "running", startedAt: now(), finishedAt: null, error: null, nodeResults: [], log: [],
  };
  await sql(
    `INSERT INTO ri_console.workflow_run (id, workflow_id, workspace_id, principal_id, trigger, status, results_json, log_json)
     VALUES (${lit(run.id)}, ${lit(workflowId)}, ${lit(wfCtx.workspaceId)}, ${lit(wfCtx.principalId)}, ${lit(trigger)}, 'running', '[]', '[]')`,
  );
  try {
    const triggerPayload = { trigger, at: now(), ...payload };
    const anyError = await executeGraph(wfCtx, graph.nodes || [], graph.edges || [], run, triggerPayload);
    run.status = anyError ? "error" : "success";
    if (anyError) run.error = run.nodeResults.find((r) => r.status === "error")?.error || "One or more nodes failed";
  } catch (e) {
    run.status = "error";
    run.error = e instanceof Error ? e.message : String(e);
  }
  run.finishedAt = now();
  await persistRun(wfCtx, run);
  return run;
}

/* ---------------- routes ---------------- */

const readJson = (req: import("node:http").IncomingMessage): Promise<Json> =>
  new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (c: Buffer) => { text += c.toString("utf8"); if (text.length > 1_000_000) reject(new Error("body too large")); });
    req.on("end", () => { try { resolve(text ? (JSON.parse(text) as Json) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });

const wfView = (row: any) => {
  let graph = { nodes: [], edges: [] };
  try { graph = JSON.parse(row.graph_json); } catch { /* empty */ }
  return {
    id: row.id, name: row.name, description: row.description || "",
    nodes: graph.nodes || [], edges: graph.edges || [], paused: Boolean(row.paused),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
};
const runView = (row: any) => ({
  id: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name || "", trigger: row.trigger,
  status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error,
  nodeResults: (() => { try { return JSON.parse(row.results_json); } catch { return []; } })(),
  log: (() => { try { return JSON.parse(row.log_json); } catch { return []; } })(),
});

export async function handleWorkflowRoutes(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  ctx: WorkflowCtx,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/app-api/workflows") && !path.startsWith("/app-api/workflow-runs")) return false;
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const owns = `workspace_id = ${lit(ctx.workspaceId)} AND principal_id = ${lit(ctx.principalId)}`;
  const sql = (q: string) => octoSql(ctx.config, ctx.token, ctx.octoContainerId, q);
  try {
    await ensureDdl(ctx);

    if (path === "/app-api/workflow-runs" && req.method === "GET") {
      const wfId = url.searchParams.get("workflowId");
      const rows = await sql(`SELECT r.*, w.name AS workflow_name FROM ri_console.workflow_run r JOIN ri_console.workflow w ON w.id = r.workflow_id WHERE r.workspace_id = ${lit(ctx.workspaceId)} AND r.principal_id = ${lit(ctx.principalId)}${wfId ? ` AND r.workflow_id = ${lit(wfId)}` : ""} ORDER BY r.started_at DESC LIMIT 50`);
      send(200, { runs: rows.map(runView) });
      return true;
    }
    const runMatch = path.match(/^\/app-api\/workflow-runs\/([^/]+)$/);
    if (runMatch && req.method === "GET") {
      const rows = await sql(`SELECT r.*, w.name AS workflow_name FROM ri_console.workflow_run r JOIN ri_console.workflow w ON w.id = r.workflow_id WHERE r.id = ${lit(runMatch[1] ?? "")} AND r.workspace_id = ${lit(ctx.workspaceId)} AND r.principal_id = ${lit(ctx.principalId)}`);
      if (!rows[0]) { send(404, { error: "NOT_FOUND" }); return true; }
      send(200, { run: runView(rows[0]) });
      return true;
    }

    if (path === "/app-api/workflows" && req.method === "GET") {
      const rows = await sql(`SELECT * FROM ri_console.workflow WHERE ${owns} ORDER BY updated_at DESC`);
      send(200, { workflows: rows.map(wfView) });
      return true;
    }
    if (path === "/app-api/workflows" && req.method === "POST") {
      const body = (ctx.body as Json | undefined) ?? (await readJson(req));
      const id = randomUUID();
      const name = String(body.name || "Untitled workflow").slice(0, 120);
      const graph = { nodes: body.nodes || [], edges: body.edges || [] };
      await sql(
        `INSERT INTO ri_console.workflow (id, workspace_id, principal_id, name, description, graph_json)
         VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)}, ${lit(name)}, ${lit(String(body.description || "").slice(0, 500))}, ${lit(JSON.stringify(graph))})`,
      );
      const rows = await sql(`SELECT * FROM ri_console.workflow WHERE id = ${lit(id)}`);
      send(200, { workflow: wfView(rows[0]) });
      return true;
    }

    const m = path.match(/^\/app-api\/workflows\/([^/]+)(\/run)?$/);
    if (m) {
      const id = m[1] ?? "";
      const action = m[2] || "";
      const rows = await sql(`SELECT * FROM ri_console.workflow WHERE id = ${lit(id)} AND ${owns}`);
      if (!rows[0]) { send(404, { error: "NOT_FOUND" }); return true; }
      const wfRow = rows[0] as any;
      if (req.method === "GET" && !action) {
        const runs = await sql(`SELECT * FROM ri_console.workflow_run WHERE workflow_id = ${lit(id)} AND ${owns} ORDER BY started_at DESC LIMIT 20`);
        send(200, { workflow: wfView(rows[0]), runs: runs.map(runView) });
        return true;
      }
      if (req.method === "PUT" && !action) {
        const body = (ctx.body as Json | undefined) ?? (await readJson(req));
        const graph = { nodes: body.nodes ?? JSON.parse(wfRow.graph_json).nodes, edges: body.edges ?? JSON.parse(wfRow.graph_json).edges };
        await sql(`UPDATE ri_console.workflow SET name = ${lit(String(body.name ?? rows[0].name).slice(0, 120))}, description = ${lit(String(body.description ?? rows[0].description).slice(0, 500))}, graph_json = ${lit(JSON.stringify(graph))}, paused = ${body.paused ? "true" : "false"}, updated_at = now() WHERE id = ${lit(id)} AND ${owns}`);
        const updated = await sql(`SELECT * FROM ri_console.workflow WHERE id = ${lit(id)}`);
        send(200, { workflow: wfView(updated[0]) });
        return true;
      }
      if (req.method === "DELETE" && !action) {
        await sql(`DELETE FROM ri_console.workflow WHERE id = ${lit(id)} AND ${owns}`);
        await sql(`DELETE FROM ri_console.workflow_run WHERE workflow_id = ${lit(id)} AND ${owns}`);
        send(200, { id, deleted: true });
        return true;
      }
      if (req.method === "POST" && action === "/run") {
        const body = (ctx.body as Json | undefined) ?? (await readJson(req));
        const run = await runWorkflow(ctx, id, "manual", (body.payload as Json) || {});
        send(200, { run: { ...run, workflowName: wfRow.name } });
        return true;
      }
    }
  } catch (error) {
    send(502, { error: "WORKFLOW_FAILED", detail: error instanceof Error ? error.message : "unknown" });
    return true;
  }
  return false;
}
