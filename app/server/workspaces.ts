/**
 * Workspace creation, idempotent ri_console provisioning, and invite/member
 * lifecycle routes (RI-0013 / #38).
 *
 * Octo stays the sole principal and workspace store. Workspace creation
 * requires an account-scoped OCTO_ACCOUNT_KEY because Octo forbids
 * workspace-scoped keys from minting new workspaces; when absent, creation
 * reports a clean disabled-with-explanation state rather than a broken error.
 */

import { z } from "zod";
import type { Env } from "./env.js";
import { type OctoClientConfig, OctoError } from "./octo.js";
import { normalizeRole, type WorkspaceRole } from "./tenancy.js";
import { octoSql } from "./world.js";

export const DDL_VERSION = "2026-11-19.1";

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

export const RI_CONSOLE_DDL: string[] = [
  "CREATE SCHEMA IF NOT EXISTS ri_console",
  `CREATE TABLE IF NOT EXISTS ri_console.workspace_meta (
    workspace_id TEXT PRIMARY KEY,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ddl_version TEXT NOT NULL
  )`,
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
});

export const InviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  role: z.enum(["admin", "operator", "member"]).default("member"),
});

export async function provisionWorkspace(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
): Promise<{ workspaceId: string; provisioned: true; ddlVersion: string }> {
  for (const statement of RI_CONSOLE_DDL) {
    await octoSql(config, token, workspaceId, statement);
  }
  await octoSql(
    config,
    token,
    workspaceId,
    `INSERT INTO ri_console.workspace_meta (workspace_id, provisioned_at, ddl_version)
     VALUES (${lit(workspaceId)}, now(), ${lit(DDL_VERSION)})
     ON CONFLICT (workspace_id)
     DO UPDATE SET ddl_version = EXCLUDED.ddl_version`,
  );
  return { workspaceId, provisioned: true, ddlVersion: DDL_VERSION };
}

export async function createWorkspaceWithProvision(
  config: OctoClientConfig,
  _env: Env,
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const accountKey = (process.env.OCTO_ACCOUNT_KEY ?? "").trim();
  if (!accountKey) {
    return {
      ok: false,
      status: 501,
      body: {
        error: "ACCOUNT_KEY_REQUIRED",
        disabled: true,
        detail:
          "Workspace creation is disabled until an account-scoped OCTO_ACCOUNT_KEY is configured on the server.",
      },
    };
  }
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

  const response = await fetch(new URL("/api/workspaces", config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accountKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: parsed.data.name,
      ...(parsed.data.description
        ? { description: parsed.data.description }
        : {}),
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for POST /api/workspaces`,
    );
  }
  const created = JSON.parse(text) as {
    id?: string;
    name?: string;
    workspace?: { id?: string; name?: string };
  };
  const id = created.id ?? created.workspace?.id;
  const name = created.name ?? created.workspace?.name ?? parsed.data.name;
  if (!id) {
    throw new OctoError(502, "Octo returned workspace without id");
  }

  try {
    const prov = await provisionWorkspace(config, accountKey, id);
    return {
      ok: true,
      status: 200,
      body: {
        id,
        name,
        role: "owner",
        provisioned: true,
        ddlVersion: prov.ddlVersion,
      },
    };
  } catch (error) {
    return {
      ok: true,
      status: 202,
      body: {
        id,
        name,
        role: "owner",
        status: "unprovisioned",
        retryPath: `/app-api/workspaces/${id}/provision`,
        detail: error instanceof Error ? error.message : "provisioning failed",
      },
    };
  }
}

export async function inviteWorkspaceMember(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
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
  const response = await fetch(
    new URL(`/api/workspaces/${workspaceId}/members`, config.baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for POST /api/workspaces/${workspaceId}/members`,
    );
  }
  const result = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  const status =
    result.status === "added" || result.principalId ? "added" : "pending";
  return {
    ok: true,
    status: 200,
    body: {
      email: parsed.data.email,
      role: parsed.data.role,
      status,
    },
  };
}

export interface MemberRecord {
  email: string;
  principalId: string | null;
  displayName: string;
  role: WorkspaceRole;
  status: "active" | "pending";
}

export async function listWorkspaceMembers(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
): Promise<MemberRecord[]> {
  const response = await fetch(
    new URL(`/api/workspaces/${workspaceId}/members`, config.baseUrl),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  );
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for GET /api/workspaces/${workspaceId}/members`,
    );
  }
  const body = (await response.json()) as
    | Record<string, unknown>[]
    | { members?: Record<string, unknown>[] };
  const list = Array.isArray(body) ? body : (body.members ?? []);
  return list
    .map((row): MemberRecord | null => {
      const p =
        row.principal && typeof row.principal === "object"
          ? (row.principal as Record<string, unknown>)
          : {};
      const email = String(row.email ?? p.email ?? "")
        .trim()
        .toLowerCase();
      const principalId =
        typeof row.principalId === "string"
          ? row.principalId
          : typeof p.id === "string"
            ? p.id
            : null;
      if (!email && !principalId) return null;
      const rawStatus = String(row.status ?? "active").toLowerCase();
      if (rawStatus === "revoked") return null;
      return {
        email,
        principalId,
        displayName: String(p.displayName ?? p.name ?? email ?? "Teammate"),
        role: normalizeRole(row.role) ?? "member",
        status:
          rawStatus === "pending" || rawStatus === "invited" || !principalId
            ? "pending"
            : "active",
      };
    })
    .filter((row): row is MemberRecord => row !== null);
}

export async function removeWorkspaceMember(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  targetEmail: string,
  callerEmail: string,
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
  const members = await listWorkspaceMembers(config, token, workspaceId);
  const existing = members.find((m) => m.email === normalizedTarget);
  if (existing?.role === "owner") {
    return {
      ok: false,
      status: 403,
      body: { error: "CANNOT_REMOVE_OWNER" },
    };
  }
  const response = await fetch(
    new URL(
      `/api/workspaces/${workspaceId}/members/${encodeURIComponent(normalizedTarget)}`,
      config.baseUrl,
    ),
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for DELETE member`,
    );
  }
  return {
    ok: true,
    status: 200,
    body: { removed: true, email: normalizedTarget },
  };
}

/**
 * Own-Google callback membership resolution (SDD §2):
 * 1. Active member row -> return its principalId.
 * 2. Pending invite row -> activate via POST members with owner key.
 * 3. Neither -> return null (caller redirects to explicit join screen).
 */
export async function resolveOrActivateGoogleMember(
  config: OctoClientConfig,
  ownerKey: string,
  email: string,
): Promise<{
  principalId: string;
  workspaceId: string;
  role: WorkspaceRole;
} | null> {
  const target = email.trim().toLowerCase();
  const wsRes = await fetch(new URL("/api/workspaces", config.baseUrl), {
    headers: {
      Authorization: `Bearer ${ownerKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!wsRes.ok) return null;
  const workspaces = (await wsRes.json()) as { id: string }[];

  let pendingMatch: { workspaceId: string; role: WorkspaceRole } | null = null;
  for (const ws of workspaces) {
    let members: MemberRecord[];
    try {
      members = await listWorkspaceMembers(config, ownerKey, ws.id);
    } catch {
      continue;
    }
    const active = members.find(
      (m) => m.email === target && m.status === "active" && m.principalId,
    );
    if (active?.principalId) {
      return {
        principalId: active.principalId,
        workspaceId: ws.id,
        role: active.role,
      };
    }
    const pending = members.find(
      (m) => m.email === target && m.status === "pending",
    );
    if (pending && !pendingMatch) {
      pendingMatch = { workspaceId: ws.id, role: pending.role };
    }
  }

  if (pendingMatch) {
    const res = await fetch(
      new URL(
        `/api/workspaces/${pendingMatch.workspaceId}/members`,
        config.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email: target, role: pendingMatch.role }),
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    );
    if (res.ok) {
      const activated = (await res.json()) as {
        principalId?: string;
        principal?: { id?: string };
      };
      const pid = activated.principalId ?? activated.principal?.id;
      if (pid) {
        return {
          principalId: pid,
          workspaceId: pendingMatch.workspaceId,
          role: pendingMatch.role,
        };
      }
    }
  }
  return null;
}
