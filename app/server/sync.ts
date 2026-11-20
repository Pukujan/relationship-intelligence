/**
 * Live read-only sync workers for user-level connectors (RI-0019):
 *   - Gmail (`gmail`): recent threads (metadata + snippet)
 *   - Google Calendar (`gcal`): upcoming 14-day events (T-7d / T-24h prep)
 *   - Google Drive (`gdrive`): recently modified files & docs
 *   - Zoom (`zoom`): upcoming meetings
 *
 * Every synced item is matched against `ri_console.connector_route` (falling
 * back to the caller's active workspace), upserted idempotently into
 * `ri_console.activity`, and audited in `ri_console.ledger_event` with a
 * Phoenix OTLP `trace_id`.
 */

import type {
  ConnectorProviderId,
  ConnectorRouteRecord,
} from "./connectors.js";
import type { Env } from "./env.js";
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { ensureAppWorkspaceTables } from "./workspaces.js";
import { octoSql } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

export interface SyncedSignal {
  externalId: string;
  provider: ConnectorProviderId;
  title: string;
  detail: string;
  occurredAt: string;
  matchText: string;
  url?: string;
}

export interface SyncResult {
  ok: true;
  provider: ConnectorProviderId;
  syncedCount: number;
  routedWorkspaces: string[];
  traceId: string;
  items: {
    id: string;
    title: string;
    workspaceId: string;
    projectId: string | null;
  }[];
}

export function matchConnectorRoute(
  routes: ConnectorRouteRecord[],
  provider: string,
  matchText: string,
  fallbackWorkspaceId: string,
): { workspaceId: string; projectId: string | null; cadence: string } {
  const haystack = matchText.toLowerCase();
  for (const route of routes) {
    if (route.provider !== provider) continue;
    const terms = route.matchExpr
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (terms.some((term) => term === "*" || haystack.includes(term))) {
      return {
        workspaceId: route.targetWorkspaceId,
        projectId: route.targetProjectId,
        cadence: route.cadence,
      };
    }
  }
  return {
    workspaceId: fallbackWorkspaceId,
    projectId: null,
    cadence: "signal",
  };
}

async function refreshProviderToken(
  env: Env,
  provider: ConnectorProviderId,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string | null } | null> {
  if (provider === "gmail" || provider === "gcal" || provider === "gdrive") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
    };
  }
  if (provider === "zoom") {
    if (!env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) return null;
    const basic = Buffer.from(
      `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
    };
  }
  return null;
}

async function fetchGmailSignals(accessToken: string): Promise<SyncedSignal[]> {
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=newer_than:7d",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
  const listBody = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (listBody.messages ?? []).slice(0, 8);
  const signals: SyncedSignal[] = [];
  for (const m of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      id: string;
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const headers = msg.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
    const subject = header("subject") || "(no subject)";
    const from = header("from");
    const occurredAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString();
    signals.push({
      externalId: msg.id,
      provider: "gmail",
      title: `Gmail: ${subject}`,
      detail: `${from ? `From ${from} — ` : ""}${msg.snippet ?? ""}`.slice(
        0,
        240,
      ),
      occurredAt,
      matchText: `${from} ${subject} ${msg.snippet ?? ""}`,
    });
  }
  return signals;
}

async function fetchGcalSignals(accessToken: string): Promise<SyncedSignal[]> {
  const nowMs = Date.now();
  const timeMin = new Date(nowMs - 86_400_000).toISOString();
  const timeMax = new Date(nowMs + 14 * 86_400_000).toISOString();
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "12");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Calendar list failed (${res.status})`);
  const body = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      description?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      attendees?: { email?: string; displayName?: string }[];
    }[];
  };
  return (body.items ?? []).map((ev) => {
    const start =
      ev.start?.dateTime ?? ev.start?.date ?? new Date().toISOString();
    const attendees = (ev.attendees ?? [])
      .map((a) => a.displayName || a.email || "")
      .filter(Boolean)
      .slice(0, 5);
    const title = ev.summary || "Calendar event";
    return {
      externalId: ev.id,
      provider: "gcal",
      title: `Calendar: ${title}`,
      detail: `${start}${attendees.length ? ` · With ${attendees.join(", ")}` : ""}`,
      occurredAt: start,
      matchText: `${title} ${ev.description ?? ""} ${attendees.join(" ")}`,
      ...(ev.htmlLink ? { url: ev.htmlLink } : {}),
    };
  });
}

async function fetchGdriveSignals(
  accessToken: string,
): Promise<SyncedSignal[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("q", "trashed=false");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,webViewLink)",
  );
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Drive list failed (${res.status})`);
  const body = (await res.json()) as {
    files?: {
      id: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }[];
  };
  return (body.files ?? []).map((f) => ({
    externalId: f.id,
    provider: "gdrive",
    title: `Drive: ${f.name ?? "Untitled file"}`,
    detail: `Updated ${f.modifiedTime ?? "recently"}${f.webViewLink ? ` · ${f.webViewLink}` : ""}`,
    occurredAt: f.modifiedTime ?? new Date().toISOString(),
    matchText: `${f.name ?? ""} ${f.mimeType ?? ""}`,
    ...(f.webViewLink ? { url: f.webViewLink } : {}),
  }));
}

async function fetchZoomSignals(accessToken: string): Promise<SyncedSignal[]> {
  const res = await fetch(
    "https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=10",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`Zoom meetings failed (${res.status})`);
  const body = (await res.json()) as {
    meetings?: {
      id: string | number;
      topic?: string;
      start_time?: string;
      join_url?: string;
    }[];
  };
  return (body.meetings ?? []).map((m) => ({
    externalId: String(m.id),
    provider: "zoom",
    title: `Zoom: ${m.topic ?? "Meeting"}`,
    detail: `${m.start_time ?? "Upcoming"}${m.join_url ? ` · ${m.join_url}` : ""}`,
    occurredAt: m.start_time ?? new Date().toISOString(),
    matchText: `${m.topic ?? ""}`,
    ...(m.join_url ? { url: m.join_url } : {}),
  }));
}

export async function syncUserConnector(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  activeWorkspaceId: string,
  principalId: string,
  provider: ConnectorProviderId,
  env: Env,
): Promise<
  SyncResult | { ok: false; status: number; error: string; detail: string }
> {
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT status, access_token, refresh_token, expires_at
       FROM ri_console.user_connector
      WHERE principal_id = ${lit(principalId)} AND provider = ${lit(provider)}
      LIMIT 1`,
  );
  const row = rows[0];
  if (
    !row ||
    row.status !== "connected" ||
    typeof row.access_token !== "string"
  ) {
    return {
      ok: false,
      status: 400,
      error: "CONNECTOR_NOT_CONNECTED",
      detail: `${provider} is not connected yet. Authorize it first.`,
    };
  }

  let accessToken = row.access_token;
  const expiresAt =
    typeof row.expires_at === "string"
      ? Date.parse(row.expires_at)
      : Number.NaN;
  if (
    Number.isFinite(expiresAt) &&
    expiresAt - Date.now() < 60_000 &&
    typeof row.refresh_token === "string" &&
    row.refresh_token
  ) {
    const refreshed = await refreshProviderToken(
      env,
      provider,
      row.refresh_token,
    );
    if (refreshed) {
      accessToken = refreshed.accessToken;
      await octoSql(
        config,
        token,
        octoContainerId,
        `UPDATE ri_console.user_connector
            SET access_token = ${lit(accessToken)},
                expires_at = ${refreshed.expiresAt ? lit(refreshed.expiresAt) : "NULL"},
                updated_at = now()
          WHERE principal_id = ${lit(principalId)} AND provider = ${lit(provider)}`,
      );
    }
  }

  const span = startSpan({
    name: `connector.sync.${provider}`,
    kind: "TOOL",
    workspaceId: activeWorkspaceId,
    principalId,
    cadence: provider === "gcal" ? "pre_event" : "signal",
    attributes: { "ri.connector_provider": provider },
  });

  let signals: SyncedSignal[];
  try {
    if (provider === "gmail") {
      signals = await fetchGmailSignals(accessToken);
    } else if (provider === "gcal") {
      signals = await fetchGcalSignals(accessToken);
    } else if (provider === "gdrive") {
      signals = await fetchGdriveSignals(accessToken);
    } else if (provider === "zoom") {
      signals = await fetchZoomSignals(accessToken);
    } else {
      await endSpan(span, "ERROR", { "ri.reason": "unsupported_provider" });
      return {
        ok: false,
        status: 501,
        error: "SYNC_NOT_IMPLEMENTED",
        detail: `Live sync worker for ${provider} is not enabled yet.`,
      };
    }
  } catch (error) {
    await endSpan(span, "ERROR", {
      "ri.error": error instanceof Error ? error.message : "sync_failed",
    });
    return {
      ok: false,
      status: 502,
      error: "PROVIDER_SYNC_FAILED",
      detail: error instanceof Error ? error.message : "Provider sync failed",
    };
  }

  const routeRows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT id, provider, match_expr, target_workspace_id, target_project_id, cadence, created_at
       FROM ri_console.connector_route
      WHERE principal_id = ${lit(principalId)} AND provider = ${lit(provider)}`,
  );
  const routes: ConnectorRouteRecord[] = routeRows.map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    matchExpr: String(r.match_expr),
    targetWorkspaceId: String(r.target_workspace_id),
    targetProjectId:
      typeof r.target_project_id === "string" ? r.target_project_id : null,
    cadence:
      r.cadence === "daily" || r.cadence === "pre_event" ? r.cadence : "signal",
    createdAt: String(r.created_at ?? ""),
  }));

  const routedSet = new Set<string>();
  const items: SyncResult["items"] = [];
  for (const sig of signals) {
    const dest = matchConnectorRoute(
      routes,
      provider,
      sig.matchText,
      activeWorkspaceId,
    );
    routedSet.add(dest.workspaceId);
    const id = `sync-${provider}-${sig.externalId}`;
    const doc = {
      id,
      at: sig.occurredAt,
      agentId: provider === "gcal" ? "chief-of-staff" : "research",
      type: "connector_sync",
      provider,
      projectId: dest.projectId,
      title: sig.title,
      detail: sig.detail,
      url: sig.url,
      traceId: span.traceId,
      outcome: "ok",
    };
    await octoSql(
      config,
      token,
      octoContainerId,
      `INSERT INTO ri_console.activity (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(id)}, ${lit(dest.workspaceId)}, ${lit(principalId)}, 'private', ${lit(JSON.stringify(doc))}::jsonb)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
    );
    items.push({
      id,
      title: sig.title,
      workspaceId: dest.workspaceId,
      projectId: dest.projectId,
    });
  }

  await octoSql(
    config,
    token,
    octoContainerId,
    `UPDATE ri_console.user_connector
        SET last_sync = now(), updated_at = now()
      WHERE principal_id = ${lit(principalId)} AND provider = ${lit(provider)}`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId: activeWorkspaceId,
    principalId,
    traceId: span.traceId,
    eventType: "connector.synced",
    entityKind: "user_connector",
    entityId: provider,
    payload: {
      provider,
      syncedCount: items.length,
      routedWorkspaces: [...routedSet].join(","),
    },
  });
  await endSpan(span, "OK", { "ri.synced_count": items.length });

  return {
    ok: true,
    provider,
    syncedCount: items.length,
    routedWorkspaces: [...routedSet],
    traceId: span.traceId,
    items,
  };
}
