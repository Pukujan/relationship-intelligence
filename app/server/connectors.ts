/**
 * User-level Connectors & Workspace/Project Routing (RI-0019).
 *
 * Personal connectors (Gmail, Google Calendar, Google Drive, Zoom, Calendly,
 * LinkedIn, Luma, Slack, Discord, Wispr Flow, Riley) are authorized ONCE per
 * user (`principal_id`), stored server-side in `ri_console.user_connector`,
 * and routed into App Workspaces & Projects via `ri_console.connector_route`.
 *
 * OAuth credentials never leave the server.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Env } from "./env.js";
import { type ProviderOAuthId, providerCreds } from "./oauthProviders.js";
import type { OctoClientConfig } from "./octo.js";
import { lit } from "./sql.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { ensureAppWorkspaceTables } from "./workspaces.js";
import { octoSql } from "./world.js";

export type ConnectorProviderId =
  | "gmail"
  | "gcal"
  | "gdrive"
  | "zoom"
  | "calendly"
  | "linkedin"
  | "luma"
  | "slack"
  | "discord"
  | "wispr"
  | "riley";

export interface ConnectorCatalogItem {
  provider: ConnectorProviderId;
  name: string;
  category: "google" | "meetings" | "messaging" | "network" | "voice";
  authKind: "google_oauth" | "zoom_oauth" | "provider_oauth" | "local_runner";
  scopes: string[];
  description: string;
}

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    provider: "gmail",
    name: "Gmail",
    category: "google",
    authKind: "google_oauth",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    description:
      "Read threads and contact signals; outgoing drafts always wait for your approval.",
  },
  {
    provider: "gcal",
    name: "Google Calendar",
    category: "google",
    authKind: "google_oauth",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    description:
      "Powers per-day Glance briefs and T-7d / T-24h / T+24h event prep.",
  },
  {
    provider: "gdrive",
    name: "Google Drive",
    category: "google",
    authKind: "google_oauth",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    description:
      "Read project decks, grant memos, and meeting docs as sourced evidence.",
  },
  {
    provider: "zoom",
    name: "Zoom",
    category: "meetings",
    authKind: "zoom_oauth",
    scopes: ["meeting:read", "recording:read", "user:read"],
    description:
      "Sync upcoming Zoom meetings and cloud recording transcripts into project notes.",
  },
  {
    provider: "calendly",
    name: "Calendly",
    category: "meetings",
    authKind: "provider_oauth",
    scopes: ["scheduled_events:read"],
    description:
      "Pull newly booked intro calls into your daily brief and contact graph.",
  },
  {
    provider: "linkedin",
    name: "LinkedIn",
    category: "network",
    authKind: "local_runner",
    scopes: ["profile:read", "messages:read"],
    description:
      "Consent-gated local session collector for profiles, warm paths, and DMs.",
  },
  {
    provider: "luma",
    name: "Luma",
    category: "network",
    authKind: "local_runner",
    scopes: ["events:read", "rsvp:consent"],
    description:
      "Pull event rosters and stage consent-gated RSVPs for upcoming NYC events.",
  },
  {
    provider: "slack",
    name: "Slack",
    category: "messaging",
    authKind: "provider_oauth",
    scopes: ["channels:history", "users:read"],
    description:
      "Route team channel updates and partner mentions into workspace projects.",
  },
  {
    provider: "discord",
    name: "Discord",
    category: "messaging",
    authKind: "provider_oauth",
    scopes: ["messages:read"],
    description:
      "Track hackathon and community threads alongside your project goals.",
  },
  {
    provider: "wispr",
    name: "Wispr Flow",
    category: "voice",
    authKind: "local_runner",
    scopes: ["dictation:ingest"],
    description:
      "Capture ambient voice notes and route them into People, Notes, or Draft Plans.",
  },
  {
    provider: "riley",
    name: "Riley (Voice / Phone)",
    category: "voice",
    authKind: "local_runner",
    scopes: ["voice:brief", "voice:triage"],
    description:
      "Zero-screen phone/LiveKit chief-of-staff for daily briefs and approval triage.",
  },
];

export interface UserConnectorView {
  provider: ConnectorProviderId;
  name: string;
  category: ConnectorCatalogItem["category"];
  authKind: ConnectorCatalogItem["authKind"];
  oauthConfigured: boolean;
  connectUrl: string | null;
  status: "connected" | "needs_setup" | "expired";
  accountEmail: string | null;
  scopes: string[];
  description: string;
  lastSync: string | null;
  /** local_runner only (RI-0021). */
  runnerStatus: "unpaired" | "online" | "offline" | null;
  consentedScopes: string[] | null;
}

export interface ConnectorRouteRecord {
  id: string;
  provider: string;
  matchExpr: string;
  targetWorkspaceId: string;
  targetProjectId: string | null;
  cadence: "daily" | "pre_event" | "signal";
  createdAt: string;
}

export const CreateRouteSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  matchExpr: z.string().trim().min(1).max(200),
  targetWorkspaceId: z.string().trim().min(1).max(120),
  targetProjectId: z.string().trim().max(120).nullable().optional(),
  cadence: z.enum(["daily", "pre_event", "signal"]).default("signal"),
});

export function buildGoogleConnectorAuthUrl(
  env: Env,
  provider: "gmail" | "gcal" | "gdrive",
  state: string,
): string | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const item = CONNECTOR_CATALOG.find((c) => c.provider === provider);
  if (!item) return null;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set(
    "redirect_uri",
    `${env.APP_ORIGIN}/app-api/connectors/oauth/google/callback`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", ["openid email", ...item.scopes].join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function listUserConnectors(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  principalId: string,
  env: Env,
): Promise<{
  connectors: UserConnectorView[];
  routes: ConnectorRouteRecord[];
}> {
  let savedRows: Record<string, unknown>[] = [];
  let routeRows: Record<string, unknown>[] = [];
  try {
    [savedRows, routeRows] = await Promise.all([
      octoSql(
        config,
        token,
        octoContainerId,
        `SELECT provider, status, account_email, scopes, last_sync
           FROM ri_console.user_connector
          WHERE principal_id = ${lit(principalId)}`,
      ),
      octoSql(
        config,
        token,
        octoContainerId,
        `SELECT id, provider, match_expr, target_workspace_id, target_project_id, cadence, created_at
           FROM ri_console.connector_route
          WHERE principal_id = ${lit(principalId)}
          ORDER BY created_at DESC`,
      ),
    ]);
  } catch {
    // Tables not provisioned yet -> return catalog defaults cleanly.
  }

  const byProvider = new Map<string, Record<string, unknown>>();
  for (const row of savedRows) byProvider.set(String(row.provider), row);

  const googleReady = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const zoomReady = Boolean(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);
  let runnerRows: Record<string, unknown>[] = [];
  let consentRows: Record<string, unknown>[] = [];
  try {
    [runnerRows, consentRows] = await Promise.all([
      octoSql(
        config,
        token,
        octoContainerId,
        `SELECT id, last_seen_at FROM ri_console.user_runner WHERE principal_id = ${lit(principalId)} AND pairing_status = 'paired'`,
      ),
      octoSql(
        config,
        token,
        octoContainerId,
        `SELECT provider, scopes, revoked_at FROM ri_console.runner_consent WHERE principal_id = ${lit(principalId)}`,
      ),
    ]);
  } catch {
    // runner tables not provisioned yet
  }
  const windowMs =
    process.env.NODE_ENV === "production"
      ? 90_000
      : env.RI_RUNNER_ONLINE_WINDOW_MS;
  const runnerOnline = runnerRows.some(
    (r) => Date.now() - Date.parse(String(r.last_seen_at)) <= windowMs,
  );
  const runnerStatus: "unpaired" | "online" | "offline" =
    runnerRows.length === 0 ? "unpaired" : runnerOnline ? "online" : "offline";
  const consentByProvider = new Map<string, string[]>(
    consentRows
      .filter((c) => c.revoked_at === null)
      .map((c) => [
        String(c.provider),
        Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
      ]),
  );

  const connectors: UserConnectorView[] = CONNECTOR_CATALOG.map((item) => {
    const saved = byProvider.get(item.provider);
    const oauthConfigured =
      item.authKind === "google_oauth"
        ? googleReady
        : item.authKind === "zoom_oauth"
          ? zoomReady
          : item.authKind === "provider_oauth"
            ? Boolean(providerCreds(env, item.provider as ProviderOAuthId))
            : false;
    const connectUrl =
      item.authKind === "google_oauth" && googleReady
        ? `/app-api/connectors/oauth/google/start?provider=${item.provider}`
        : (item.authKind === "zoom_oauth" ||
              item.authKind === "provider_oauth") &&
            oauthConfigured
          ? `/app-api/connectors/oauth/${item.provider}/start`
          : null;
    const statusRaw = String(saved?.status ?? "needs_setup");
    const status: UserConnectorView["status"] =
      statusRaw === "connected" || statusRaw === "expired"
        ? statusRaw
        : "needs_setup";
    return {
      provider: item.provider,
      name: item.name,
      category: item.category,
      authKind: item.authKind,
      oauthConfigured,
      connectUrl,
      status,
      accountEmail:
        typeof saved?.account_email === "string" ? saved.account_email : null,
      scopes: Array.isArray(saved?.scopes)
        ? (saved.scopes as string[])
        : item.scopes,
      description: item.description,
      lastSync: typeof saved?.last_sync === "string" ? saved.last_sync : null,
      runnerStatus: item.authKind === "local_runner" ? runnerStatus : null,
      consentedScopes:
        item.authKind === "local_runner"
          ? (consentByProvider.get(item.provider) ?? [])
          : null,
    };
  });

  const routes: ConnectorRouteRecord[] = routeRows.map((row) => ({
    id: String(row.id),
    provider: String(row.provider),
    matchExpr: String(row.match_expr),
    targetWorkspaceId: String(row.target_workspace_id),
    targetProjectId:
      typeof row.target_project_id === "string" ? row.target_project_id : null,
    cadence:
      row.cadence === "daily" || row.cadence === "pre_event"
        ? row.cadence
        : "signal",
    createdAt: String(row.created_at ?? ""),
  }));

  return { connectors, routes };
}

export async function saveUserConnector(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  input: {
    provider: ConnectorProviderId;
    status: "connected" | "needs_setup" | "expired";
    accountEmail?: string | null | undefined;
    scopes?: string[] | undefined;
    accessToken?: string | null | undefined;
    refreshToken?: string | null | undefined;
    expiresAt?: string | null | undefined;
    clearTokens?: boolean;
  },
): Promise<{ ok: true; provider: ConnectorProviderId; status: string }> {
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const item = CONNECTOR_CATALOG.find((c) => c.provider === input.provider);
  const label = item?.name ?? input.provider;
  const scopes = input.scopes ?? item?.scopes ?? [];
  const span = startSpan({
    name: "connector.save",
    kind: "TOOL",
    workspaceId,
    principalId,
    cadence: "interactive",
    attributes: {
      "ri.connector_provider": input.provider,
      "ri.connector_status": input.status,
    },
  });

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.user_connector
       (id, principal_id, provider, label, status, account_email, scopes, access_token, refresh_token, expires_at, last_sync, updated_at)
     VALUES (
       ${lit(randomUUID())},
       ${lit(principalId)},
       ${lit(input.provider)},
       ${lit(label)},
       ${lit(input.status)},
       ${input.accountEmail ? lit(input.accountEmail) : "NULL"},
       ${lit(JSON.stringify(scopes))}::jsonb,
       ${input.accessToken ? lit(input.accessToken) : "NULL"},
       ${input.refreshToken ? lit(input.refreshToken) : "NULL"},
       ${input.expiresAt ? lit(input.expiresAt) : "NULL"},
       ${input.status === "connected" ? "now()" : "NULL"},
       now()
     )
     ON CONFLICT (principal_id, provider) DO UPDATE SET
       status = EXCLUDED.status,
       account_email = COALESCE(EXCLUDED.account_email, ri_console.user_connector.account_email),
       scopes = EXCLUDED.scopes,
       access_token = ${input.clearTokens ? "NULL" : "COALESCE(EXCLUDED.access_token, ri_console.user_connector.access_token)"},
       refresh_token = ${input.clearTokens ? "NULL" : "COALESCE(EXCLUDED.refresh_token, ri_console.user_connector.refresh_token)"},
       expires_at = ${input.clearTokens ? "NULL" : "COALESCE(EXCLUDED.expires_at, ri_console.user_connector.expires_at)"},
       last_sync = CASE WHEN EXCLUDED.status = 'connected' THEN now() ELSE ri_console.user_connector.last_sync END,
       updated_at = now()`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId,
    principalId,
    traceId: span.traceId,
    eventType: `connector.${input.status}`,
    entityKind: "user_connector",
    entityId: input.provider,
    payload: { provider: input.provider, status: input.status },
  });
  await endSpan(span, "OK");

  return { ok: true, provider: input.provider, status: input.status };
}

export async function createConnectorRoute(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  principalId: string,
  activeWorkspaceIds: string[],
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = CreateRouteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "BAD_REQUEST",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      },
    };
  }
  const data = parsed.data;
  if (!activeWorkspaceIds.includes(data.targetWorkspaceId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "TARGET_NOT_MEMBER",
        detail: "target workspace is not one of your active workspaces",
      },
    };
  }
  if (data.targetProjectId) {
    const proj = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT 1 AS ok FROM ri_console.project_member WHERE project_id = ${lit(data.targetProjectId)} AND workspace_id = ${lit(data.targetWorkspaceId)} AND principal_id = ${lit(principalId)} LIMIT 1`,
    );
    if (proj.length === 0) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "TARGET_NOT_MEMBER",
          detail: "target project is not in that workspace for you",
        },
      };
    }
  }
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const id = randomUUID();
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.connector_route
       (id, principal_id, provider, match_expr, target_workspace_id, target_project_id, cadence)
     VALUES (
       ${lit(id)},
       ${lit(principalId)},
       ${lit(data.provider)},
       ${lit(data.matchExpr)},
       ${lit(data.targetWorkspaceId)},
       ${data.targetProjectId ? lit(data.targetProjectId) : "NULL"},
       ${lit(data.cadence)}
     )`,
  );
  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId: data.targetWorkspaceId,
    projectId: data.targetProjectId ?? null,
    principalId,
    eventType: "connector.route_created",
    entityKind: "connector_route",
    entityId: id,
    payload: {
      provider: data.provider,
      matchExpr: data.matchExpr,
      cadence: data.cadence,
    },
  });
  return {
    ok: true,
    status: 200,
    body: {
      id,
      provider: data.provider,
      matchExpr: data.matchExpr,
      targetWorkspaceId: data.targetWorkspaceId,
      targetProjectId: data.targetProjectId ?? null,
      cadence: data.cadence,
    },
  };
}

export async function deleteConnectorRoute(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  principalId: string,
  routeId: string,
): Promise<{ deleted: true; id: string }> {
  await octoSql(
    config,
    token,
    octoContainerId,
    `DELETE FROM ri_console.connector_route
      WHERE id = ${lit(routeId)} AND principal_id = ${lit(principalId)}`,
  );
  return { deleted: true, id: routeId };
}
