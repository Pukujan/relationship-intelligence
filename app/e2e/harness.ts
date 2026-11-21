/** RI-0021 e2e harness: sealed test sessions + live-Octo fixture discipline (R24). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealData } from "iron-session";

const here = path.dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(path.join(here, "../.env"), "utf8");
export const env: Record<string, string> = Object.fromEntries(
  envText.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
export const OCTO = { url: env.OCTO_API_URL, key: env.OCTO_API_KEY, ws: env.OCTO_WORKSPACE_ID };
export const PID_A = "0db36ada-53a3-454a-a18b-697220bb9cbc";
export const EMAIL_A = "pujan3645@gmail.com";
export const PID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const WS_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const TEST_PROVIDERS = ["slack", "calendly", "discord", "zoom", "linkedin", "luma", "wispr", "riley"];

export const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

export async function sql(query: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${OCTO.url}/api/workspaces/${OCTO.ws}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OCTO.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: query }),
  });
  if (!r.ok) throw new Error(`octo query ${r.status}`);
  const body = (await r.json()) as { rows?: Record<string, unknown>[] };
  return body.rows ?? [];
}

export async function cookieFor(pid: string, email: string): Promise<string> {
  const sealed = await sealData(
    { principalId: pid, email, authMode: "google", lastSeenAt: Date.now() },
    { password: env.SESSION_PASSWORD, ttl: 3600 },
  );
  return `ri_session=${sealed}`;
}

export async function seedFixtureB(): Promise<void> {
  await sql(`INSERT INTO ri_console.workspace (id, name, slug, kind, created_by) VALUES (${lit(WS_B)}, 'E2E Fixture', 'e2e-fixture', 'team', ${lit(PID_B)}) ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO ri_console.workspace_member (workspace_id, email, principal_id, display_name, role, status) VALUES (${lit(WS_B)}, ${lit(PID_B + "@test")}, ${lit(PID_B)}, 'Fixture B', 'owner', 'active') ON CONFLICT (workspace_id, email) DO NOTHING`);
}

export async function cleanup(startIso: string): Promise<void> {
  const pids = `(${lit(PID_A)}, ${lit(PID_B)})`;
  const provs = TEST_PROVIDERS.map((p) => lit(p)).join(", ");
  await sql(`DELETE FROM ri_console.user_runner WHERE principal_id IN ${pids}`);
  await sql(`DELETE FROM ri_console.runner_pairing WHERE principal_id IN ${pids}`);
  await sql(`DELETE FROM ri_console.runner_consent WHERE principal_id IN ${pids}`);
  await sql(`DELETE FROM ri_console.user_connector WHERE principal_id IN ${pids} AND provider IN (${provs})`);
  await sql(`DELETE FROM ri_console.connector_route WHERE principal_id IN ${pids} AND provider IN (${provs})`);
  for (const p of TEST_PROVIDERS) {
    await sql(`DELETE FROM ri_console.activity WHERE id LIKE ${lit(`sync-${PID_A}-${p}-%`)} OR principal_id = ${lit(PID_B)}`);
  }
  await sql(`DELETE FROM ri_console.ledger_event WHERE principal_id = ${lit(PID_B)} OR (principal_id = ${lit(PID_A)} AND event_type LIKE 'connector.%' AND created_at > ${lit(startIso)})`);
  await sql(`DELETE FROM ri_console.workspace_member WHERE workspace_id = ${lit(WS_B)}`);
  await sql(`DELETE FROM ri_console.workspace WHERE id = ${lit(WS_B)}`);
}
