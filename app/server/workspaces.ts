/**
 * Single-Octo Slack-like workspace, project-membership, and invite lifecycle
 * (RI-0018, superseding the Octo-workspace-per-tenant path in RI-0013 / #38).
 *
 * The entire application runs inside ONE Octo workspace (`OCTO_WORKSPACE_ID`).
 * Organizations, App Workspaces, Projects, and many-to-many memberships live
 * as tables in `ri_console` inside that single Octo container — so creating a
 * workspace or inviting teammates works immediately with zero `OCTO_ACCOUNT_KEY`.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Env } from "./env.js";
import { type OctoClientConfig, OctoError } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { normalizeRole, type WorkspaceRole } from "./tenancy.js";
import { octoSql } from "./world.js";

export const DDL_VERSION = "2026-11-20.1";

const CONSOLE_TABLES = [
  "agent",
  "agent_task",
  "agent_run",
  "approval",
  "activity",
  "project",
  "objective",
  "mission",
  "plan",
  "connector",
  "mcp_server",
  "plugin",
  "folder",
  "file_doc",
  "note",
  "retrospective",
  "smart_list",
] as const;

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";

export const RI_CONSOLE_DDL: string[] = [
  "CREATE SCHEMA IF NOT EXISTS ri_console",
  `CREATE TABLE IF NOT EXISTS ri_console.workspace_meta (
    workspace_id TEXT PRIMARY KEY,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ddl_version TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.app_user (
    id TEXT PRIMARY KEY,
    principal_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.workspace (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'team',
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.organization_member (
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.workspace_member (
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    principal_id TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    invited_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, email)
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_member_principal ON ri_console.workspace_member (principal_id)`,
  `CREATE TABLE IF NOT EXISTS ri_console.project_member (
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    principal_id TEXT,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, email)
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.ledger_event (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT,
    principal_id TEXT NOT NULL,
    agent_id TEXT,
    run_id TEXT,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_event_scope ON ri_console.ledger_event (workspace_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ledger_event_trace ON ri_console.ledger_event (trace_id)`,
  `CREATE TABLE IF NOT EXISTS ri_console.user_connector (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'needs_setup',
    account_email TEXT,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    last_sync TIMESTAMPTZ,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (principal_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.connector_route (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    match_expr TEXT NOT NULL,
    target_workspace_id TEXT NOT NULL,
    target_project_id TEXT,
    cadence TEXT NOT NULL DEFAULT 'signal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS connector_route_principal ON ri_console.connector_route (principal_id, provider)`,
  ...CONSOLE_TABLES.map(
    (table) => `CREATE TABLE IF NOT EXISTS ri_console.${table} (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      principal_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'shared',
      doc JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ),
  ...CONSOLE_TABLES.map(
    (table) =>
      `CREATE INDEX IF NOT EXISTS ${table}_scope ON ri_console.${table} (workspace_id, visibility)`,
  ),
  `CREATE TABLE IF NOT EXISTS ri_console.conversation (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    scope_kind TEXT NOT NULL DEFAULT 'workspace',
    scope_id TEXT,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ri_console.conversation(id),
    role TEXT NOT NULL,
    parts JSONB NOT NULL,
    provider TEXT,
    model TEXT,
    reasoning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS conversation_scope ON ri_console.conversation (workspace_id, principal_id)`,
  `CREATE INDEX IF NOT EXISTS message_conversation ON ri_console.message (conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ri_console.profile (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    doc JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, principal_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.file_link (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS file_link_file ON ri_console.file_link (workspace_id, file_id)`,
  `CREATE INDEX IF NOT EXISTS file_link_entity ON ri_console.file_link (entity_kind, entity_id)`,
];

export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  kind: z.enum(["team", "personal"]).optional().default("team"),
  organizationId: z.string().trim().optional(),
});

export const InviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  role: z.enum(["admin", "operator", "member"]).default("member"),
});

export interface MemberRecord {
  email: string;
  principalId: string | null;
  displayName: string;
  role: WorkspaceRole;
  status: "active" | "pending";
}

export async function provisionWorkspace(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
): Promise<{ workspaceId: string; provisioned: true; ddlVersion: string }> {
  for (const statement of RI_CONSOLE_DDL) {
    await octoSql(config, token, octoContainerId, statement);
  }
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.workspace_meta (workspace_id, provisioned_at, ddl_version)
     VALUES (${lit(octoContainerId)}, now(), ${lit(DDL_VERSION)})
     ON CONFLICT (workspace_id)
     DO UPDATE SET ddl_version = EXCLUDED.ddl_version`,
  );
  return {
    workspaceId: octoContainerId,
    provisioned: true,
    ddlVersion: DDL_VERSION,
  };
}

/**
 * Ensure the single-Octo `ri_console.workspace` + `workspace_member` tables
 * exist, and seed the default container workspace + user's Personal workspace.
 */
export async function ensureAppWorkspaceTables(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
): Promise<void> {
  const existing = await octoSql(
    config,
    token,
    octoContainerId,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ri_console' AND table_name IN ('workspace', 'workspace_member', 'ledger_event', 'user_connector', 'connector_route')",
  );
  if (existing.length < 5) {
    await provisionWorkspace(config, token, octoContainerId);
  }
}

/**
 * Create a new Slack-style App Workspace inside the single Octo container.
 * No OCTO_ACCOUNT_KEY needed — inserts directly into `ri_console.workspace`
 * and adds the creator as `owner` in `ri_console.workspace_member`.
 */
export async function createAppWorkspace(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  creator: { id: string; email: string; displayName: string },
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = CreateWorkspaceSchema.safeParse(rawBody);
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

  const span = startSpan({
    name: "workspace.create",
    kind: "CHAIN",
    principalId: creator.id,
    cadence: "interactive",
    attributes: { "ri.workspace_kind": parsed.data.kind },
  });

  await ensureAppWorkspaceTables(config, token, octoContainerId);

  const id = randomUUID();
  const slug = slugify(parsed.data.name);
  const email = creator.email.trim().toLowerCase() || `${creator.id}@local`;

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.workspace (id, organization_id, name, slug, kind, description, created_by)
     VALUES (
       ${lit(id)},
       ${parsed.data.organizationId ? lit(parsed.data.organizationId) : "NULL"},
       ${lit(parsed.data.name)},
       ${lit(slug)},
       ${lit(parsed.data.kind)},
       ${lit(parsed.data.description ?? "")},
       ${lit(creator.id)}
     )`,
  );

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.workspace_member (workspace_id, email, principal_id, display_name, role, status, invited_by)
     VALUES (
       ${lit(id)},
       ${lit(email)},
       ${lit(creator.id)},
       ${lit(creator.displayName || email)},
       'owner',
       'active',
       ${lit(creator.id)}
     )
     ON CONFLICT (workspace_id, email) DO UPDATE
       SET principal_id = EXCLUDED.principal_id, role = 'owner', status = 'active'`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId: id,
    principalId: creator.id,
    traceId: span.traceId,
    eventType: "workspace.created",
    entityKind: "workspace",
    entityId: id,
    payload: { name: parsed.data.name, kind: parsed.data.kind },
  });
  await endSpan(span, "OK", { "ri.workspace_id": id });

  return {
    ok: true,
    status: 200,
    body: {
      id,
      slug,
      name: parsed.data.name,
      kind: parsed.data.kind,
      role: "owner",
      provisioned: true,
      ddlVersion: DDL_VERSION,
      traceId: span.traceId,
    },
  };
}

export async function inviteWorkspaceMember(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  appWorkspaceId: string,
  invitedBy: string,
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = InviteMemberSchema.safeParse(rawBody);
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
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const email = parsed.data.email;
  const existingUsers = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT principal_id, display_name FROM ri_console.app_user WHERE email = ${lit(email)} LIMIT 1`,
  );
  const existingUser = existingUsers[0];
  const principalId =
    typeof existingUser?.principal_id === "string"
      ? existingUser.principal_id
      : null;
  const displayName =
    typeof existingUser?.display_name === "string"
      ? existingUser.display_name
      : email;
  const status = principalId ? "active" : "pending";

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.workspace_member (workspace_id, email, principal_id, display_name, role, status, invited_by)
     VALUES (
       ${lit(appWorkspaceId)},
       ${lit(email)},
       ${principalId ? lit(principalId) : "NULL"},
       ${lit(displayName)},
       ${lit(parsed.data.role)},
       ${lit(status)},
       ${lit(invitedBy)}
     )
     ON CONFLICT (workspace_id, email) DO UPDATE
       SET role = EXCLUDED.role,
           principal_id = COALESCE(EXCLUDED.principal_id, ri_console.workspace_member.principal_id),
           status = CASE WHEN ri_console.workspace_member.status = 'active' THEN 'active' ELSE EXCLUDED.status END`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId: appWorkspaceId,
    principalId: invitedBy,
    eventType: "workspace.member_invited",
    entityKind: "workspace_member",
    entityId: email,
    payload: { email, role: parsed.data.role, status },
  });

  return {
    ok: true,
    status: 200,
    body: {
      email,
      role: parsed.data.role,
      status: status === "active" ? "added" : "pending",
    },
  };
}

export async function listWorkspaceMembers(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  appWorkspaceId: string,
): Promise<MemberRecord[]> {
  try {
    const rows = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT email, principal_id, display_name, role, status
         FROM ri_console.workspace_member
        WHERE workspace_id = ${lit(appWorkspaceId)}
          AND status <> 'revoked'
        ORDER BY created_at ASC`,
    );
    return rows.map((row) => ({
      email: String(row.email ?? "").toLowerCase(),
      principalId:
        typeof row.principal_id === "string" ? row.principal_id : null,
      displayName: String(row.display_name || row.email || "Teammate"),
      role: normalizeRole(row.role) ?? "member",
      status: String(row.status) === "pending" ? "pending" : "active",
    }));
  } catch {
    return [];
  }
}

export async function removeWorkspaceMember(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  appWorkspaceId: string,
  targetEmail: string,
  callerEmail: string,
  callerPrincipalId: string,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const normalizedTarget = targetEmail.trim().toLowerCase();
  if (normalizedTarget === callerEmail.trim().toLowerCase()) {
    return {
      ok: false,
      status: 403,
      body: { error: "CANNOT_REMOVE_SELF" },
    };
  }
  const members = await listWorkspaceMembers(
    config,
    token,
    octoContainerId,
    appWorkspaceId,
  );
  const existing = members.find((m) => m.email === normalizedTarget);
  if (existing?.role === "owner") {
    return {
      ok: false,
      status: 403,
      body: { error: "CANNOT_REMOVE_OWNER" },
    };
  }
  await octoSql(
    config,
    token,
    octoContainerId,
    `DELETE FROM ri_console.workspace_member
      WHERE workspace_id = ${lit(appWorkspaceId)} AND email = ${lit(normalizedTarget)}`,
  );
  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId: appWorkspaceId,
    principalId: callerPrincipalId,
    eventType: "workspace.member_removed",
    entityKind: "workspace_member",
    entityId: normalizedTarget,
    payload: { email: normalizedTarget },
  });
  return {
    ok: true,
    status: 200,
    body: { removed: true, email: normalizedTarget },
  };
}

/**
 * Own-Google callback membership resolution in the single-Octo model:
 * 1. Check `ri_console.workspace_member` for active or pending invite rows.
 * 2. Activate any pending invite rows and upsert `ri_console.app_user`.
 * 3. Fall back to Octo's `/api/workspaces/:id/members` for the container owner.
 */
export async function resolveOrActivateGoogleMember(
  config: OctoClientConfig,
  ownerKey: string,
  email: string,
  env?: Env,
  displayName?: string,
): Promise<{
  principalId: string;
  workspaceId: string;
  role: WorkspaceRole;
} | null> {
  const target = email.trim().toLowerCase();
  let containerId = (
    env?.OCTO_WORKSPACE_ID ??
    process.env.OCTO_WORKSPACE_ID ??
    ""
  ).trim();
  if (!containerId) {
    const wsRes = await fetch(new URL("/api/workspaces", config.baseUrl), {
      headers: {
        Authorization: `Bearer ${ownerKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!wsRes.ok) return null;
    const workspaces = (await wsRes.json()) as { id: string }[];
    containerId = workspaces[0]?.id ?? "";
  }
  if (!containerId) return null;

  // 1. Check ri_console.workspace_member first (single-Octo model)
  try {
    const rows = await octoSql(
      config,
      ownerKey,
      containerId,
      `SELECT workspace_id, principal_id, role, status
         FROM ri_console.workspace_member
        WHERE email = ${lit(target)} AND status IN ('active', 'pending')
        ORDER BY created_at ASC`,
    );
    if (rows.length > 0) {
      const first = rows[0];
      const existingPid =
        typeof first?.principal_id === "string" && first.principal_id
          ? first.principal_id
          : randomUUID();
      await octoSql(
        config,
        ownerKey,
        containerId,
        `INSERT INTO ri_console.app_user (id, principal_id, email, display_name)
         VALUES (${lit(existingPid)}, ${lit(existingPid)}, ${lit(target)}, ${lit(displayName || target)})
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name`,
      );
      await octoSql(
        config,
        ownerKey,
        containerId,
        `UPDATE ri_console.workspace_member
            SET principal_id = ${lit(existingPid)},
                display_name = ${lit(displayName || target)},
                status = 'active'
          WHERE email = ${lit(target)} AND status = 'pending'`,
      );
      return {
        principalId: existingPid,
        workspaceId: String(first?.workspace_id ?? containerId),
        role: normalizeRole(first?.role) ?? "member",
      };
    }
  } catch {
    // Fall through to Octo container member check if tables aren't provisioned yet.
  }

  // 2. Fallback: check Octo container members endpoint (handles initial owner bootstrap)
  try {
    const res = await fetch(
      new URL(`/api/workspaces/${containerId}/members`, config.baseUrl),
      {
        headers: {
          Authorization: `Bearer ${ownerKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as
      | Record<string, unknown>[]
      | { members?: Record<string, unknown>[] };
    const list = Array.isArray(body) ? body : (body.members ?? []);
    for (const row of list) {
      const p =
        row.principal && typeof row.principal === "object"
          ? (row.principal as Record<string, unknown>)
          : {};
      const rowEmail = String(row.email ?? p.email ?? "")
        .trim()
        .toLowerCase();
      if (rowEmail !== target) continue;
      const pid =
        typeof row.principalId === "string"
          ? row.principalId
          : typeof p.id === "string"
            ? p.id
            : null;
      if (pid) {
        return {
          principalId: pid,
          workspaceId: containerId,
          role: normalizeRole(row.role) ?? "member",
        };
      }
      // Pending Octo invite fallback
      const activateRes = await fetch(
        new URL(`/api/workspaces/${containerId}/members`, config.baseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ownerKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            email: target,
            role: normalizeRole(row.role) ?? "member",
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        },
      );
      if (activateRes.ok) {
        const act = (await activateRes.json()) as {
          principalId?: string;
          principal?: { id?: string };
        };
        const activatedPid = act.principalId ?? act.principal?.id;
        if (activatedPid) {
          return {
            principalId: activatedPid,
            workspaceId: containerId,
            role: normalizeRole(row.role) ?? "member",
          };
        }
      }
    }
  } catch (error) {
    if (error instanceof OctoError) throw error;
  }
  return null;
}
