/**
 * Shared checkpoint storage for the turn-state comparison (RI-0014 experiment).
 * Both implementations persist to the same Octo workspace table so "reload",
 * "redial" and "go back" are tested against real cross-process durability,
 * not an in-memory saver.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(here, "../../../.env"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = (env.OCTO_API_URL ?? "").replace(/\/$/, "");
const KEY = env.OCTO_API_KEY ?? "";
const WS = env.OCTO_WORKSPACE_ID ?? "";

export async function sql(statement, attempt = 0) {
  try {
    const r = await fetch(`${BASE}/api/workspaces/${WS}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: statement }),
      signal: AbortSignal.timeout(40000),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`octo sql ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body.rows ?? [];
  } catch (e) {
    if (attempt < 3) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      return sql(statement, attempt + 1);
    }
    throw e;
  }
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const LOCAL = process.env.COMPARE_LOCAL === "1";
const localRows = new Map();

export async function ensureTable() {
  if (LOCAL) return;
  await sql(`CREATE TABLE IF NOT EXISTS ri_console.turn_checkpoint (
    thread_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    seq BIGINT NOT NULL,
    checkpoint_id TEXT,
    parent_id TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, kind, seq)
  )`);
}

export async function putRow(threadId, kind, seq, checkpointId, parentId, payload) {
  if (LOCAL) {
    const key = threadId + "|" + kind;
    const list = localRows.get(key) ?? [];
    const i = list.findIndex((r) => r.seq === seq);
    const row = { seq, checkpoint_id: checkpointId ?? "", parent_id: parentId ?? "", payload };
    if (i >= 0) list[i] = row; else list.push(row);
    localRows.set(key, list);
    return;
  }
  await sql(`INSERT INTO ri_console.turn_checkpoint (thread_id, kind, seq, checkpoint_id, parent_id, payload)
    VALUES (${lit(threadId)}, ${lit(kind)}, ${seq}, ${lit(checkpointId ?? "")}, ${lit(parentId ?? "")}, ${lit(JSON.stringify(payload))}::jsonb)
    ON CONFLICT (thread_id, kind, seq) DO UPDATE SET payload = EXCLUDED.payload`);
}

export async function rows(threadId, kind) {
  if (LOCAL) return [...(localRows.get(threadId + "|" + kind) ?? [])].sort((a, b) => a.seq - b.seq);
  return sql(`SELECT seq, checkpoint_id, parent_id, payload FROM ri_console.turn_checkpoint
    WHERE thread_id = ${lit(threadId)} AND kind = ${lit(kind)} ORDER BY seq ASC`);
}

export async function nextSeq(threadId, kind) {
  if (LOCAL) return (localRows.get(threadId + "|" + kind) ?? []).length + 1;
  const r = await sql(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ri_console.turn_checkpoint
    WHERE thread_id = ${lit(threadId)} AND kind = ${lit(kind)}`);
  return Number(r[0]?.n ?? 1);
}
