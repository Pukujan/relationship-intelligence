/**
 * Local runner daemon contract (RI-0021 §3 + §8). Device routes authenticate
 * by bearer device token via resolveDevice (R1); principal scoping always
 * comes from the device row, never the body. Session routes go through the
 * resolveTenancy choke. Pairing claims are a single atomic UPDATE (R2).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { ConnectorRouteRecord } from "./connectors.js";
import { CONNECTOR_CATALOG, saveUserConnector } from "./connectors.js";
import type { Env } from "./env.js";
import { lit, safeText } from "./sql.js";
import { matchConnectorRoute } from "./sync.js";
import { appendLedgerEvent } from "./telemetry.js";
import { resolveTenancy } from "./tenancy.js";
import { octoSql } from "./world.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const LOCAL_PROVIDERS = ["linkedin", "luma", "wispr", "riley"] as const;
type LocalProvider = (typeof LOCAL_PROVIDERS)[number];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {}
function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let text = "";
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      text += c.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

const cfg = (env: Env) => ({ baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 });
const ownerToken = (env: Env) => env.OCTO_API_KEY ?? "";
const container = (env: Env) => (env.OCTO_WORKSPACE_ID ?? "").trim();

export interface DeviceIdentity {
  deviceId: string;
  principalId: string;
  workspaceId: string;
}

async function resolveDevice(
  req: IncomingMessage,
  env: Env,
): Promise<DeviceIdentity | { error: string }> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.length > 128) return { error: "INVALID_DEVICE_TOKEN" };
  const rows = await octoSql(
    cfg(env),
    ownerToken(env),
    container(env),
    `SELECT id, principal_id, workspace_id, pairing_status FROM ri_console.user_runner WHERE token_hash = ${lit(sha(token))} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return { error: "INVALID_DEVICE_TOKEN" };
  if (row.pairing_status !== "paired") return { error: "DEVICE_REVOKED" };
  return {
    deviceId: String(row.id),
    principalId: String(row.principal_id),
    workspaceId: String(row.workspace_id),
  };
}

const claimAttempts = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = claimAttempts.get(ip);
  if (!e || now > e.reset) {
    claimAttempts.set(ip, { n: 1, reset: now + 600_000 });
    return false;
  }
  e.n += 1;
  return e.n > 10;
}

function normalizeCode(raw: string): string | null {
  const up = raw.trim().toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(up) ? up : null;
}
function genCode(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => CROCKFORD[x % 32]).join("");
}

const ClaimSchema = z.object({
  code: z.string().min(8).max(16),
  deviceLabel: z.string().trim().min(1).max(80).refine(safeText(80)),
});
const SessionStatusSchema = z.object({
  provider: z.enum(["linkedin", "luma"]),
  ok: z.boolean(),
  accountHint: z.string().max(120).refine(safeText(120)).optional(),
});
const ConsentSchema = z.object({
  provider: z.enum(LOCAL_PROVIDERS),
  scopes: z.array(z.string().max(60)).max(10),
  granted: z.boolean(),
});
const ItemSchema = z.object({
  externalId: z.string().min(1).max(120).refine(safeText(120)),
  title: z.string().min(1).max(200).refine(safeText(200)),
  detail: z.string().max(2000).refine(safeText(2000)).default(""),
  occurredAt: z.string().datetime(),
  matchText: z.string().max(2000).refine(safeText(2000)).default(""),
  url: z.string().max(500).optional(),
  scope: z.string().max(60),
});
const IngestSchema = z.object({
  provider: z.enum(LOCAL_PROVIDERS),
  items: z.array(ItemSchema).min(1).max(50),
});
const RevokeSchema = z.object({ deviceId: z.string().uuid() });

function catalogScopes(provider: LocalProvider): string[] {
  return CONNECTOR_CATALOG.find((c) => c.provider === provider)?.scopes ?? [];
}

async function consentRow(env: Env, principalId: string, provider: string) {
  const rows = await octoSql(
    cfg(env),
    ownerToken(env),
    container(env),
    `SELECT scopes, revoked_at FROM ri_console.runner_consent WHERE principal_id = ${lit(principalId)} AND provider = ${lit(provider)} LIMIT 1`,
  );
  const row = rows[0];
  if (!row || row.revoked_at !== null) return null;
  return { scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [] };
}

export async function handleRunnerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  env: Env,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/app-api/connectors/runner/")) return false;
  if (!ownerToken(env) || !container(env)) {
    sendJson(res, 503, { error: "OCTO_NOT_CONFIGURED" });
    return true;
  }
  const config = cfg(env);
  const token = ownerToken(env);
  const octo = container(env);
  try {
    if (path === "/app-api/connectors/runner/pair" && req.method === "POST") {
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        sendJson(res, tenancy.status, tenancy.body);
        return true;
      }
      const pid = tenancy.principal.id;
      await octoSql(
        config,
        token,
        octo,
        `UPDATE ri_console.runner_pairing SET used_at = now() WHERE principal_id = ${lit(pid)} AND used_at IS NULL`,
      );
      const code = genCode();
      await octoSql(
        config,
        token,
        octo,
        `INSERT INTO ri_console.runner_pairing (id, principal_id, workspace_id, code_hash, expires_at, created_at) VALUES (${lit(randomUUID())}, ${lit(pid)}, ${lit(tenancy.workspace.id)}, ${lit(sha(code))}, now() + interval '600 seconds', now())`,
      );
      sendJson(res, 200, {
        code,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
      return true;
    }
    if (path === "/app-api/connectors/runner/claim" && req.method === "POST") {
      const ip = req.socket.remoteAddress ?? "unknown";
      if (rateLimited(ip)) {
        sendJson(res, 429, { error: "RATE_LIMITED" });
        return true;
      }
      const parsed = ClaimSchema.safeParse(await readJson(req, 8 * 1024));
      if (!parsed.success) {
        sendJson(res, 400, { error: "BAD_REQUEST" });
        return true;
      }
      const code = normalizeCode(parsed.data.code);
      if (!code) {
        sendJson(res, 400, { error: "INVALID_PAIRING_CODE" });
        return true;
      }
      const claimed = await octoSql(
        config,
        token,
        octo,
        `UPDATE ri_console.runner_pairing SET used_at = now() WHERE code_hash = ${lit(sha(code))} AND used_at IS NULL AND expires_at > now() RETURNING id, principal_id, workspace_id`,
      );
      const row = claimed[0];
      if (!row) {
        sendJson(res, 400, { error: "INVALID_PAIRING_CODE" });
        return true;
      }
      const deviceToken = randomBytes(24).toString("hex");
      const deviceId = randomUUID();
      await octoSql(
        config,
        token,
        octo,
        `INSERT INTO ri_console.user_runner (id, principal_id, workspace_id, device_label, token_hash, pairing_status, last_seen_at, created_at, updated_at) VALUES (${lit(deviceId)}, ${lit(String(row.principal_id))}, ${lit(String(row.workspace_id))}, ${lit(parsed.data.deviceLabel)}, ${lit(sha(deviceToken))}, 'paired', now(), now(), now())`,
      );
      sendJson(res, 200, {
        deviceToken,
        deviceId,
        principalId: String(row.principal_id),
      });
      return true;
    }
    if (
      path === "/app-api/connectors/runner/heartbeat" &&
      req.method === "POST"
    ) {
      const dev = await resolveDevice(req, env);
      if ("error" in dev) {
        sendJson(res, 401, { error: dev.error });
        return true;
      }
      await octoSql(
        config,
        token,
        octo,
        `UPDATE ri_console.user_runner SET last_seen_at = now(), updated_at = now() WHERE id = ${lit(dev.deviceId)}`,
      );
      const rows = await octoSql(
        config,
        token,
        octo,
        `SELECT provider, scopes, revoked_at FROM ri_console.runner_consent WHERE principal_id = ${lit(dev.principalId)}`,
      );
      sendJson(res, 200, {
        now: new Date().toISOString(),
        consents: rows.map((r) => ({
          provider: String(r.provider),
          scopes: Array.isArray(r.scopes) ? r.scopes : [],
          granted: r.revoked_at === null,
        })),
      });
      return true;
    }
    if (
      path === "/app-api/connectors/runner/session-status" &&
      req.method === "POST"
    ) {
      const dev = await resolveDevice(req, env);
      if ("error" in dev) {
        sendJson(res, 401, { error: dev.error });
        return true;
      }
      const parsed = SessionStatusSchema.safeParse(
        await readJson(req, 8 * 1024),
      );
      if (!parsed.success) {
        sendJson(res, 400, { error: "BAD_REQUEST" });
        return true;
      }
      const consent = await consentRow(
        env,
        dev.principalId,
        parsed.data.provider,
      );
      const status = !parsed.data.ok
        ? "expired"
        : consent
          ? "connected"
          : "needs_setup";
      await saveUserConnector(
        config,
        token,
        octo,
        dev.workspaceId,
        dev.principalId,
        {
          provider: parsed.data.provider,
          status,
          ...(parsed.data.accountHint
            ? { accountEmail: parsed.data.accountHint }
            : {}),
        },
      );
      sendJson(res, 200, { ok: true, status });
      return true;
    }
    if (
      path === "/app-api/connectors/runner/consent" &&
      req.method === "POST"
    ) {
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        sendJson(res, tenancy.status, tenancy.body);
        return true;
      }
      const parsed = ConsentSchema.safeParse(await readJson(req, 8 * 1024));
      if (!parsed.success) {
        sendJson(res, 400, { error: "BAD_REQUEST" });
        return true;
      }
      const allowed = catalogScopes(parsed.data.provider);
      if (!parsed.data.scopes.every((s) => allowed.includes(s))) {
        sendJson(res, 400, { error: "UNSUPPORTED_SCOPE" });
        return true;
      }
      const pid = tenancy.principal.id;
      await octoSql(
        config,
        token,
        octo,
        `INSERT INTO ri_console.runner_consent (principal_id, provider, scopes, granted_at, revoked_at) VALUES (${lit(pid)}, ${lit(parsed.data.provider)}, ${lit(JSON.stringify(parsed.data.scopes))}::jsonb, now(), ${parsed.data.granted ? "NULL" : "now()"}) ON CONFLICT (principal_id, provider) DO UPDATE SET scopes = EXCLUDED.scopes, granted_at = now(), revoked_at = ${parsed.data.granted ? "NULL" : "now()"}`,
      );
      await appendLedgerEvent(config, token, octo, {
        workspaceId: tenancy.workspace.id,
        principalId: pid,
        eventType: parsed.data.granted
          ? "connector.consent_granted"
          : "connector.consent_revoked",
        entityKind: "runner_consent",
        entityId: parsed.data.provider,
        payload: { provider: parsed.data.provider, scopes: parsed.data.scopes },
      });
      sendJson(res, 200, { ok: true, granted: parsed.data.granted });
      return true;
    }
    if (path === "/app-api/connectors/runner/ingest" && req.method === "POST") {
      const dev = await resolveDevice(req, env);
      if ("error" in dev) {
        sendJson(res, 401, { error: dev.error });
        return true;
      }
      let body: unknown;
      try {
        body = await readJson(req, 256 * 1024);
      } catch (e) {
        sendJson(res, e instanceof BodyTooLarge ? 413 : 400, {
          error: e instanceof BodyTooLarge ? "BODY_TOO_LARGE" : "BAD_REQUEST",
        });
        return true;
      }
      const parsed = IngestSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "BAD_REQUEST" });
        return true;
      }
      const consent = await consentRow(
        env,
        dev.principalId,
        parsed.data.provider,
      );
      if (!consent) {
        sendJson(res, 403, { error: "CONSENT_REQUIRED" });
        return true;
      }
      const allowed = catalogScopes(parsed.data.provider);
      const routeRows = await octoSql(
        config,
        token,
        octo,
        `SELECT id, provider, match_expr, target_workspace_id, target_project_id, cadence, created_at FROM ri_console.connector_route WHERE principal_id = ${lit(dev.principalId)} AND provider = ${lit(parsed.data.provider)}`,
      );
      const routes: ConnectorRouteRecord[] = routeRows.map((r) => ({
        id: String(r.id),
        provider: String(r.provider),
        matchExpr: String(r.match_expr),
        targetWorkspaceId: String(r.target_workspace_id),
        targetProjectId:
          typeof r.target_project_id === "string" ? r.target_project_id : null,
        cadence:
          r.cadence === "daily" || r.cadence === "pre_event"
            ? r.cadence
            : "signal",
        createdAt: String(r.created_at ?? ""),
      }));
      const accepted: { externalId: string; id: string }[] = [];
      const rejected: { externalId: string; reason: string }[] = [];
      const memberCache = new Map<string, boolean>();
      for (const item of parsed.data.items) {
        if (
          !allowed.includes(item.scope) ||
          !consent.scopes.includes(item.scope)
        ) {
          rejected.push({
            externalId: item.externalId,
            reason: "SCOPE_NOT_CONSENTED",
          });
          continue;
        }
        const dest = matchConnectorRoute(
          routes,
          parsed.data.provider,
          item.matchText,
          dev.workspaceId,
        );
        let ws = dest.workspaceId;
        if (!memberCache.has(ws)) {
          const m = await octoSql(
            config,
            token,
            octo,
            `SELECT 1 AS ok FROM ri_console.workspace_member WHERE workspace_id = ${lit(ws)} AND principal_id = ${lit(dev.principalId)} AND status = 'active' LIMIT 1`,
          );
          memberCache.set(ws, m.length > 0);
        }
        if (!memberCache.get(ws)) ws = dev.workspaceId;
        const id = `sync-${dev.principalId}-${parsed.data.provider}-${item.externalId}`;
        const doc = {
          id,
          at: item.occurredAt,
          agentId: "runner",
          type: "connector_sync",
          provider: parsed.data.provider,
          projectId: ws === dest.workspaceId ? dest.projectId : null,
          title: item.title,
          detail: item.detail,
          url: item.url,
          outcome: "ok",
        };
        await octoSql(
          config,
          token,
          octo,
          `INSERT INTO ri_console.activity (id, workspace_id, principal_id, visibility, doc) VALUES (${lit(id)}, ${lit(ws)}, ${lit(dev.principalId)}, 'private', ${lit(JSON.stringify(doc))}::jsonb) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        );
        await appendLedgerEvent(
          config,
          token,
          octo,
          {
            workspaceId: ws,
            principalId: dev.principalId,
            eventType: "connector.ingest",
            entityKind: "activity",
            entityId: id,
            payload: {
              provider: parsed.data.provider,
              externalId: item.externalId,
            },
          },
          sha(
            `${dev.principalId}|${parsed.data.provider}|${item.externalId}|connector.ingest`,
          ),
        );
        accepted.push({ externalId: item.externalId, id });
      }
      if (accepted.length > 0) {
        await saveUserConnector(
          config,
          token,
          octo,
          dev.workspaceId,
          dev.principalId,
          { provider: parsed.data.provider, status: "connected" },
        );
      }
      sendJson(res, 200, { accepted, rejected });
      return true;
    }
    if (path === "/app-api/connectors/runner/revoke" && req.method === "POST") {
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        sendJson(res, tenancy.status, tenancy.body);
        return true;
      }
      const parsed = RevokeSchema.safeParse(await readJson(req, 8 * 1024));
      if (!parsed.success) {
        sendJson(res, 400, { error: "BAD_REQUEST" });
        return true;
      }
      const rows = await octoSql(
        config,
        token,
        octo,
        `UPDATE ri_console.user_runner SET pairing_status = 'revoked', updated_at = now() WHERE id = ${lit(parsed.data.deviceId)} AND principal_id = ${lit(tenancy.principal.id)} RETURNING id`,
      );
      if (rows.length === 0) {
        sendJson(res, 404, { error: "DEVICE_NOT_FOUND" });
        return true;
      }
      sendJson(res, 200, { revoked: true, deviceId: parsed.data.deviceId });
      return true;
    }
    if (path === "/app-api/connectors/runner/setup" && req.method === "GET") {
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        sendJson(res, tenancy.status, tenancy.body);
        return true;
      }
      const pid = tenancy.principal.id;
      const devices = await octoSql(
        config,
        token,
        octo,
        `SELECT id, device_label, last_seen_at, pairing_status FROM ri_console.user_runner WHERE principal_id = ${lit(pid)} AND pairing_status = 'paired' ORDER BY created_at DESC`,
      );
      const consents = await octoSql(
        config,
        token,
        octo,
        `SELECT provider, scopes, revoked_at FROM ri_console.runner_consent WHERE principal_id = ${lit(pid)}`,
      );
      sendJson(res, 200, {
        installCommand:
          "git clone https://github.com/Pukujan/relationship-intelligence.git && cd relationship-intelligence/collector && pnpm install",
        pairCommand: `pnpm run daemon -- pair --server ${env.APP_ORIGIN} --code <CODE>`,
        devices: devices.map((d) => ({
          id: String(d.id),
          label: String(d.device_label),
          lastSeenAt: String(d.last_seen_at ?? ""),
          pairingStatus: String(d.pairing_status),
        })),
        consents: consents.map((c) => ({
          provider: String(c.provider),
          scopes: Array.isArray(c.scopes) ? c.scopes : [],
          granted: c.revoked_at === null,
        })),
      });
      return true;
    }
    sendJson(res, 404, { error: "NOT_FOUND" });
    return true;
  } catch {
    sendJson(res, 500, { error: "INTERNAL" });
    return true;
  }
}

export function runnerOnlineWindowMs(env: Env): number {
  return process.env.NODE_ENV === "production"
    ? 90_000
    : env.RI_RUNNER_ONLINE_WINDOW_MS;
}
