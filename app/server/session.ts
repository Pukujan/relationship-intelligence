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
