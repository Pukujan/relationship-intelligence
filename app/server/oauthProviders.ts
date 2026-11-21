/**
 * Provider OAuth wiring for Slack / Calendly / Discord / Zoom (RI-0021 §2).
 * Credentials never leave the server. Browser-facing errors are fixed enums
 * plus provider HTTP status only (R9). Test hook R21: endpoint overrides are
 * honored only outside production.
 */
import { z } from "zod";
import type { Env } from "./env.js";

export type ProviderOAuthId = "slack" | "calendly" | "discord" | "zoom";
export const PROVIDER_OAUTH_IDS: ProviderOAuthId[] = [
  "slack",
  "calendly",
  "discord",
  "zoom",
];

export class ProviderOAuthError extends Error {
  constructor(
    public code:
      | "NOT_CONFIGURED"
      | "EXCHANGE_FAILED"
      | "IDENTITY_FAILED"
      | "SCOPE_NOT_APPROVED",
    public providerStatus = 0,
  ) {
    super(code);
  }
}

const EndpointsSchema = z.record(
  z.object({
    authorize: z.string().url(),
    token: z.string().url(),
    api: z.string().url(),
  }),
);

interface ProviderEndpoints {
  authorize: string;
  token: string;
  api: string;
}

const DEFAULT_ENDPOINTS: Record<ProviderOAuthId, ProviderEndpoints> = {
  slack: {
    authorize: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
    api: "https://slack.com/api",
  },
  calendly: {
    authorize: "https://auth.calendly.com/oauth/authorize",
    token: "https://auth.calendly.com/oauth/token",
    api: "https://api.calendly.com",
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    api: "https://discord.com/api",
  },
  zoom: {
    authorize: "https://zoom.us/oauth/authorize",
    token: "https://zoom.us/oauth/token",
    api: "https://api.zoom.us/v2",
  },
};

export function providerEndpoints(
  env: Env,
  provider: ProviderOAuthId,
): ProviderEndpoints {
  if (env.RI_OAUTH_ENDPOINTS_JSON) {
    if (process.env.NODE_ENV === "production") {
      console.warn("RI_OAUTH_ENDPOINTS_JSON ignored in production (R21)");
    } else {
      const parsed = EndpointsSchema.safeParse(
        JSON.parse(env.RI_OAUTH_ENDPOINTS_JSON),
      );
      if (parsed.success && parsed.data[provider]) {
        console.log(
          `test hooks active: oauth endpoints override for ${provider}`,
        );
        return parsed.data[provider] as ProviderEndpoints;
      }
    }
  }
  return DEFAULT_ENDPOINTS[provider];
}

export function providerCreds(
  env: Env,
  provider: ProviderOAuthId,
): { id: string; secret: string } | null {
  const pick = {
    slack: [env.SLACK_CLIENT_ID, env.SLACK_CLIENT_SECRET],
    calendly: [env.CALENDLY_CLIENT_ID, env.CALENDLY_CLIENT_SECRET],
    discord: [env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET],
    zoom: [env.ZOOM_CLIENT_ID, env.ZOOM_CLIENT_SECRET],
  }[provider];
  return pick[0] && pick[1] ? { id: pick[0], secret: pick[1] } : null;
}

const USER_SCOPES: Record<ProviderOAuthId, string> = {
  slack: "channels:history,users:read,channels:read",
  calendly: "default",
  discord: "identify guilds messages.read",
  zoom: "",
};

export function buildProviderAuthUrl(
  env: Env,
  provider: ProviderOAuthId,
  state: string,
): string | null {
  const creds = providerCreds(env, provider);
  if (!creds) return null;
  const ep = providerEndpoints(env, provider);
  const url = new URL(ep.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.id);
  url.searchParams.set(
    "redirect_uri",
    `${env.APP_ORIGIN}/app-api/connectors/oauth/${provider}/callback`,
  );
  url.searchParams.set("state", state);
  const scopes = USER_SCOPES[provider];
  if (provider === "slack") url.searchParams.set("user_scope", scopes);
  else if (scopes) url.searchParams.set("scope", scopes);
  return url.toString();
}

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
}

export async function exchangeProviderCode(
  env: Env,
  provider: ProviderOAuthId,
  code: string,
): Promise<ProviderTokens> {
  const creds = providerCreds(env, provider);
  if (!creds) throw new ProviderOAuthError("NOT_CONFIGURED");
  const ep = providerEndpoints(env, provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.APP_ORIGIN}/app-api/connectors/oauth/${provider}/callback`,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "discord" || provider === "zoom") {
    headers.Authorization = `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString("base64")}`;
  } else {
    body.set("client_id", creds.id);
    body.set("client_secret", creds.secret);
  }
  const res = await fetch(ep.token, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/invalid_scope|scope/i.test(text) && res.status === 400)
      throw new ProviderOAuthError("SCOPE_NOT_APPROVED", res.status);
    throw new ProviderOAuthError("EXCHANGE_FAILED", res.status);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const slackUser = (data.authed_user ?? {}) as Record<string, unknown>;
  const accessToken = String(
    provider === "slack"
      ? (slackUser.access_token ?? "")
      : (data.access_token ?? ""),
  );
  if (!accessToken) throw new ProviderOAuthError("EXCHANGE_FAILED", res.status);
  const refreshToken = (
    provider === "slack" ? slackUser.refresh_token : data.refresh_token
  ) as string | undefined;
  const expiresIn = (
    provider === "slack" ? slackUser.expires_in : data.expires_in
  ) as number | undefined;
  const scopeStr = String(
    provider === "slack"
      ? (slackUser.scope ?? data.scope ?? "")
      : (data.scope ?? ""),
  );
  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt:
      typeof expiresIn === "number"
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
    scopes: scopeStr ? scopeStr.split(/[\s,]+/).filter(Boolean) : [],
  };
}

export async function refreshProviderAccessToken(
  env: Env,
  provider: ProviderOAuthId,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string | null } | null> {
  const creds = providerCreds(env, provider);
  if (!creds) return null;
  const ep = providerEndpoints(env, provider);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "discord" || provider === "zoom") {
    headers.Authorization = `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString("base64")}`;
  } else {
    body.set("client_id", creds.id);
    body.set("client_secret", creds.secret);
  }
  const res = await fetch(ep.token, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const slackUser = (data.authed_user ?? {}) as Record<string, unknown>;
  const accessToken = String(
    provider === "slack"
      ? (slackUser.access_token ?? "")
      : (data.access_token ?? ""),
  );
  if (!accessToken) return null;
  const expiresIn = (
    provider === "slack" ? slackUser.expires_in : data.expires_in
  ) as number | undefined;
  return {
    accessToken,
    expiresAt:
      typeof expiresIn === "number"
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
  };
}

export async function fetchProviderIdentity(
  env: Env,
  provider: ProviderOAuthId,
  accessToken: string,
): Promise<{ email: string | null; name: string | null }> {
  const ep = providerEndpoints(env, provider);
  const fail = (status: number) => {
    throw new ProviderOAuthError("IDENTITY_FAILED", status);
  };
  if (provider === "slack") {
    const res = await fetch(`${ep.api}/auth.test`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) fail(res.status);
    const d = (await res.json()) as {
      ok?: boolean;
      user?: string;
      team?: string;
      url?: string;
    };
    if (!d.ok) fail(200);
    return {
      email: null,
      name: `${d.user ?? "slack"}@${d.team ?? "workspace"}`,
    };
  }
  const path =
    provider === "calendly"
      ? "/users/me"
      : provider === "discord"
        ? "/users/@me"
        : "/users/me";
  const res = await fetch(`${ep.api}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) fail(res.status);
  const d = (await res.json()) as Record<string, unknown>;
  if (provider === "calendly") {
    const r = (d.resource ?? {}) as Record<string, unknown>;
    return {
      email: typeof r.email === "string" ? r.email.toLowerCase() : null,
      name: typeof r.name === "string" ? r.name : null,
    };
  }
  if (provider === "discord") {
    return {
      email: typeof d.email === "string" ? d.email.toLowerCase() : null,
      name: typeof d.username === "string" ? d.username : null,
    };
  }
  return {
    email: typeof d.email === "string" ? d.email.toLowerCase() : null,
    name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || null,
  };
}
