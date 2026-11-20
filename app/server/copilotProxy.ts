/**
 * Signed-in gate in front of the copilot server (#62).
 *
 * The copilot server (console/server) answers `/api/*` and spends the owner's
 * model keys. It listens on loopback only and has no sign-in of its own: in
 * development Vite proxies to it on localhost. In production this adapter is
 * the only way in, and it forwards a request only for a signed-in session, so
 * nobody on the internet can spend those keys anonymously. The guest demo
 * gets a 401 and the console falls back to its offline router, as before.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Env } from "./env.js";
import { type AppSession, isIdleExpired, readSession } from "./session.js";

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

/** Who may reach the copilot server: a signed-in session that is not idle. */
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
  const gate = copilotGate(await readSession(req, res, env));
  if (!gate.ok) {
    sendJson(res, gate.status, gate.body);
    return;
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
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
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
