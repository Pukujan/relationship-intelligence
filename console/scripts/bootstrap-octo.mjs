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
 * inserted into a real workspace: projects, milestones and approvals start
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
  milestones: "mission", // persisted Octo table name; the console domain calls it milestone
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
  // RI-0010: persistent copilot conversations. Private by default; messages
  // carry validated parts, never raw model output.
  `CREATE TABLE IF NOT EXISTS ri_console.conversation (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    scope_kind TEXT NOT NULL DEFAULT 'workspace',
    scope_id TEXT,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ri_console.conversation(id),
    role TEXT NOT NULL,
    parts JSONB NOT NULL,
    provider TEXT,
    model TEXT,
    reasoning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS conversation_scope ON ri_console.conversation (workspace_id, principal_id)`,
  `CREATE INDEX IF NOT EXISTS message_conversation ON ri_console.message (conversation_id, created_at)`,
  // RI-0010 task C: the signed-in person's own profile. One row per principal
  // per workspace (the ledger has contact people, but no self entity). The doc
  // is principal-private: it is only ever read back through that principal's
  // token, never listed to the team.
  `CREATE TABLE IF NOT EXISTS ri_console.profile (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    doc JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, principal_id)
  )`,
  // Links from a file metadata row to canonical graph entities (person,
  // company, project, event, milestone). Links reference entities — they never
  // copy them. principal_id records who attached the link.
  `CREATE TABLE IF NOT EXISTS ri_console.file_link (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS file_link_file ON ri_console.file_link (workspace_id, file_id)`,
  `CREATE INDEX IF NOT EXISTS file_link_entity ON ri_console.file_link (entity_kind, entity_id)`,
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
console.log(
  `tables: ${DDL.filter((statement) => statement.startsWith("CREATE TABLE")).length} in schema ri_console`,
);
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
