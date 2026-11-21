/**
 * In-memory Octo SQL fake for RI-0021 deterministic + metamorphic suites.
 * Implements exactly the statement shapes the server emits (R15 discipline).
 */
export type Row = Record<string, unknown>;
export interface FakeStore {
  [table: string]: Row[];
}
export const newStore = (): FakeStore => ({
  runner_pairing: [],
  user_runner: [],
  runner_consent: [],
  activity: [],
  user_connector: [],
  workspace_member: [],
  ledger_event: [],
  connector_route: [],
});

const NOW = () => new Date().toISOString();

function splitValues(s: string): string[] {
  const out: string[] = [];
  let cur = "",
    depth = 0,
    inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          cur += "'";
          i++;
        } else inQ = false;
      }
      continue;
    }
    if (c === "'") {
      inQ = true;
      cur += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim());
}

function evalToken(t: string): unknown {
  t = t.trim();
  if (t === "NULL") return null;
  if (t === "now()") return NOW();
  if (t.startsWith("now() + interval"))
    return new Date(Date.now() + 600_000).toISOString();
  if (t.endsWith("::jsonb"))
    return JSON.parse(String(evalToken(t.slice(0, -7))));
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

const lits = (sql: string): string[] =>
  (sql.match(/'([^']*(?:''[^']*)*)'/g) ?? []).map((s) =>
    s.slice(1, -1).replace(/''/g, "'"),
  );

export function handleSql(store: FakeStore, sql: string): { rows: Row[] } {
  if (sql.includes("information_schema.tables")) {
    return {
      rows: [
        "workspace",
        "workspace_member",
        "ledger_event",
        "user_connector",
        "connector_route",
        "runner_pairing",
        "user_runner",
        "runner_consent",
      ].map((t) => ({ table_name: t })),
    };
  }
  const ins =
    /INSERT INTO ri_console\.(\w+)\s+\(([^)]+)\)\s+VALUES\s+\(([\s\S]*?)\)(\s+ON CONFLICT[\s\S]*)?$/.exec(
      sql,
    );
  if (ins) {
    const table = ins[1] as string;
    const cols = (ins[2] as string).split(",").map((c) => c.trim());
    const vals = splitValues(ins[3] as string).map(evalToken);
    const row: Row = {};
    cols.forEach((c, i) => {
      row[c] = vals[i];
    });
    if (!store[table]) store[table] = [];
    const rows = store[table] as Row[];
    const conflict = ins[4] ?? "";
    if (table === "runner_consent") {
      const ex = rows.find(
        (r) =>
          r.principal_id === row.principal_id && r.provider === row.provider,
      );
      if (ex) {
        ex.scopes = row.scopes;
        ex.granted_at = NOW();
        ex.revoked_at = /revoked_at = NULL/.test(conflict) ? null : NOW();
      } else rows.push(row);
    } else if (table === "activity") {
      const ex = rows.find((r) => r.id === row.id);
      if (ex) {
        ex.doc = row.doc;
        ex.updated_at = NOW();
      } else rows.push(row);
    } else if (table === "user_connector") {
      const ex = (store.user_connector ?? []).find(
        (r) =>
          r.principal_id === row.principal_id && r.provider === row.provider,
      );
      if (ex) {
        ex.status = row.status;
        ex.account_email = row.account_email ?? ex.account_email;
        ex.scopes = row.scopes;
        if (/access_token = NULL/.test(conflict)) {
          ex.access_token = null;
          ex.refresh_token = null;
          ex.expires_at = null;
        } else {
          ex.access_token = row.access_token ?? ex.access_token;
          ex.refresh_token = row.refresh_token ?? ex.refresh_token;
          ex.expires_at = row.expires_at ?? ex.expires_at;
        }
        if (row.status === "connected") ex.last_sync = NOW();
        ex.updated_at = NOW();
      } else rows.push(row);
    } else if (table === "ledger_event") {
      if (!rows.find((r) => r.id === row.id)) rows.push(row);
    } else rows.push(row);
    return { rows: [] };
  }
  if (
    sql.startsWith(
      "UPDATE ri_console.runner_pairing SET used_at = now() WHERE principal_id",
    )
  ) {
    const [p] = lits(sql);
    for (const r of store.runner_pairing ?? [])
      if (r.principal_id === p && r.used_at == null) r.used_at = NOW();
    return { rows: [] };
  }
  if (
    sql.startsWith(
      "UPDATE ri_console.runner_pairing SET used_at = now() WHERE code_hash",
    )
  ) {
    const [h] = lits(sql);
    const r = (store.runner_pairing ?? []).find(
      (x) =>
        x.code_hash === h &&
        x.used_at == null &&
        Date.parse(String(x.expires_at)) > Date.now(),
    );
    if (!r) return { rows: [] };
    r.used_at = NOW();
    return {
      rows: [
        {
          id: r.id,
          principal_id: r.principal_id,
          workspace_id: r.workspace_id,
        },
      ],
    };
  }
  if (sql.startsWith("UPDATE ri_console.user_runner SET last_seen_at")) {
    const [id] = lits(sql);
    const r = (store.user_runner ?? []).find((x) => x.id === id);
    if (r) {
      r.last_seen_at = NOW();
      r.updated_at = NOW();
    }
    return { rows: [] };
  }
  if (
    sql.startsWith(
      "UPDATE ri_console.user_runner SET pairing_status = 'revoked'",
    )
  ) {
    const m = /WHERE id = '([^']*)' AND principal_id = '([^']*)'/.exec(sql);
    const id = m?.[1] ?? "";
    const p = m?.[2] ?? "";
    const r = (store.user_runner ?? []).find(
      (x) => x.id === id && x.principal_id === p,
    );
    if (!r) return { rows: [] };
    r.pairing_status = "revoked";
    return { rows: [{ id: r.id }] };
  }
  if (sql.includes("FROM ri_console.user_runner WHERE token_hash")) {
    const [h] = lits(sql);
    return {
      rows: (store.user_runner ?? [])
        .filter((r) => r.token_hash === h)
        .slice(0, 1),
    };
  }
  if (sql.includes("FROM ri_console.user_runner WHERE principal_id")) {
    const [p] = lits(sql);
    return {
      rows: (store.user_runner ?? []).filter(
        (r) => r.principal_id === p && r.pairing_status === "paired",
      ),
    };
  }
  if (sql.includes("FROM ri_console.runner_consent")) {
    const ls = lits(sql);
    return {
      rows: (store.runner_consent ?? []).filter(
        (r) =>
          r.principal_id === ls[0] && (ls.length < 2 || r.provider === ls[1]),
      ),
    };
  }
  if (sql.includes("FROM ri_console.activity")) {
    const [p] = lits(sql);
    return { rows: (store.activity ?? []).filter((r) => r.principal_id === p) };
  }
  if (sql.includes("FROM ri_console.user_connector")) {
    const ls = lits(sql);
    return {
      rows: (store.user_connector ?? []).filter(
        (r) =>
          r.principal_id === ls[0] && (ls.length < 2 || r.provider === ls[1]),
      ),
    };
  }
  if (sql.includes("FROM ri_console.workspace_member")) {
    const [w, p] = lits(sql);
    const hit = (store.workspace_member ?? []).find(
      (r) =>
        r.workspace_id === w && r.principal_id === p && r.status === "active",
    );
    return { rows: hit ? [{ ok: 1 }] : [] };
  }
  if (sql.includes("FROM ri_console.connector_route")) {
    const ls = lits(sql);
    return {
      rows: (store.connector_route ?? []).filter(
        (r) =>
          r.principal_id === ls[0] && (ls.length < 2 || r.provider === ls[1]),
      ),
    };
  }
  return { rows: [] };
}

export function installFakeOcto(store: FakeStore, members: Row[]): void {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("/query")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { sql: string };
      return new Response(JSON.stringify(handleSql(store, body.sql)), {
        status: 200,
      });
    }
    if (/\/api\/workspaces\/[^/]+\/members$/.test(url)) {
      return new Response(JSON.stringify({ members }), { status: 200 });
    }
    if (url.endsWith("/api/workspaces")) {
      return new Response(
        JSON.stringify([
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            slug: "ws-test",
            name: "Test",
            role: "owner",
          },
        ]),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  };
}
