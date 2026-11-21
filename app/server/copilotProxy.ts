/**
 * Signed-in gate in front of the copilot server (#62).
 *
 * The copilot server (console/server) answers `/api/*` and spends the owner's
 * model keys. It listens on loopback only and has no sign-in of its own: in
 * development Vite proxies to it on localhost. In production this adapter is
 * the only way in, and it forwards a request only for a signed-in session
 * that belongs to THIS app: its Octo container, or one of its app workspaces.
 *
 * It also owns RAG. The copilot never holds the Octo workspace key: instead,
 * this adapter mints a short-lived sealed capability for a signed-in request,
 * passes it to the copilot in a forward header, and the copilot calls back to
 * `/app-api/rag/query` with that capability. This file verifies the capability
 * and calls Octo with the session's own token (or the tenancy-resolved token
 * for our-backend sign-in), so Octo enforces that principal's memberships.
 *
 * Signing in is not enough, and neither is "belongs to some workspace".
 * Anyone can mint an Octo guest principal and present its token, and Octo
 * gives every guest a personal workspace of its own. A live check on
 * 2026-11-20 showed such a guest getting a model answer. See
 * `workspaceRequiredFor` for the rule. The console's guest demo has no
 * session at all, gets a 401, and falls back to its offline router.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { sealData, unsealData } from "iron-session";
import { z } from "zod";
import type { Env } from "./env.js";
import { type AppSession, isIdleExpired, readSession } from "./session.js";
import { resolveTenancy } from "./tenancy.js";

/** A workspace digest is large; this caps it well above the largest seen. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const copilotTarget = () =>
  (process.env.COPILOT_INTERNAL_URL ?? "http://127.0.0.1:8799").replace(
    /\/$/,
    "",
  );

export type CopilotGate =
  | { ok: true; principalId: string | null }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * How long a membership check is trusted for the copilot. Checking costs a
 * round trip to Octo, and a spoken turn should not wait on it every time. A
 * removed member can therefore still spend model calls for up to this long;
 * their access to workspace data ends at once, on the data routes.
 */
export const MEMBERSHIP_TRUST_MS = 60_000;
const memberUntil = new Map<string, number>();

/** True when this session was seen to belong to a workspace recently. */
export function recentlyMember(key: string, nowMs: number = Date.now()) {
  const until = memberUntil.get(key) ?? 0;
  if (until > nowMs) return true;
  memberUntil.delete(key);
  return false;
}

export function rememberMember(key: string, nowMs: number = Date.now()) {
  memberUntil.set(key, nowMs + MEMBERSHIP_TRUST_MS);
}

/**
 * Which workspace a session must be a member of to use the copilot.
 *
 * - A session holding an Octo token (a guest, or the owner's workspace key)
 *   must be a member of the app's own Octo container. Its token's workspace
 *   list comes from Octo and includes any personal workspace, so "a member of
 *   something" proves nothing. With no container configured, nobody passes.
 * - A session from the app's own Google sign-in holds no token. Its
 *   memberships are looked up with the server key against the app's own
 *   tables, so any one of them is a membership of this app: `undefined`
 *   means "any".
 */
export const NO_SUCH_WORKSPACE = "\u0000no-container-configured";

export function workspaceRequiredFor(
  session: Pick<AppSession, "octoToken">,
  containerId: string | undefined,
): string | undefined {
  if (!session.octoToken) return undefined;
  return containerId?.trim() || NO_SUCH_WORKSPACE;
}

/** First check, from the cookie alone: a signed-in session that is not idle. */
export function copilotGate(
  session: Pick<AppSession, "octoToken" | "principalId" | "lastSeenAt">,
  nowMs: number = Date.now(),
): CopilotGate {
  if (!session.octoToken && !session.principalId) {
    return { ok: false, status: 401, body: { error: "UNAUTHENTICATED" } };
  }
  if (isIdleExpired(session as AppSession, nowMs)) {
    return {
      ok: false,
      status: 401,
      body: { error: "UNAUTHENTICATED", reason: "idle_expired" },
    };
  }
  return { ok: true, principalId: session.principalId ?? null };
}

/**
 * The browser names a `principalId` in its request. Replace it with the
 * session's, so a signed-in user cannot ask the copilot as somebody else.
 */
export function withSessionPrincipal(
  rawBody: string,
  principalId: string | null,
): string {
  if (!rawBody) return rawBody;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rawBody;
    }
    const body = { ...(parsed as Record<string, unknown>) };
    if (principalId) body.principalId = principalId;
    else delete body.principalId;
    return JSON.stringify(body);
  } catch {
    return rawBody;
  }
}

/* -------------------------------------------------------------------------- */
/* Per-request RAG capability                                                 */
/* -------------------------------------------------------------------------- */

/** Short-lived capability passed to the loopback copilot for one request. */
export const RAG_CAPABILITY_HEADER = "x-ri-rag-capability";
export const RAG_CAPABILITY_FORWARD_HEADER = "x-ri-rag-capability-forward";
export const RAG_CAPABILITY_TTL_SECONDS = 30;

const RagCapabilitySchema = z.object({
  nonce: z.string().min(16),
});

/** Mint a capability bound to the adapter's session password. */
export function sealRagCapability(env: Env): Promise<string> {
  return sealData(
    { nonce: crypto.randomUUID() },
    { password: env.SESSION_PASSWORD, ttl: RAG_CAPABILITY_TTL_SECONDS },
  );
}

/** Verify a capability presented by the copilot's RAG callback. */
export async function unsealRagCapability(
  env: Env,
  raw: string | undefined,
): Promise<boolean> {
  if (!raw) return false;
  try {
    const value = await unsealData<unknown>(raw, {
      password: env.SESSION_PASSWORD,
    });
    return RagCapabilitySchema.safeParse(value).success;
  } catch {
    return false;
  }
}

/** Octo's RAG response, validated at the adapter's trust boundary. */
export const RagResponseSchema = z.object({
  matches: z.array(
    z.object({
      text: z.string(),
      locator: z.string().optional(),
      source: z.string().optional(),
      url: z.string().optional(),
      document: z.string().optional(),
      content: z.string().optional(),
      chunk: z.string().optional(),
      snippet: z.string().optional(),
    }),
  ),
});

/** Serve GET /app-api/rag/query with the session's own Octo authority. */
export async function handleRagQuery(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
  url: URL,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const capability =
    (req.headers[RAG_CAPABILITY_HEADER] as string | undefined) ??
    (req.headers[RAG_CAPABILITY_FORWARD_HEADER] as string | undefined);
  if (!(await unsealRagCapability(env, capability))) {
    sendJson(res, 401, { error: "UNAUTHENTICATED" });
    return;
  }

  const q = url.searchParams.get("q") ?? "";
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 4 : Number(rawLimit);
  if (!q.trim() || !Number.isInteger(limit) || limit < 1 || limit > 32) {
    sendJson(res, 400, { error: "INVALID_QUERY" });
    return;
  }

  const session = await readSession(req, res, env);
  const gate = copilotGate(session);
  if (!gate.ok) {
    sendJson(res, gate.status, gate.body);
    return;
  }
  const memberKey = session.principalId ?? session.octoToken ?? "";
  const tenancy = await resolveTenancy(
    req,
    res,
    env,
    { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 },
    workspaceRequiredFor(
      session,
      env.OCTO_WORKSPACE_ID ?? process.env.OCTO_WORKSPACE_ID,
    ),
  );
  if (!tenancy.ok) {
    sendJson(res, tenancy.status, tenancy.body);
    return;
  }
  rememberMember(memberKey);

  try {
    const upstream = await fetch(new URL("/api/rag/query", env.OCTO_API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenancy.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        workspaceId: tenancy.octoWorkspaceId,
        query: q,
        limit,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const raw: unknown = await upstream.json();
    if (!upstream.ok) {
      sendJson(res, 502, { error: "OCTO_RAG_FAILED", status: upstream.status });
      return;
    }
    const parsed = RagResponseSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 502, { error: "OCTO_RAG_INVALID" });
      return;
    }
    sendJson(res, 200, {
      matches: parsed.data.matches.slice(0, limit).flatMap((match) => {
        const text = String(
          match.text ?? match.content ?? match.chunk ?? match.snippet ?? "",
        )
          .trim()
          .slice(0, 400);
        const locator = String(
          match.locator ?? match.source ?? match.url ?? match.document ?? "",
        )
          .trim()
          .slice(0, 160);
        return text ? [{ text, locator }] : [];
      }),
    });
  } catch {
    sendJson(res, 502, { error: "OCTO_RAG_UNAVAILABLE" });
  }
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export async function proxyCopilot(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
  pathAndQuery: string,
): Promise<void> {
  const session = await readSession(req, res, env);
  const gate = copilotGate(session);
  if (!gate.ok) {
    sendJson(res, gate.status, gate.body);
    return;
  }
  // Second check: the session must belong to this app.
  const memberKey = session.principalId ?? session.octoToken ?? "";
  if (!recentlyMember(memberKey)) {
    const tenancy = await resolveTenancy(
      req,
      res,
      env,
      { baseUrl: env.OCTO_API_URL, timeoutMs: 15_000 },
      workspaceRequiredFor(
        session,
        env.OCTO_WORKSPACE_ID ?? process.env.OCTO_WORKSPACE_ID,
      ),
    );
    if (!tenancy.ok) {
      sendJson(res, tenancy.status, tenancy.body);
      return;
    }
    rememberMember(memberKey);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let body: string | undefined;
  if (hasBody) {
    try {
      body = withSessionPrincipal(await readRaw(req), gate.principalId);
    } catch {
      sendJson(res, 413, { error: "PAYLOAD_TOO_LARGE" });
      return;
    }
  }

  // Stop the model call when the browser goes away (Stop button, closed tab).
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream: Response;
  try {
    const init: RequestInit = { signal: controller.signal };
    if (req.method) init.method = req.method;
    // The copilot calls back on a different origin in dev (8799 -> 8787), so
    // forward the sealed session cookie to authenticate the RAG callback.
    const cookie = req.headers.cookie;
    init.headers = {
      ...(cookie ? { Cookie: cookie } : {}),
      // The copilot calls back to /app-api/rag/query with this capability; it
      // never holds an Octo token or the workspace key.
      [RAG_CAPABILITY_FORWARD_HEADER]: await sealRagCapability(env),
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = body;
    }
    upstream = await fetch(`${copilotTarget()}${pathAndQuery}`, init);
  } catch {
    if (!res.headersSent) {
      sendJson(res, 502, { error: "copilot_unavailable" });
    }
    return;
  }

  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
    // Lets a streamed answer through any buffering proxy in front of us.
    "X-Accel-Buffering": "no",
  });
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    .on("error", () => res.end())
    .pipe(res);
}
