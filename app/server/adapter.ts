/**
 * HTTP adapter: the only server surface the browser talks to.
 *
 * Routes:
 *   GET  /app-api/session          current principal + their Octo workspaces
 *   GET  /octo-auth/google/start   begin Google sign-in through Octo
 *   GET  /octo-auth/google/callback  finish sign-in, seal the session cookie
 *   POST /app-api/logout           destroy the local session
 *
 * No route accepts an Octo token or API key from the browser. That is the point
 * of the adapter: the browser gets a cookie, and Octo keeps authority over who
 * the principal is and which workspaces they may enter.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { SessionResponseSchema } from "../shared/contracts.js";
import { type Env, readEnv } from "./env.js";
import { fetchPrincipal, fetchWorkspaces, OctoError } from "./octo.js";
import { newOauthState, readSession, safeReturnTo } from "./session.js";
import {
  addProposal,
  decideApproval,
  logActivity,
  patchDoc,
  readWorld,
} from "./world.js";

const MAX_BODY_BYTES = 8 * 1024;

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

/** Generate a request id for logs without logging any credential or body. */
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

  if (path === "/octo-auth/google/start" && req.method === "GET") {
    const session = await readSession(req, res, env);
    session.loginNonce = newOauthState();
    session.returnTo = safeReturnTo(url.searchParams.get("returnTo"));
    await session.save();
    // Octo owns the Google OAuth flow and does not forward a `state` parameter,
    // so there is no way to bind the callback to this nonce. The callback route
    // therefore accepts the fragment token and verifies it against /api/me.
    // Residual risk: a login-CSRF is not excluded; Octo would need state support
    // for that, which is a platform change rather than an adopter one.
    const target = new URL("/api/auth/google", env.OCTO_API_URL);
    redirect(res, target.toString());
    return;
  }

  if (path === "/octo-auth/google/callback" && req.method === "GET") {
    // Octo redirects to `${origin}/#token=...`. Browsers never send the fragment
    // to the server, so the token is extracted by the small inline script below
    // and posted here. This is the documented hand-off for the current Octo
    // auth contract.
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'",
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
      session.destroy();
      sendJson(res, 400, { error: "INVALID_TOKEN" });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, token);
    } catch {
      session.destroy();
      sendJson(res, 401, { error: "SESSION_REJECTED" });
      return;
    }
    session.octoToken = token;
    await session.save();
    sendJson(res, 200, {
      authenticated: true,
      returnTo: session.returnTo ?? "/",
    });
    return;
  }

  if (path === "/app-api/session" && req.method === "GET") {
    const session = await readSession(req, res, env);
    if (!session.octoToken) {
      sendJson(res, 200, { authenticated: false });
      return;
    }
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      const principal = await fetchPrincipal(config, session.octoToken);
      const workspaces = await fetchWorkspaces(config, session.octoToken);
      sendJson(
        res,
        200,
        SessionResponseSchema.parse({
          authenticated: true,
          principal,
          workspaces,
        }),
      );
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        // Octo refused the token (expired or revoked): clear my cookie too, so
        // the browser is not stuck presenting a dead session.
        session.destroy();
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 502, { error: "OCTO_UNAVAILABLE" });
    }
    return;
  }

  if (path === "/app-api/connections" && req.method === "GET") {
    const session = await readSession(req, res, env);
    if (!session.octoToken) {
      sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    // Source connections live in the Octo workspace database, keyed by the
    // current principal. Until Slice 001 creates that table, an authenticated
    // user with no connections gets an empty list rather than an error.
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, session.octoToken); // still valid?
      sendJson(res, 200, { connections: [] });
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        session.destroy();
        sendJson(res, 401, { error: "UNAUTHENTICATED" });
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
  /* Console world routes — principal token only, never the workspace key */
  /* ------------------------------------------------------------------ */

  const worldRoutes = [
    "/app-api/world",
    "/app-api/decision",
    "/app-api/proposal",
    "/app-api/activity",
    "/app-api/agent-status",
    "/app-api/connector-status",
    "/app-api/plugin-installed",
  ];
  if (worldRoutes.includes(path)) {
    const session = await readSession(req, res, env);
    if (!session.octoToken) {
      sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
    let principal: { id: string; displayName: string };
    let workspaces: { id: string; name: string }[];
    try {
      const me = await fetchPrincipal(config, session.octoToken);
      principal = { id: me.id, displayName: me.displayName ?? me.email };
      workspaces = await fetchWorkspaces(config, session.octoToken);
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        session.destroy();
        sendJson(res, 401, { error: "UNAUTHENTICATED" });
        return;
      }
      sendJson(res, 502, { error: "OCTO_UNAVAILABLE" });
      return;
    }
    const body =
      req.method === "POST"
        ? (JSON.parse(await readBody(req)) as Record<string, unknown>)
        : {};
    const requested = (url.searchParams.get("workspaceId") ??
      body.workspaceId ??
      workspaces[0]?.id) as string;
    if (!workspaces.some((workspace) => workspace.id === requested)) {
      sendJson(res, 403, { error: "WORKSPACE_NOT_A_MEMBER" });
      return;
    }
    try {
      if (path === "/app-api/world" && req.method === "GET") {
        sendJson(
          res,
          200,
          await readWorld(
            config,
            session.octoToken,
            requested,
            principal,
            workspaces,
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
            session.octoToken,
            requested,
            principal,
            workspaces,
            {
              approvalId: String(body.approvalId),
              decision: body.decision === "approved" ? "approved" : "declined",
              note: typeof body.note === "string" ? body.note : undefined,
              editedAction:
                typeof body.editedAction === "string"
                  ? body.editedAction
                  : undefined,
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
            session.octoToken,
            requested,
            principal.id,
            body.proposal as Record<string, unknown>,
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
            session.octoToken,
            requested,
            principal.id,
            body.entry as Record<string, unknown>,
          ),
        );
        return;
      }
      if (path === "/app-api/agent-status" && req.method === "POST") {
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            session.octoToken,
            requested,
            principal.id,
            "agents",
            String(body.agentId),
            {
              status: body.status,
              ...(body.status === "paused" ? { currentTask: null } : {}),
            },
          ),
        );
        return;
      }
      if (path === "/app-api/connector-status" && req.method === "POST") {
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            session.octoToken,
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
          ),
        );
        return;
      }
      if (path === "/app-api/plugin-installed" && req.method === "POST") {
        sendJson(
          res,
          200,
          await patchDoc(
            config,
            session.octoToken,
            requested,
            principal.id,
            "plugins",
            String(body.pluginId),
            {
              installed: Boolean(body.installed),
            },
          ),
        );
        return;
      }
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        session.destroy();
        sendJson(res, 401, { error: "UNAUTHENTICATED" });
        return;
      }
      sendJson(res, 502, {
        error: "WORLD_WRITE_FAILED",
        detail: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

export function createAppServer(env: Env) {
  return createServer((req, res) => {
    const id = requestId();
    handleRequest(req, res, env).catch((error: unknown) => {
      // Log the failure class and request id, never the URL query or body:
      // the callback URL carries the session token.
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
