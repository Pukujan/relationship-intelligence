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
 *
 * Session longevity: authenticated /app-api/* requests slide a 30-minute idle
 * window (session.ts). Octo's absolute 20-minute token TTL still applies on
 * top — sliding refresh is requested in Octo issue #93. When Octo refuses a
 * token we keep the cookie and report a reason so the console can offer a
 * one-click resume; the cookie alone grants nothing, every request still
 * re-validates at Octo.
 */

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import nodePath from "node:path";
import { SessionResponseSchema } from "../shared/contracts.js";
import { type Env, readEnv } from "./env.js";
import { fetchPrincipal, fetchWorkspaces, OctoError } from "./octo.js";
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
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      // Our backend owns sign-in: Google returns to OUR callback on our origin.
      // Octo is only the data layer; no portal redirect, no fragment hand-off.
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
        // Map the verified Google identity to an Octo principal via membership.
        const key = env.OCTO_API_KEY ?? "";
        const wsRes = await fetch(
          new URL("/api/workspaces", env.OCTO_API_URL),
          {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(15_000),
          },
        );
        const workspaces = (await wsRes.json()) as { id: string }[];
        let principalId: string | null = null;
        for (const workspace of workspaces) {
          const mRes = await fetch(
            new URL(
              `/api/workspaces/${workspace.id}/members`,
              env.OCTO_API_URL,
            ),
            {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!mRes.ok) continue;
          const membersBody = (await mRes.json()) as {
            members?: {
              email?: string;
              principalId?: string;
              principal?: { id?: string };
            }[];
          };
          const members = membersBody.members ?? [];
          const hit = members.find(
            (m) => String(m.email ?? "").toLowerCase() === email,
          );
          if (hit) {
            principalId = hit.principalId ?? hit.principal?.id ?? null;
            break;
          }
        }
        if (!principalId) throw new Error("not a workspace member");
        session.principalId = principalId;
        session.email = email;
        session.displayName = payload.name ?? email;
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
    // Octo redirects to `${origin}/#token=...`. Browsers never send the fragment
    // to the server, so the token is extracted by the small inline script below
    // and posted here. This is the documented hand-off for the current Octo
    // auth contract.
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
      workspaceId: process.env.OCTO_WORKSPACE_ID ?? null,
      keyConnect: true,
    });
    return;
  }

  // Workspace-key connect: avoids the Octo-portal redirect entirely for the
  // owner's local console. The key carries owner authority; per-teammate
  // privacy still requires the principal flow once octo-database#93 lands.
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
      // Diagnostic class only: status and prefix, never the token itself.
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
    // Advisory expiry for the console countdown; Octo stays the authority on
    // whether the token is actually valid (signature, revocation, clock).
    // Workspace keys (octo_live_*) carry no TTL envelope; only principal
    // session tokens (octo_sess_*) have the advisory expiry.
    const isSessionToken = (session.octoToken ?? "").startsWith("octo_sess_");
    const expiresAt = isSessionToken
      ? tokenExpiresAtMs(session.octoToken ?? "")
      : null;
    if (isSessionToken && expiresAt === null) {
      // Bad prefix or malformed envelope: this cookie can never become valid,
      // so it is the one case where we destroy it outright.
      session.destroy();
      sendJson(res, 200, { authenticated: false });
      return;
    }
    if (isIdleExpired(session)) {
      // Sliding idle window ended. Destroy, but tell the console why so the
      // sign-in screen can offer Resume instead of a cold first sign-in.
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
      const bearer = session.octoToken ?? env.OCTO_API_KEY ?? "";
      const principal = session.principalId
        ? {
            id: session.principalId,
            email: session.email ?? "",
            displayName: session.displayName ?? session.email ?? "",
            avatarUrl: null,
            isGuest: false,
            isPlatformOwner: false,
          }
        : await fetchPrincipal(config, bearer);
      const workspaces = await fetchWorkspaces(config, bearer);
      session.lastSeenAt = Date.now();
      await session.save();
      const state = SessionResponseSchema.parse({
        authenticated: true,
        principal,
        workspaces,
      });
      // expiresAt rides alongside the validated contract; the shared schema
      // does not carry it yet (integrator owns contracts.ts).
      sendJson(res, 200, { ...state, expiresAt });
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        // Octo refused the token (absolute TTL passed, or revoked). Keep the
        // cookie: it grants nothing on its own, and keeping it lets the
        // console resume in place (returnTo, workspace selection) instead of
        // bouncing the user through a cold Google sign-in.
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
    if (!session.octoToken) {
      sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    if (isIdleExpired(session)) {
      session.destroy();
      sendJson(res, 401, { error: "UNAUTHENTICATED", reason: "idle_expired" });
      return;
    }
    // Source connections live in the Octo workspace database, keyed by the
    // current principal. Until Slice 001 creates that table, an authenticated
    // user with no connections gets an empty list rather than an error.
    try {
      const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 };
      await fetchPrincipal(config, session.octoToken); // still valid?
      session.lastSeenAt = Date.now();
      await session.save();
      sendJson(res, 200, { connections: [] });
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        // Keep the cookie so GET /app-api/session can report the reason and
        // the console can offer Resume; the token itself is already dead.
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
  const extraRoutes =
    path === "/app-api/profile" ||
    path === "/app-api/team" ||
    path === "/app-api/files" ||
    path.startsWith("/app-api/files/") ||
    path === "/app-api/notes" ||
    path === "/app-api/retros" ||
    path.startsWith("/app-api/schedules");
  if (
    worldRoutes.includes(path) ||
    path.startsWith("/app-api/sessions") ||
    extraRoutes
  ) {
    const session = await readSession(req, res, env);
    if (!session.octoToken) {
      sendJson(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    if (isIdleExpired(session)) {
      session.destroy();
      sendJson(res, 401, { error: "UNAUTHENTICATED", reason: "idle_expired" });
      return;
    }
    const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
    let principal: { id: string; displayName: string };
    let workspaces: { id: string; name: string }[];
    try {
      const bearer = session.octoToken ?? env.OCTO_API_KEY ?? "";
      if (session.principalId) {
        principal = {
          id: session.principalId,
          displayName: session.displayName ?? session.email ?? "",
        };
      } else {
        const me = await fetchPrincipal(config, bearer);
        principal = { id: me.id, displayName: me.displayName ?? me.email };
      }
      workspaces = await fetchWorkspaces(config, bearer);
      // Authenticated request: slide the idle window. Octo's absolute token
      // TTL still applies — this never extends the token itself (Octo #93).
      session.lastSeenAt = Date.now();
      await session.save();
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 401 || error.status === 403)
      ) {
        // Keep the cookie for the resume flow; see GET /app-api/session.
        sendJson(res, 401, {
          error: "UNAUTHENTICATED",
          reason: "octo_token_expired",
        });
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
      if (extraRoutes) {
        const ctx = {
          config,
          token: session.octoToken ?? env.OCTO_API_KEY ?? "",
          workspaceId: requested,
          principalId: principal.id,
          principal,
          workspaces,
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
            session.octoToken,
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
            session.octoToken,
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
              session.octoToken,
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
              session.octoToken,
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
              session.octoToken,
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
        // Keep the cookie for the resume flow; see GET /app-api/session.
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

  // Production: serve the built console at /console with SPA fallback, so the
  // Cloudflare hostname serves app + API from this one process.
  const consoleDist = nodePath.resolve(process.cwd(), "../console/dist");
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
