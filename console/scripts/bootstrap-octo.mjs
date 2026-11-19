/**
 * Idempotent bootstrap of the console's operational tables in the Octo
 * workspace database, plus the shared configuration rows (agents, connectors,
 * MCP servers, plugins, smart lists).
 *
 * Runs with the workspace key because schema creation is an admin task. User
 * data paths never use this key: the adapter reads and writes with the signed
 * in principal's token, so Octo enforces memberships per person.
 *
 * Canonical people/companies/claims are NOT seeded here — they live in Octo's
 * epistemic ledger and are read through the graph projection. No demo work is
 * inserted into a real workspace: projects, missions and approvals start
 * empty and are created through the approval gate.
 *
 *   node scripts/bootstrap-octo.mjs            # dry run
 *   node scripts/bootstrap-octo.mjs --apply    # create tables + config rows
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedWorld } from "../src/data/seed.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
};
const env = {
  ...readEnv(path.join(here, "../../.env")),
  ...readEnv(path.join(here, "../.env")),
  ...process.env,
};
const BASE = (env.OCTO_API_URL ?? "").replace(/\/$/, "");
const KEY = env.OCTO_API_KEY ?? "";
const WS = env.OCTO_WORKSPACE_ID ?? "";
const APPLY = process.argv.includes("--apply");
if (!BASE || !KEY || !WS) {
  console.error("set OCTO_API_URL, OCTO_API_KEY, OCTO_WORKSPACE_ID (root .env)");
  process.exit(1);
}

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function sql(statement) {
  const response = await fetch(`${BASE}/api/workspaces/${WS}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: statement }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Octo SQL ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** collection name in World -> table in ri_console */
export const TABLES = {
  agents: "agent",
  tasks: "agent_task",
  runs: "agent_run",
  approvals: "approval",
  activity: "activity",
  projects: "project",
  objectives: "objective",
  missions: "mission",
  plans: "plan",
  connectors: "connector",
  mcpServers: "mcp_server",
  plugins: "plugin",
  folders: "folder",
  files: "file_doc",
  notes: "note",
  retrospectives: "retrospective",
  smartLists: "smart_list",
};

const DDL = [
  "CREATE SCHEMA IF NOT EXISTS ri_console",
  ...Object.values(TABLES).map(
    (table) => `CREATE TABLE IF NOT EXISTS ri_console.${table} (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      principal_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'shared',
      doc JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ),
  ...Object.values(TABLES).map(
    (table) =>
      `CREATE INDEX IF NOT EXISTS ${table}_scope ON ri_console.${table} (workspace_id, visibility)`,
  ),
];

/** Configuration only. No people, no work, no approvals: those are canonical or gated. */
const CONFIG_COLLECTIONS = ["agents", "connectors", "mcpServers", "plugins", "smartLists"];

const rows = [];
for (const collection of CONFIG_COLLECTIONS) {
  for (const item of seedWorld[collection]) {
    rows.push({ table: TABLES[collection], id: item.id, doc: item });
  }
}

console.log(`workspace ${WS}`);
console.log(`tables: ${Object.values(TABLES).length} in schema ri_console`);
console.log(`config rows: ${rows.length} (${CONFIG_COLLECTIONS.join(", ")})`);
if (!APPLY) {
  console.log("dry run — pass --apply to write");
  process.exit(0);
}

for (const statement of DDL) await sql(statement);
console.log("schema ready");
let inserted = 0;
for (const row of rows) {
  const result = await sql(
    `INSERT INTO ri_console.${row.table} (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(row.id)}, ${lit(WS)}, NULL, 'shared', ${lit(JSON.stringify(row.doc))}::jsonb)
     ON CONFLICT (id) DO NOTHING`,
  );
  inserted += result.rowCount ?? 0;
}
console.log(`config rows inserted: ${inserted} (existing rows left untouched)`);
