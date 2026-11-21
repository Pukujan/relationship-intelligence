/**
 * HTTP adapter: the only server surface the browser talks to.
 *
 * Single-Octo model (RI-0018) + User Connectors & Routing (RI-0019) + Dual
 * Ledger & Phoenix Tracing (RI-0020):
 *  - Every SQL/graph call hits the single backing `octoWorkspaceId` container.
 *  - App Workspaces, memberships, user connectors, routing rules, and
 *    immutable ledger events live in `ri_console.*` inside that container.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { SessionResponseSchema } from "../shared/contracts.js";
import {
  AGENT_TEMPLATES,
  createCustomAgent,
  createDraftPlan,
  listDraftPlans,
  lockDraftPlan,
} from "./agents.js";
import {
  buildGoogleConnectorAuthUrl,
  buildZoomConnectorAuthUrl,
  type ConnectorProviderId,
  createConnectorRoute,
  deleteConnectorRoute,
  listUserConnectors,
  saveUserConnector,
} from "./connectors.js";
import { handleRagQuery, proxyCopilot } from "./copilotProxy.js";
import { type Env, readEnv } from "./env.js";
import { fetchPrincipal, OctoError } from "./octo.js";
import { handleProfileRoutes } from "./profile.js";
import { handleScheduleRoutes } from "./schedules.js";
import {
  isIdleExpired,
  newOauthState,
  readSession,
  safeReturnTo,
  tokenExpiresAtMs,
} from "./session.js";
import {
  appendMessage,
  createConversation,
  getMessages,
  listConversations,
  patchConversation,
} from "./sessions.js";
import { syncUserConnector } from "./sync.js";
import {
  requireRole,
  resolvePrincipalWorkspaces,
  resolveTenancy,
} from "./tenancy.js";
import {
  createAppWorkspace,
  inviteWorkspaceMember,
  listWorkspaceMembers,
  provisionWorkspace,
  removeWorkspaceMember,
  resolveOrActivateGoogleMember,
} from "./workspaces.js";
import {
  addProposal,
  ConflictError,
  decideApproval,
  ForbiddenError,
  logActivity,
  octoSql,
  patchDoc,
  readWorld,
} from "./world.js";

const MAX_BODY_BYTES = 8 * 1024;
const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let text = "";
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      text += chunk.toString("utf8");
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

function requestId(): string {
  return randomBytes(8).toString("hex");
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
): Promise<void> {
  const url = new URL(req.url ?? "/", env.APP_ORIGIN);
  const path = url.pathname;

  if (path === "/app-api/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // RAG stays behind the signed-in adapter. The copilot server holds no Octo
  // key; it calls this route with the short-lived capability minted for its
  // request by proxyCopilot (see copilotProxy.ts). Handle it before the /api
  // proxy so /app-api/rag/query never reaches the loopback copilot server.
  if (path === "/app-api/rag/query") {
    await handleRagQuery(req, res, env, url);
    return;
  }

  // The copilot server's routes. It has no sign-in of its own, so the proxy
  // forwards only for a signed-in session (see copilotProxy.ts).
  if (path.startsWith("/api/")) {
    await proxyCopilot(req, res, env, `${path}${url.search}`);
    return;
  }

  if (path === "/octo-auth/google/start" && req.method === "GET") {
    const session = await readSession(req, res, env);
    session.loginNonce = newOauthState();
    session.returnTo = safeReturnTo(url.searchParams.get("returnTo"));
    await session.save();
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      target.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      target.searchParams.set(
        "redirect_uri",
        `${env.APP_ORIGIN}/octo-auth/google/callback`,
      );
      target.searchParams.set("response_type", "code");
      target.searchParams.set("scope", "openid email profile");
      target.searchParams.set("state", session.loginNonce);
      target.searchParams.set("prompt", "select_account");
      redirect(res, target.toString());
      return;
    }
    const target = new URL("/api/auth/google", env.OCTO_API_URL);
    redirect(res, target.toString());
    return;
  }

  if (path === "/octo-auth/google/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    if (code && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      const session = await readSession(req, res, env);
      const state = url.searchParams.get("state");
      if (!state || state !== session.loginNonce) {
        redirect(
          res,
          `${env.APP_ORIGIN}/console/signin?auth_error=STATE_MISMATCH`,
        );
        return;
      }
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${env.APP_ORIGIN}/octo-auth/google/callback`,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!tokenRes.ok) throw new Error(`google token ${tokenRes.status}`);
        const tokens = (await tokenRes.json()) as { id_token?: string };
        const segment = String(tokens.id_token ?? "").split(".")[1] ?? "";
        const payload = JSON.parse(
          Buffer.from(segment, "base64url").toString("utf8"),
        ) as {
          email?: string;
          email_verified?: boolean;
          name?: string;
        };
        if (!payload.email || payload.email_verified === false)
          throw new Error("google email unverified");
        const email = payload.email.toLowerCase();
        const key = env.OCTO_API_KEY ?? "";
        const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
        const membership = await resolveOrActivateGoogleMember(
          config,
          key,
          email,
          env,
          payload.name ?? email,
        );
        if (!membership) {
          redirect(
            res,
            `${env.APP_ORIGIN}/console/signin?auth_error=NOT_A_MEMBER&email=${encodeURIComponent(email)}`,
          );
          return;
        }
        session.principalId = membership.principalId;
        session.email = email;
        session.displayName = payload.name ?? email;
        session.role = membership.role;
        session.authMode = "google";
        session.lastSeenAt = Date.now();
        await session.save();
        redirect(res, `${env.APP_ORIGIN}${session.returnTo ?? "/console/"}`);
      } catch (error) {
        console.error(
          "own-google callback failed:",
          error instanceof Error ? error.message : "unknown",
        );
        redirect(
          res,
          `${env.APP_ORIGIN}/console/signin?auth_error=GOOGLE_EXCHANGE`,
        );
      }
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'",
    });
    res.end(`<!doctype html><html><body><p>Finishing sign-in…</p><script>
      (function () {
        var params = new URLSearchParams(window.location.hash.slice(1));
        var token = params.get('token');
        var authError = params.get('auth_error');
        if (authError) { window.location.replace('/?auth_error=' + encodeURIComponent(authError)); return; }
        if (!token) { window.location.replace('/?auth_error=MISSING_TOKEN'); return; }
        fetch('/app-api/session/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        }).then(function (r) {
          if (!r.ok) { window.location.replace('/?auth_error=SESSION_REJECTED'); return; }
          return r.json();
        }).then(function (d) {
          if (d) { window.location.replace(d.returnTo || '/'); }
        }).catch(function () { window.location.replace('/?auth_error=SESSION_REJECTED'); });
      })();
    </script></body></html>`);
    return;
  }

  if (path === "/app-api/config" && req.method === "GET") {
    sendJson(res, 200, {
      workspaceId:
        env.OCTO_WORKSPACE_ID ?? process.env.OCTO_WORKSPACE_ID ?? null,
      keyConnect: true,
      workspaceCreateEnabled: true,
      googleConnectorsReady: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
      ),
      zoomConnectorReady: Boolean(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET),
      phoenixConfigured: Boolean(env.PHOENIX_COLLECTOR_ENDPOINT),
    });
    return;
  }

  // Incremental Google OAuth for user-level Gmail / Google Calendar / Google Drive
  if (
    path === "/app-api/connectors/oauth/google/start" &&
    req.method === "GET"
  ) {
    const provider = url.searchParams.get("provider");
    if (provider !== "gmail" && provider !== "gcal" && provider !== "gdrive") {
      sendJson(res, 400, { error: "INVALID_PROVIDER" });
      return;
    }
    const session = await readSession(req, res, env);
    if (!session.octoToken && !session.principalId) {
      redirect(res, `${env.APP_ORIGIN}/console/signin`);
      return;
    }
    const state = newOauthState();
    session.connectorOauthState = state;
    session.connectorProvider = provider;
    await session.save();
    const authUrl = buildGoogleConnectorAuthUrl(env, provider, state);
    if (!authUrl) {
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=GOOGLE_NOT_CONFIGURED`,
      );
      return;
    }
    redirect(res, authUrl);
    return;
  }

  if (
    path === "/app-api/connectors/oauth/google/callback" &&
    req.method === "GET"
  ) {
    const session = await readSession(req, res, env);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const provider = session.connectorProvider;
    if (
      !code ||
      !state ||
      state !== session.connectorOauthState ||
      (provider !== "gmail" && provider !== "gcal" && provider !== "gdrive") ||
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET
    ) {
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=STATE_MISMATCH`,
      );
      return;
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${env.APP_ORIGIN}/app-api/connectors/oauth/google/callback`,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenRes.ok) throw new Error(`google token ${tokenRes.status}`);
      const tokens = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        id_token?: string;
      };
      const seg = String(tokens.id_token ?? "").split(".")[1] ?? "";
      let accountEmail: string | null = session.email ?? null;
      if (seg) {
        try {
          const p = JSON.parse(
            Buffer.from(seg, "base64url").toString("utf8"),
          ) as { email?: string };
          if (p.email) accountEmail = p.email.toLowerCase();
        } catch {
          // ignore malformed id_token
        }
      }
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        redirect(res, `${env.APP_ORIGIN}/console/signin`);
        return;
      }
      await saveUserConnector(
        config,
        tenancy.token,
        tenancy.octoWorkspaceId,
        tenancy.workspace.id,
        tenancy.principal.id,
        {
          provider,
          status: "connected",
          accountEmail,
          scopes: tokens.scope ? tokens.scope.split(/\s+/) : undefined,
          accessToken: tokens.access_token ?? null,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
        },
      );
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connected=${provider}`,
      );
    } catch (error) {
      console.error(
        "google connector callback failed:",
        error instanceof Error ? error.message : "unknown",
      );
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=EXCHANGE_FAILED`,
      );
    }
    return;
  }

  // Zoom OAuth 2.0 for user-level meetings & recordings
  if (path === "/app-api/connectors/oauth/zoom/start" && req.method === "GET") {
    const session = await readSession(req, res, env);
    if (!session.octoToken && !session.principalId) {
      redirect(res, `${env.APP_ORIGIN}/console/signin`);
      return;
    }
    const state = newOauthState();
    session.connectorOauthState = state;
    session.connectorProvider = "zoom";
    await session.save();
    const authUrl = buildZoomConnectorAuthUrl(env, state);
    if (!authUrl) {
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=ZOOM_NOT_CONFIGURED`,
      );
      return;
    }
    redirect(res, authUrl);
    return;
  }

  if (
    path === "/app-api/connectors/oauth/zoom/callback" &&
    req.method === "GET"
  ) {
    const session = await readSession(req, res, env);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (
      !code ||
      !state ||
      state !== session.connectorOauthState ||
      !env.ZOOM_CLIENT_ID ||
      !env.ZOOM_CLIENT_SECRET
    ) {
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=ZOOM_STATE_MISMATCH`,
      );
      return;
    }
    try {
      const basic = Buffer.from(
        `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`,
      ).toString("base64");
      const tokenRes = await fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${env.APP_ORIGIN}/app-api/connectors/oauth/zoom/callback`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenRes.ok) throw new Error(`zoom token ${tokenRes.status}`);
      const tokens = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
      const tenancy = await resolveTenancy(req, res, env, config);
      if (!tenancy.ok) {
        redirect(res, `${env.APP_ORIGIN}/console/signin`);
        return;
      }
      await saveUserConnector(
        config,
        tenancy.token,
        tenancy.octoWorkspaceId,
        tenancy.workspace.id,
        tenancy.principal.id,
        {
          provider: "zoom",
          status: "connected",
          accountEmail: tenancy.principal.email || null,
          scopes: tokens.scope ? tokens.scope.split(/\s+/) : undefined,
          accessToken: tokens.access_token ?? null,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
        },
      );
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connected=zoom`,
      );
    } catch (error) {
      console.error(
        "zoom connector callback failed:",
        error instanceof Error ? error.message : "unknown",
      );
      redirect(
        res,
        `${env.APP_ORIGIN}/console/integrations/connectors?connector_error=ZOOM_EXCHANGE_FAILED`,
      );
    }
    return;
  }

  if (path === "/app-api/session/accept-key" && req.method === "POST") {
    const session = await readSession(req, res, env);
    let key: unknown;
    try {
      key = JSON.parse(await readBody(req)).key;
    } catch {
      sendJson(res, 400, { error: "BAD_REQUEST" });
      return;
    }
    if (typeof key !== "string" || !/^octo_live_(ws|acc)_/.test(key)) {
      sendJson(res, 400, { error: "INVALID_KEY" });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, key);
    } catch {
      sendJson(res, 401, { error: "KEY_REJECTED" });
      return;
    }
    session.octoToken = key;
    await session.save();
    sendJson(res, 200, {
      authenticated: true,
      returnTo: session.returnTo ?? "/",
    });
    return;
  }

  if (path === "/app-api/session/accept" && req.method === "POST") {
    const session = await readSession(req, res, env);
    let token: unknown;
    try {
      token = JSON.parse(await readBody(req)).token;
    } catch {
      sendJson(res, 400, { error: "BAD_REQUEST" });
      return;
    }
    if (typeof token !== "string" || !token.startsWith("octo_sess_")) {
      console.error("session accept: bad token prefix");
      session.destroy();
      sendJson(res, 400, { error: "INVALID_TOKEN" });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, token);
    } catch (error) {
      console.error(
        "session accept: Octo refused the token:",
        error instanceof OctoError ? error.status : "non-octo-error",
        "| prefix:",
        token.slice(0, 10),
      );
      session.destroy();
      sendJson(res, 401, { error: "SESSION_REJECTED" });
      return;
    }
    session.octoToken = token;
    session.lastSeenAt = Date.now();
    await session.save();
    sendJson(res, 200, {
      authenticated: true,
      returnTo: session.returnTo ?? "/",
    });
    return;
  }

  if (path === "/app-api/session" && req.method === "GET") {
    const session = await readSession(req, res, env);
    if (!session.octoToken && !session.principalId) {
      sendJson(res, 200, { authenticated: false });
      return;
    }
    const isSessionToken = (session.octoToken ?? "").startsWith("octo_sess_");
    const expiresAt = isSessionToken
      ? tokenExpiresAtMs(session.octoToken ?? "")
      : null;
    if (isSessionToken && expiresAt === null) {
      session.destroy();
      sendJson(res, 200, { authenticated: false });
      return;
    }
    if (isIdleExpired(session)) {
      session.destroy();
      sendJson(res, 200, {
        authenticated: false,
        reason: "idle_expired",
        resume: true,
      });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      const { principal, workspaces } = await resolvePrincipalWorkspaces(
        config,
        env,
        session,
      );
      session.lastSeenAt = Date.now();
      await session.save();
      const state = SessionResponseSchema.parse({
        authenticated: true,
        principal,
        workspaces,
      });
      sendJson(res, 200, { ...state, expiresAt });
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        sendJson(res, 200, {
          authenticated: false,
          reason: "octo_token_expired",
          resume: true,
          expiresAt,
        });
        return;
      }
      sendJson(res, 502, { error: "OCTO_UNAVAILABLE" });
    }
    return;
  }

  if (path === "/app-api/connections" && req.method === "GET") {
    const session = await readSession(req, res, env);
    if (!session.octoToken && !session.principalId) {
      sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    if (isIdleExpired(session)) {
      session.destroy();
      sendJson(res, 401, { error: "UNAUTHENTICATED", reason: "idle_expired" });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, session.octoToken ?? env.OCTO_API_KEY ?? "");
      session.lastSeenAt = Date.now();
      await session.save();
      sendJson(res, 200, { connections: [] });
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        sendJson(res, 401, {
          error: "UNAUTHENTICATED",
          reason: "octo_token_expired",
        });
        return;
      }
      sendJson(res, 502, { error: "OCTO_UNAVAILABLE" });
    }
    return;
  }

  if (path === "/app-api/logout" && req.method === "POST") {
    await readBody(req);
    const session = await readSession(req, res, env);
    session.destroy();
    sendJson(res, 200, { authenticated: false });
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Console world & single-Octo workspace routes                        */
  /* ------------------------------------------------------------------ */

  const worldRoutes = [
    "/app-api/world",
    "/app-api/decision",
    "/app-api/proposal",
    "/app-api/activity",
    "/app-api/agent-status",
    "/app-api/agent-templates",
    "/app-api/agents",
    "/app-api/draft-plans",
    "/app-api/connector-status",
    "/app-api/plugin-installed",
    "/app-api/projects",
    "/app-api/connectors",
    "/app-api/connectors/routes",
    "/app-api/connectors/sync-all",
  ];
  const isCreateWorkspace =
    path === "/app-api/workspaces" && req.method === "POST";
  const provisionMatch = path.match(
    /^\/app-api\/workspaces\/([^/]+)\/provision$/,
  );
  const inviteMatch = path.match(/^\/app-api\/workspaces\/([^/]+)\/invites$/);
  const membersMatch = path.match(/^\/app-api\/workspaces\/([^/]+)\/members$/);
  const removeMemberMatch = path.match(
    /^\/app-api\/workspaces\/([^/]+)\/members\/([^/]+)$/,
  );
  const connectorDisconnectMatch = path.match(
    /^\/app-api\/connectors\/([^/]+)\/disconnect$/,
  );
  const connectorSyncMatch = path.match(
    /^\/app-api\/connectors\/([^/]+)\/sync$/,
  );
  const deleteRouteMatch = path.match(
    /^\/app-api\/connectors\/routes\/([^/]+)$/,
  );
  const lockDraftPlanMatch = path.match(
    /^\/app-api\/draft-plans\/([^/]+)\/lock$/,
  );
  const extraRoutes =
    path === "/app-api/profile" ||
    path === "/app-api/team" ||
    path === "/app-api/files" ||
    path.startsWith("/app-api/files/") ||
    path === "/app-api/notes" ||
    path === "/app-api/retros" ||
    path.startsWith("/app-api/schedules") ||
    path.startsWith("/app-api/projects/");
  if (
    worldRoutes.includes(path) ||
    path.startsWith("/app-api/sessions") ||
    isCreateWorkspace ||
    provisionMatch ||
    inviteMatch ||
    membersMatch ||
    removeMemberMatch ||
    connectorDisconnectMatch ||
    connectorSyncMatch ||
    deleteRouteMatch ||
    lockDraftPlanMatch ||
    extraRoutes
  ) {
    const body =
      req.method === "POST" || req.method === "PATCH"
        ? (JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>)
        : {};
    const requestedWorkspaceId = (provisionMatch?.[1] ??
      inviteMatch?.[1] ??
      membersMatch?.[1] ??
      removeMemberMatch?.[1] ??
      url.searchParams.get("workspaceId") ??
      (typeof body.workspaceId === "string" ? body.workspaceId : undefined)) as
      | string
      | undefined;
    const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
    const tenancy = await resolveTenancy(
      req,
      res,
      env,
      config,
      requestedWorkspaceId,
    );
    if (!tenancy.ok) {
      sendJson(res, tenancy.status, tenancy.body);
      return;
    }
    const { principal, role, workspace, workspaces, octoWorkspaceId, token } =
      tenancy;
    const requested = workspace.id;
    try {
      if (path === "/app-api/agent-templates" && req.method === "GET") {
        sendJson(res, 200, { templates: AGENT_TEMPLATES });
        return;
      }
      if (path === "/app-api/agents" && req.method === "POST") {
        const result = await createCustomAgent(
          config,
          token,
          octoWorkspaceId,
          requested,
          principal.id,
          body,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (path === "/app-api/draft-plans" && req.method === "GET") {
        sendJson(res, 200, {
          draftPlans: await listDraftPlans(
            config,
            token,
            octoWorkspaceId,
            requested,
            principal.id,
          ),
        });
        return;
      }
      if (path === "/app-api/draft-plans" && req.method === "POST") {
        const result = await createDraftPlan(
          config,
          token,
          octoWorkspaceId,
          requested,
          principal.id,
          body,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (lockDraftPlanMatch && req.method === "POST") {
        const result = await lockDraftPlan(
          config,
          token,
          octoWorkspaceId,
          requested,
          principal.id,
          lockDraftPlanMatch[1] ?? "",
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (path === "/app-api/connectors/sync-all" && req.method === "POST") {
        const { connectors } = await listUserConnectors(
          config,
          token,
          octoWorkspaceId,
          principal.id,
          env,
        );
        const active = connectors.filter(
          (c) =>
            c.status === "connected" &&
            (c.provider === "gmail" ||
              c.provider === "gcal" ||
              c.provider === "gdrive" ||
              c.provider === "zoom"),
        );
        const results = [];
        for (const c of active) {
          results.push(
            await syncUserConnector(
              config,
              token,
              octoWorkspaceId,
              requested,
              principal.id,
              c.provider,
              env,
            ),
          );
        }
        sendJson(res, 200, { syncedProviders: active.length, results });
        return;
      }
      if (path === "/app-api/connectors" && req.method === "GET") {
        sendJson(
          res,
          200,
          await listUserConnectors(
            config,
            token,
            octoWorkspaceId,
            principal.id,
            env,
          ),
        );
        return;
      }
      if (path === "/app-api/connectors/routes" && req.method === "POST") {
        const result = await createConnectorRoute(
          config,
          token,
          octoWorkspaceId,
          principal.id,
          body,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (deleteRouteMatch && req.method === "DELETE") {
        sendJson(
          res,
          200,
          await deleteConnectorRoute(
            config,
            token,
            octoWorkspaceId,
            principal.id,
            deleteRouteMatch[1] ?? "",
          ),
        );
        return;
      }
      if (connectorSyncMatch && req.method === "POST") {
        const provider = connectorSyncMatch[1] as ConnectorProviderId;
        const result = await syncUserConnector(
          config,
          token,
          octoWorkspaceId,
          requested,
          principal.id,
          provider,
          env,
        );
        if (!result.ok) {
          sendJson(res, result.status, {
            error: result.error,
            detail: result.detail,
          });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      if (connectorDisconnectMatch && req.method === "POST") {
        const provider = connectorDisconnectMatch[1] as ConnectorProviderId;
        sendJson(
          res,
          200,
          await saveUserConnector(
            config,
            token,
            octoWorkspaceId,
            requested,
            principal.id,
            {
              provider,
              status: "needs_setup",
              accessToken: null,
              refreshToken: null,
            },
          ),
        );
        return;
      }
      if (isCreateWorkspace) {
        const result = await createAppWorkspace(
          config,
          token,
          octoWorkspaceId,
          principal,
          body,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (provisionMatch && req.method === "POST") {
        if (!requireRole(role, "admin")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "admin" });
          return;
        }
        sendJson(
          res,
          200,
          await provisionWorkspace(config, token, octoWorkspaceId),
        );
        return;
      }
      if (inviteMatch && req.method === "POST") {
        if (!requireRole(role, "admin")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "admin" });
          return;
        }
        const result = await inviteWorkspaceMember(
          config,
          token,
          octoWorkspaceId,
          requested,
          principal.id,
          body,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (membersMatch && req.method === "GET") {
        sendJson(res, 200, {
          members: await listWorkspaceMembers(
            config,
            token,
            octoWorkspaceId,
            requested,
          ),
        });
        return;
      }
      if (removeMemberMatch && req.method === "DELETE") {
        if (!requireRole(role, "admin")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "admin" });
          return;
        }
        const targetEmail = decodeURIComponent(removeMemberMatch[2] ?? "");
        const result = await removeWorkspaceMember(
          config,
          token,
          octoWorkspaceId,
          requested,
          targetEmail,
          principal.email,
          principal.id,
        );
        sendJson(res, result.status, result.body);
        return;
      }
      if (extraRoutes) {
        const ctx = {
          config,
          token,
          workspaceId: requested,
          octoContainerId: octoWorkspaceId,
          body,
          principalId: principal.id,
          principal,
          workspaces,
          role,
        };
        const handled = path.startsWith("/app-api/schedules")
          ? await handleScheduleRoutes(req, res, url, ctx)
          : await handleProfileRoutes(req, res, url, ctx);
        if (handled) return;
      }
      if (path === "/app-api/sessions" && req.method === "GET") {
        sendJson(
          res,
          200,
          await listConversations(
            config,
            token,
            octoWorkspaceId,
            requested,
            principal.id,
          ),
        );
        return;
      }
      if (path === "/app-api/sessions" && req.method === "POST") {
        sendJson(
          res,
          200,
          await createConversation(
            config,
            token,
            octoWorkspaceId,
            requested,
            principal.id,
            {
              title: String(body.title ?? "New research"),
              scopeKind: String(body.scopeKind ?? "workspace"),
              scopeId: typeof body.scopeId === "string" ? body.scopeId : null,
            },
          ),
        );
        return;
      }
      const sessionMatch = path.match(
        /^\/app-api\/sessions\/([^/]+)(\/messages)?$/,
      );
      if (sessionMatch) {
        const conversationId = sessionMatch[1] ?? "";
        const isMessages = Boolean(sessionMatch[2]);
        if (isMessages && req.method === "GET") {
          sendJson(
            res,
            200,
            await getMessages(
              config,
              token,
              octoWorkspaceId,
              requested,
              principal.id,
              conversationId,
            ),
          );
          return;
        }
        if (isMessages && req.method === "POST") {
          sendJson(
            res,
            200,
            await appendMessage(
              config,
              token,
              octoWorkspaceId,
              requested,
              principal.id,
              conversationId,
              body.message,
            ),
          );
          return;
        }
        if (!isMessages && req.method === "PATCH") {
          sendJson(
            res,
            200,
            await patchConversation(
              config,
              token,
              octoWorkspaceId,
              requested,
              principal.id,
              conversationId,
              {
                title: typeof body.title === "string" ? body.title : undefined,
                archived:
                  typeof body.archived === "boolean"
                    ? body.archived
                    : undefined,
                scopeKind:
                  typeof body.scopeKind === "string"
                    ? body.scopeKind
                    : undefined,
                scopeId:
                  body.scopeId === null || typeof body.scopeId === "string"
                    ? body.scopeId
                    : undefined,
              },
            ),
          );
          return;
        }
      }
      if (path === "/app-api/world" && req.method === "GET") {
        sendJson(
          res,
          200,
          await readWorld(
            config,
            token,
            requested,
            principal,
            workspaces,
            octoWorkspaceId,
            role,
          ),
        );
        return;
      }
      if (path === "/app-api/decision" && req.method === "POST") {
        sendJson(
          res,
          200,
          await decideApproval(
            config,
            token,
            requested,
            principal,
            workspaces,
            {
              approvalId: String(body.approvalId),
              decision: body.decision === "approved" ? "approved" : "declined",
              declinePath:
                body.declinePath === "re_plan" ||
                body.declinePath === "snooze" ||
                body.declinePath === "stop"
                  ? body.declinePath
                  : undefined,
              note: typeof body.note === "string" ? body.note : undefined,
              editedAction:
                typeof body.editedAction === "string"
                  ? body.editedAction
                  : undefined,
            },
            {
              canDecideOthers: requireRole(role, "operator"),
              octoContainerId: octoWorkspaceId,
              role,
            },
          ),
        );
        return;
      }
      if (path === "/app-api/proposal" && req.method === "POST") {
        sendJson(
          res,
          200,
          await addProposal(
            config,
            token,
            requested,
            principal.id,
            body.proposal as Record<string, unknown>,
            octoWorkspaceId,
          ),
        );
        return;
      }
      if (path === "/app-api/activity" && req.method === "POST") {
        sendJson(
          res,
          200,
          await logActivity(
            config,
            token,
            requested,
            principal.id,
            body.entry as Record<string, unknown>,
            octoWorkspaceId,
          ),
        );
        return;
      }
      if (path === "/app-api/agent-status" && req.method === "POST") {
        if (!requireRole(role, "operator")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "operator" });
          return;
        }
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            token,
            requested,
            principal.id,
            "agents",
            String(body.agentId),
            {
              status: body.status,
              ...(body.status === "paused" ? { currentTask: null } : {}),
            },
            "shared",
            octoWorkspaceId,
          ),
        );
        return;
      }
      if (path === "/app-api/connector-status" && req.method === "POST") {
        if (!requireRole(role, "operator")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "operator" });
          return;
        }
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            token,
            requested,
            principal.id,
            "connectors",
            String(body.connectorId),
            {
              status: body.status,
              ...(body.status === "connected"
                ? { lastSync: new Date().toISOString() }
                : {}),
            },
            "shared",
            octoWorkspaceId,
          ),
        );
        return;
      }
      if (path === "/app-api/plugin-installed" && req.method === "POST") {
        if (!requireRole(role, "operator")) {
          sendJson(res, 403, { error: "FORBIDDEN_ROLE", required: "operator" });
          return;
        }
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            token,
            requested,
            principal.id,
            "plugins",
            String(body.pluginId),
            {
              installed: Boolean(body.installed),
            },
            "shared",
            octoWorkspaceId,
          ),
        );
        return;
      }
      if (path === "/app-api/projects" && req.method === "POST") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          sendJson(res, 400, { error: "BAD_REQUEST" });
          return;
        }
        const id = randomUUID();
        const doc = {
          id,
          workspaceId: requested,
          name,
          kind: "initiative",
          status: "active",
          owner: principal.id,
          summary: typeof body.summary === "string" ? body.summary.trim() : "",
          personIds: [],
          companyIds: [],
          eventIds: [],
          startedAt: new Date().toISOString(),
        };
        await octoSql(
          config,
          token,
          octoWorkspaceId,
          `INSERT INTO ri_console.project (id, workspace_id, principal_id, visibility, doc)
           VALUES (${lit(id)}, ${lit(requested)}, ${lit(principal.id)}, 'shared', ${lit(JSON.stringify(doc))}::jsonb)
           ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        );
        sendJson(res, 200, { id });
        return;
      }
      const projectMatch = path.match(/^\/app-api\/projects\/([^/]+)$/);
      if (projectMatch && req.method === "DELETE") {
        const projectId = projectMatch[1] ?? "";
        const owns = `workspace_id = ${lit(requested)} AND (principal_id = ${lit(principal.id)} OR visibility = 'shared')`;
        const existing = await octoSql(
          config,
          token,
          octoWorkspaceId,
          `SELECT id, principal_id FROM ri_console.project WHERE id = ${lit(projectId)} AND ${owns}`,
        );
        if (existing.length === 0) throw new Error("Unknown project");
        if (
          !requireRole(role, "admin") &&
          String(existing[0]?.principal_id ?? "") !== principal.id
        ) {
          sendJson(res, 403, {
            error: "FORBIDDEN_ROLE",
            detail: "Only admins or the project owner may delete a project.",
          });
          return;
        }
        await octoSql(
          config,
          token,
          octoWorkspaceId,
          `DELETE FROM ri_console.plan
            WHERE ${owns}
              AND doc->>'missionId' IN (
                SELECT id FROM ri_console.mission
                 WHERE ${owns} AND doc->>'projectId' = ${lit(projectId)}
              )`,
        );
        await octoSql(
          config,
          token,
          octoWorkspaceId,
          `DELETE FROM ri_console.mission WHERE ${owns} AND doc->>'projectId' = ${lit(projectId)}`,
        );
        await octoSql(
          config,
          token,
          octoWorkspaceId,
          `DELETE FROM ri_console.objective WHERE ${owns} AND doc->>'projectId' = ${lit(projectId)}`,
        );
        await octoSql(
          config,
          token,
          octoWorkspaceId,
          `DELETE FROM ri_console.project WHERE id = ${lit(projectId)} AND ${owns}`,
        );
        sendJson(res, 200, { id: projectId, deleted: true });
        return;
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        sendJson(res, 409, {
          error: "ALREADY_DECIDED",
          detail: error.message,
        });
        return;
      }
      if (error instanceof ForbiddenError) {
        sendJson(res, 403, {
          error: "FORBIDDEN_ROLE",
          detail: error.message,
        });
        return;
      }
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        sendJson(res, 401, {
          error: "UNAUTHENTICATED",
          reason: "octo_token_expired",
        });
        return;
      }
      console.error(
        "world route failed:",
        path,
        error instanceof Error ? error.message : "unknown",
      );
      sendJson(res, 502, {
        error: "WORLD_WRITE_FAILED",
        detail: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
  }

  const consoleDist = nodePath.resolve(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "../../console/dist",
  );
  if (
    req.method === "GET" &&
    (path === "/" || path === "/console" || path.startsWith("/console/"))
  ) {
    if (path === "/" || path === "/console") {
      redirect(res, "/console/");
      return;
    }
    const rel = path.slice("/console/".length) || "index.html";
    let file = nodePath.join(consoleDist, rel);
    if (!file.startsWith(consoleDist)) {
      sendJson(res, 403, { error: "FORBIDDEN" });
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory())
      file = nodePath.join(consoleDist, "index.html");
    if (!existsSync(file)) {
      sendJson(res, 404, { error: "CONSOLE_NOT_BUILT" });
      return;
    }
    const ext = nodePath.extname(file);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".json": "application/json",
    };
    res.writeHead(200, {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    createReadStream(file).pipe(res);
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

export function createAppServer(env: Env) {
  return createServer((req, res) => {
    const id = requestId();
    handleRequest(req, res, env).catch((error: unknown) => {
      console.error(
        `request ${id} failed:`,
        error instanceof Error ? error.name : "unknown",
      );
      if (!res.headersSent)
        sendJson(res, 500, { error: "INTERNAL_ERROR", requestId: id });
      else res.end();
    });
  });
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const env = readEnv();
  createAppServer(env).listen(env.PORT, () => {
    console.log(`adapter listening on :${env.PORT}`);
  });
}
