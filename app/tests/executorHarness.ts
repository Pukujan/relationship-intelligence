/**
 * Shared mock Octo + copilot harness for the RI-0022 executor suites.
 * Simulates the SQL surface's upsert/conflict semantics so idempotency
 * properties (MR-E1/E5) are tested against real conflict behavior.
 */
import { vi } from "vitest";
import type { WorldShape } from "../server/world.js";

export interface MockState {
  tables: Map<string, Map<string, Record<string, unknown>>>;
  ledger: Record<string, unknown>[];
  gmailCalls: string[];
  gmailStatus: number;
  copilotAnswer: unknown;
  copilotCalls: number;
  failStatements: { match: string; times: number }[];
  statements: string[];
  scheduleRuns: Record<string, unknown>[];
  connectorRows: Record<string, unknown>[];
  graphEntities: Record<string, unknown>[];
  graphClaims: Record<string, unknown>[];
  graphSubjects: Record<string, unknown>[];
  scheduleRunStatus: Map<string, string>;
}

export const createMock = (): MockState => ({
  tables: new Map(),
  ledger: [],
  gmailCalls: [],
  gmailStatus: 200,
  copilotAnswer: {
    summary: "mock run",
    findings: [],
    actions: [],
    dropped: 0,
    provider: "mock",
    model: "mock-model",
  },
  copilotCalls: 0,
  failStatements: [],
  statements: [],
  scheduleRuns: [],
  connectorRows: [],
  graphEntities: [],
  graphClaims: [],
  graphSubjects: [],
  scheduleRunStatus: new Map(),
});

const table = (state: MockState, name: string) => {
  let t = state.tables.get(name);
  if (!t) {
    t = new Map();
    state.tables.set(name, t);
  }
  return t;
};

export const putDoc = (
  state: MockState,
  tableName: string,
  doc: Record<string, unknown>,
  workspaceId = "ws-a",
  principalId = "p1",
  visibility = "shared",
) => {
  table(state, tableName).set(String(doc.id), {
    id: doc.id,
    workspace_id: workspaceId,
    principal_id: principalId,
    visibility,
    doc,
  });
};

const unescapeSql = (value: string) => value.replace(/''/g, "'");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const installMock = (state: MockState) => {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/agent-run")) {
      state.copilotCalls++;
      if (state.copilotAnswer instanceof Error) throw state.copilotAnswer;
      const staged = state.copilotAnswer as { __status?: number };
      if (staged && typeof staged.__status === "number") {
        return json({ error: "staged failure" }, staged.__status);
      }
      return json(state.copilotAnswer);
    }
    if (u.includes("gmail.googleapis.com")) {
      state.gmailCalls.push(String(init?.body ?? ""));
      return json({ id: "gm-1" }, state.gmailStatus);
    }
    if (u.includes("oauth2.googleapis.com/token")) {
      return json({ access_token: "refreshed-token", expires_in: 3600 });
    }
    if (u.includes("/api/graph/health")) {
      return json({ healthy: true, stale: false });
    }
    if (u.includes("/api/graph/query")) {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      if (query.includes("MATCH (e:Entity)"))
        return json({ rows: state.graphEntities });
      if (query.includes("MATCH (c:Claim) RETURN"))
        return json({ rows: state.graphClaims });
      if (query.includes("[:SUBJECT]"))
        return json({ rows: state.graphSubjects });
      return json({ rows: [] });
    }
    if (u.includes("/query")) {
      const { sql } = JSON.parse(String(init?.body ?? "{}")) as { sql: string };
      state.statements.push(sql);
      for (const f of state.failStatements) {
        if (f.times > 0 && sql.includes(f.match)) {
          f.times--;
          return json({ error: "injected failure" }, 502);
        }
      }
      if (
        sql.startsWith("CREATE TABLE") ||
        sql.includes("information_schema")
      ) {
        return json({ rows: [] });
      }
      if (sql.includes("INSERT INTO ri_console.ledger_event")) {
        state.ledger.push({ sql });
        return json({ rows: [] });
      }
      const insert = sql.match(
        /INSERT INTO ri_console\.(\w+) \(id, workspace_id, principal_id, visibility, doc\)\s*VALUES \('([^']*)', '([^']*)', '([^']*)', '([^']*)', '(.*)'::jsonb\)/s,
      );
      if (insert) {
        const [, tableName, id, ws, principal, visibility, docRaw] = insert;
        const t = table(state, tableName ?? "");
        if (sql.includes("DO NOTHING") && t.has(id ?? ""))
          return json({ rows: [] });
        t.set(id ?? "", {
          id,
          workspace_id: ws,
          principal_id: principal,
          visibility,
          doc: JSON.parse(unescapeSql(docRaw ?? "")),
        });
        return json({ rows: [] });
      }
      const updateDoc = sql.match(
        /UPDATE ri_console\.(\w+)\s*SET doc = '(.*)'::jsonb.*WHERE id = '([^']*)'/s,
      );
      if (updateDoc) {
        const [, tableName, docRaw, id] = updateDoc;
        const row = table(state, tableName ?? "").get(id ?? "");
        if (row) row.doc = JSON.parse(unescapeSql(docRaw ?? ""));
        return json({ rows: [] });
      }
      const updateStatus = sql.match(
        /UPDATE ri_console\.schedule_run SET status = '(\w+)' WHERE id = '([^']*)'/,
      );
      if (updateStatus) {
        state.scheduleRunStatus.set(
          updateStatus[2] ?? "",
          updateStatus[1] ?? "",
        );
        return json({ rows: [] });
      }
      if (sql.includes("UPDATE ri_console.user_connector")) {
        return json({ rows: [] });
      }
      if (sql.includes("FROM ri_console.schedule_run r JOIN")) {
        return json({ rows: state.scheduleRuns });
      }
      if (sql.includes("FROM ri_console.user_connector")) {
        return json({ rows: state.connectorRows });
      }
      const selectAgentById = sql.match(
        /SELECT doc FROM ri_console\.agent WHERE id = '([^']*)' AND workspace_id = '([^']*)'/,
      );
      if (selectAgentById) {
        const row = table(state, "agent").get(selectAgentById[1] ?? "");
        return json({
          rows: row && row.workspace_id === selectAgentById[2] ? [row] : [],
        });
      }
      const selectRunById = sql.match(
        /SELECT doc FROM ri_console\.agent_run WHERE id = '([^']*)' AND workspace_id = '([^']*)'/,
      );
      if (selectRunById) {
        const row = table(state, "agent_run").get(selectRunById[1] ?? "");
        return json({
          rows: row && row.workspace_id === selectRunById[2] ? [row] : [],
        });
      }
      const selectQueued = sql.match(
        /SELECT doc FROM ri_console\.agent_run\s*WHERE workspace_id = '([^']*)' AND doc->>'status' = 'queued'/,
      );
      if (selectQueued) {
        const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 10);
        const rows = [...table(state, "agent_run").values()]
          .filter(
            (r) =>
              r.workspace_id === selectQueued[1] &&
              (r.doc as Record<string, unknown>).status === "queued",
          )
          .sort((a, b) =>
            String((a.doc as Record<string, unknown>).dueAt).localeCompare(
              String((b.doc as Record<string, unknown>).dueAt),
            ),
          )
          .slice(0, limit);
        return json({ rows });
      }
      const selectByWs = sql.match(
        /SELECT doc FROM ri_console\.(\w+) WHERE workspace_id = '([^']*)'/,
      );
      if (selectByWs) {
        const rows = [...table(state, selectByWs[1] ?? "").values()].filter(
          (r) => r.workspace_id === selectByWs[2],
        );
        return json({ rows });
      }
      return json({ rows: [] });
    }
    return json({ rows: [] });
  });
};

export const makeWorld = (partial: Partial<WorldShape> = {}): WorldShape => ({
  organization: {},
  workspaces: [],
  projects: [],
  objectives: [],
  milestones: [],
  plans: [],
  agents: [],
  tasks: [],
  runs: [],
  approvals: [],
  activity: [],
  people: [],
  companies: [],
  events: [],
  folders: [],
  files: [],
  notes: [],
  retrospectives: [],
  connectors: [],
  mcpServers: [],
  plugins: [],
  smartLists: [],
  graphStale: false,
  generatedAt: new Date().toISOString(),
  ...partial,
});

export const CTX = {
  config: { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
  token: "tok",
  workspaceId: "ws-a",
  octoContainerId: "ws-a",
};

/** Safe doc accessor for mock rows (unknown -> Record, never throws). */
export const docOf = (
  row: { doc?: unknown } | undefined,
): Record<string, unknown> => (row?.doc ?? {}) as Record<string, unknown>;
