/**
 * Scheduled research jobs (RI-0016). Schedules are principal-private rows in
 * the workspace SQL surface; a 60s tick marks due schedules as queued runs.
 * Execution of queued runs is a later slice — this module owns cadence,
 * ownership, and the queue, not the research itself.
 */
import { randomUUID } from "node:crypto";
import type { OctoClientConfig } from "./octo.js";
import { octoSql } from "./world.js";

type Json = Record<string, unknown>;
const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

export const SCHEDULE_DDL = [
  `CREATE TABLE IF NOT EXISTS ri_console.schedule (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    cadence TEXT NOT NULL,
    scope_kind TEXT NOT NULL DEFAULT 'workspace',
    scope_id TEXT,
    prompt TEXT NOT NULL,
    paused BOOLEAN NOT NULL DEFAULT false,
    next_run_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.schedule_run (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    due_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export interface ScheduleCtx {
  config: OctoClientConfig;
  token: string;
  workspaceId: string;
  principalId: string;
}

const nextRun = (cadence: string, from = new Date()): string => {
  const d = new Date(from);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setFullYear(d.getFullYear() + 100); // once: far future after first run
  return d.toISOString();
};

export async function handleScheduleRoutes(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  ctx: ScheduleCtx,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/app-api/schedules")) return false;
  const send = (status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(payload);
  };
  const owns = `workspace_id = ${lit(ctx.workspaceId)} AND principal_id = ${lit(ctx.principalId)}`;
  try {
    if (path === "/app-api/schedules" && req.method === "GET") {
      const rows = await octoSql(
        ctx.config,
        ctx.token,
        ctx.workspaceId,
        `SELECT * FROM ri_console.schedule WHERE ${owns} ORDER BY next_run_at ASC`,
      );
      const runs = await octoSql(
        ctx.config,
        ctx.token,
        ctx.workspaceId,
        `SELECT r.* FROM ri_console.schedule_run r JOIN ri_console.schedule s ON s.id = r.schedule_id WHERE ${owns.replace(/workspace_id/g, "s.workspace_id").replace(/principal_id/g, "s.principal_id")} ORDER BY r.created_at DESC LIMIT 50`,
      );
      send(200, { schedules: rows, runs });
      return true;
    }
    if (path === "/app-api/schedules" && req.method === "POST") {
      const body = await readJson(req);
      const id = randomUUID();
      const cadence = ["daily", "weekly", "once"].includes(String(body.cadence))
        ? String(body.cadence)
        : "weekly";
      await octoSql(
        ctx.config,
        ctx.token,
        ctx.workspaceId,
        `INSERT INTO ri_console.schedule (id, workspace_id, principal_id, cadence, scope_kind, scope_id, prompt, next_run_at)
         VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)}, ${lit(cadence)}, ${lit(body.scopeKind ?? "workspace")}, ${lit(body.scopeId ?? "")}, ${lit(String(body.prompt ?? "").slice(0, 2000))}, ${lit(nextRun(cadence))})`,
      );
      send(200, { id });
      return true;
    }
    const m = path.match(/^\/app-api\/schedules\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (req.method === "PATCH") {
        const body = await readJson(req);
        await octoSql(
          ctx.config,
          ctx.token,
          ctx.workspaceId,
          `UPDATE ri_console.schedule SET paused = ${body.paused ? "true" : "false"} WHERE id = ${lit(id)} AND ${owns}`,
        );
        send(200, { id, paused: Boolean(body.paused) });
        return true;
      }
      if (req.method === "DELETE") {
        await octoSql(
          ctx.config,
          ctx.token,
          ctx.workspaceId,
          `DELETE FROM ri_console.schedule WHERE id = ${lit(id)} AND ${owns}`,
        );
        send(200, { id, deleted: true });
        return true;
      }
    }
  } catch (error) {
    send(502, {
      error: "SCHEDULE_FAILED",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return true;
  }
  return false;
}

const readJson = (req: import("node:http").IncomingMessage): Promise<Json> =>
  new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (c: Buffer) => {
      text += c.toString("utf8");
      if (text.length > 8192) reject(new Error("body too large"));
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

/** Mark due schedules as queued runs. Execution lands in a later slice. */
export function startScheduler(
  getCtx: () => Promise<ScheduleCtx | null>,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const ctx = await getCtx();
      if (!ctx) return;
      for (const statement of SCHEDULE_DDL)
        await octoSql(ctx.config, ctx.token, ctx.workspaceId, statement);
      const due = await octoSql(
        ctx.config,
        ctx.token,
        ctx.workspaceId,
        `SELECT id, cadence FROM ri_console.schedule
         WHERE workspace_id = ${lit(ctx.workspaceId)} AND paused = false AND next_run_at <= now()`,
      );
      for (const row of due) {
        await octoSql(
          ctx.config,
          ctx.token,
          ctx.workspaceId,
          `INSERT INTO ri_console.schedule_run (id, schedule_id, status, due_at)
           VALUES (${lit(randomUUID())}, ${lit(row.id)}, 'queued', now())`,
        );
        await octoSql(
          ctx.config,
          ctx.token,
          ctx.workspaceId,
          `UPDATE ri_console.schedule SET next_run_at = ${lit(nextRun(String(row.cadence)))} WHERE id = ${lit(row.id)}`,
        );
      }
      if (due.length)
        console.log(`scheduler: queued ${due.length} research run(s)`);
    } catch (error) {
      console.error(
        "scheduler tick failed:",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }, 60_000);
}
