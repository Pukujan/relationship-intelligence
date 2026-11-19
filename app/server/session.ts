/**
 * The application session.
 *
 * Octo mints a signed, short-lived token after Google OAuth. We keep it in an
 * encrypted, HttpOnly cookie so browser JavaScript never reads it. On every
 * request the adapter calls Octo with that token, which means a revoked or
 * expired session fails at Octo even if my cookie is still present.
 *
 * The cookie is encrypted (iron-session), not merely signed: it carries a
 * bearer token, so confidentiality matters as much as integrity.
 *
 * Longevity has two layers: Octo's absolute token TTL (20 minutes, no
 * refresh) and a sliding idle window on the local cookie (IDLE_LIMIT_MS).
 * An ended session keeps its cookie when Octo merely refused the token, so
 * the console can offer a one-click resume rather than a cold sign-in.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getIronSession, type IronSession } from "iron-session";
import type { Env } from "./env.js";

export interface AppSessionData {
  octoToken?: string;
  /**
   * Nonce checked against Octo's redirect when it arrives. Octo does not
   * forward OAuth `state` to Google, so this is a login-intent nonce rather
   * than true CSRF protection. See adapter.ts for the residual risk.
   */
  loginNonce?: string;
  /** Where to return after the callback. Same-origin paths only. */
  returnTo?: string;
  /**
   * Epoch ms of the last authenticated /app-api/* request. Slides the local
   * idle window; absent on cookies sealed before longevity landed, which are
   * treated as active until their first authenticated request.
   */
  lastSeenAt?: number;
}

export type AppSession = IronSession<AppSessionData>;

export const SESSION_COOKIE = "ri_session";

export function sessionOptions(env: Env) {
  return {
    cookieName: SESSION_COOKIE,
    password: env.SESSION_PASSWORD,
    ttl: 60 * 60 * 8,
    cookieOptions: {
      httpOnly: true,
      secure: env.APP_ORIGIN.startsWith("https://"),
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export function readSession(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
): Promise<AppSession> {
  return getIronSession<AppSessionData>(req, res, sessionOptions(env));
}

/** Base64url random nonce for the login round trip. */
export function newOauthState(): string {
  return randomBytes(24).toString("base64url");
}

/** Only a local path may be returned to; an absolute URL would be an open redirect. */
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : "/";
}

/**
 * Sliding idle window for the local cookie: 30 minutes without an
 * authenticated /app-api/* request destroys the session.
 *
 * This only governs the local cookie. Octo's absolute token TTL (20 minutes
 * by default) still applies on top: a token past its `exp` fails at Octo no
 * matter how recent the activity, because Octo mints no refresh token. A
 * sliding refresh is requested in Octo issue #93; until then the console
 * offers a one-click resume instead of silently extending the token.
 */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

export const OCTO_TOKEN_PREFIX = "octo_sess_";

/**
 * Read the expiry Octo embedded in `octo_sess_<principalId>.<exp>.<sig>`.
 * `exp` is epoch seconds; returns epoch milliseconds, or null when the token
 * is not a well-formed session token.
 *
 * Trust: the signature is Octo's to verify — this parse is advisory only (it
 * drives the UI countdown) and never grants access. Every request still
 * re-validates the token at Octo.
 */
export function tokenExpiresAtMs(token: string): number | null {
  if (!token.startsWith(OCTO_TOKEN_PREFIX)) return null;
  const parts = token.slice(OCTO_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
}

/** True when the sealed session has been idle longer than IDLE_LIMIT_MS. */
export function isIdleExpired(
  session: AppSession,
  nowMs: number = Date.now(),
): boolean {
  return (
    typeof session.lastSeenAt === "number" &&
    nowMs - session.lastSeenAt > IDLE_LIMIT_MS
  );
}
