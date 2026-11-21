/**
 * Single tenancy and role enforcement choke (RI-0012 / #37 + RI-0018).
 *
 * Single-Octo Slack-like model:
 *  - One Octo workspace (`octoWorkspaceId`) backs the entire application.
 *  - Inside `ri_console`, users belong to one or more App Workspaces via
 *    `ri_console.workspace` + `ri_console.workspace_member` (many-to-many).
 *  - Every workspace-scoped `/app-api/*` route passes through `resolveTenancy`,
 *    which returns both `octoWorkspaceId` (the single backing Octo container)
 *    and `workspace` (the active App Workspace the caller is a member of).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OctoPrincipal, OctoWorkspace } from "../shared/contracts.js";
import type { Env } from "./env.js";
import {
  fetchPrincipal,
  fetchWorkspaces,
  type OctoClientConfig,
  OctoError,
} from "./octo.js";
import { type AppSession, isIdleExpired, readSession } from "./session.js";
import { lit } from "./sql.js";
import { octoSql } from "./world.js";

export type WorkspaceRole = "owner" | "admin" | "operator" | "member";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  member: 1,
};

export function normalizeRole(raw: unknown): WorkspaceRole | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (
    lower === "owner" ||
    lower === "admin" ||
    lower === "operator" ||
    lower === "member"
  ) {
    return lower;
  }
  return null;
}

/** Mirrors Octo's role ordering: owner > admin > operator > member. */
export function roleMeetsMinimum(
  role: WorkspaceRole | null | undefined,
  minimum: WorkspaceRole,
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const requireRole = roleMeetsMinimum;

interface OctoMemberRow {
  email?: string;
  principalId?: string;
  principal?: { id?: string; email?: string };
  role?: string;
  status?: string;
}

async function fetchWorkspaceMembers(
  config: OctoClientConfig,
  bearer: string,
  workspaceId: string,
): Promise<OctoMemberRow[]> {
  const response = await fetch(
    new URL(`/api/workspaces/${workspaceId}/members`, config.baseUrl),
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  );
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return [];
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for /api/workspaces/${workspaceId}/members`,
    );
  }
  const body = (await response.json()) as
    | OctoMemberRow[]
    | { members?: OctoMemberRow[] };
  return Array.isArray(body) ? body : (body.members ?? []);
}

function matchActiveMember(
  members: OctoMemberRow[],
  principalId: string,
  email?: string,
): OctoMemberRow | null {
  const targetEmail = email?.trim().toLowerCase();
  for (const m of members) {
    const status = String(m.status ?? "active").toLowerCase();
    if (status === "revoked" || status === "pending" || status === "invited") {
      continue;
    }
    const mid = m.principalId ?? m.principal?.id;
    const memail = (m.email ?? m.principal?.email)?.trim().toLowerCase();
    if (
      (mid && mid === principalId) ||
      (targetEmail && memail && memail === targetEmail)
    ) {
      return m;
    }
  }
  return null;
}

/**
 * Load Slack-style App Workspaces from `ri_console.workspace` joined with
 * `ri_console.workspace_member` inside the single Octo container.
 * Returns [] cleanly if the tables aren't provisioned yet.
 */
async function loadAppWorkspacesFromSql(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  principalId: string,
  email?: string,
): Promise<OctoWorkspace[]> {
  try {
    const emailFilter = email
      ? `OR lower(m.email) = ${lit(email.trim().toLowerCase())}`
      : "";
    const rows = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT w.id, w.slug, w.name, m.role
         FROM ri_console.workspace w
         JOIN ri_console.workspace_member m ON m.workspace_id = w.id
        WHERE m.status = 'active'
          AND (m.principal_id = ${lit(principalId)} ${emailFilter})
        ORDER BY w.created_at ASC`,
    );
    return rows.map((row) => {
      const role = normalizeRole(row.role) ?? "member";
      return {
        id: String(row.id),
        slug: String(row.slug ?? row.id),
        name: String(row.name ?? "Workspace"),
        role,
        isOwner: role === "owner",
      };
    });
  } catch {
    return [];
  }
}

export interface ResolvedIdentity {
  principal: OctoPrincipal;
  workspaces: OctoWorkspace[];
  /** Single backing Octo workspace ID for all SQL and graph calls. */
  octoWorkspaceId: string;
  /** Bearer token used for Octo API calls on behalf of this session. */
  token: string;
}

/**
 * Resolve the authenticated principal, the single backing Octo container ID,
 * and ONLY the App Workspaces where that principal is an active member.
 */
export async function resolvePrincipalWorkspaces(
  config: OctoClientConfig,
  env: Env,
  session: AppSession,
): Promise<ResolvedIdentity> {
  const configuredContainer = (
    env.OCTO_WORKSPACE_ID ??
    process.env.OCTO_WORKSPACE_ID ??
    ""
  ).trim();

  if (session.octoToken) {
    const token = session.octoToken;
    const isWorkspaceKey = /^octo_live_(ws|acc)_/.test(token);
    const [principal, rawWorkspaces] = await Promise.all([
      fetchPrincipal(config, token),
      fetchWorkspaces(config, token),
    ]);
    const octoWorkspaces: OctoWorkspace[] = rawWorkspaces.map((w) => ({
      ...w,
      role:
        normalizeRole(w.role) ??
        (w.isOwner || isWorkspaceKey ? "owner" : "member"),
    }));
    const octoWorkspaceId = configuredContainer || octoWorkspaces[0]?.id || "";
    const appWorkspaces = octoWorkspaceId
      ? await loadAppWorkspacesFromSql(
          config,
          token,
          octoWorkspaceId,
          principal.id,
          principal.email,
        )
      : [];
    const byId = new Map<string, OctoWorkspace>();
    for (const w of octoWorkspaces) byId.set(w.id, w);
    for (const w of appWorkspaces) byId.set(w.id, w);
    return {
      principal,
      workspaces: [...byId.values()],
      octoWorkspaceId,
      token,
    };
  }

  // principalId-mode session (own Google OAuth flow): never trust the owner
  // key's workspace list directly — verify active membership in ri_console
  // and/or Octo members.
  const ownerKey = env.OCTO_API_KEY ?? "";
  if (!session.principalId || !ownerKey) {
    throw new OctoError(401, "Missing principal session or server key");
  }
  const principal: OctoPrincipal = {
    id: session.principalId,
    email: session.email ?? "",
    displayName: session.displayName ?? session.email ?? "",
    avatarUrl: null,
    isGuest: false,
    isPlatformOwner: false,
  };
  const allWorkspaces = await fetchWorkspaces(config, ownerKey);
  const octoWorkspaceId = configuredContainer || allWorkspaces[0]?.id || "";
  const byId = new Map<string, OctoWorkspace>();

  for (const ws of allWorkspaces) {
    const members = await fetchWorkspaceMembers(config, ownerKey, ws.id);
    const hit = matchActiveMember(members, session.principalId, session.email);
    if (!hit) continue;
    const effectiveRole = normalizeRole(hit.role) ?? "member";
    byId.set(ws.id, {
      ...ws,
      role: effectiveRole,
      isOwner: effectiveRole === "owner",
    });
  }

  if (octoWorkspaceId) {
    const appWorkspaces = await loadAppWorkspacesFromSql(
      config,
      ownerKey,
      octoWorkspaceId,
      session.principalId,
      session.email,
    );
    for (const w of appWorkspaces) byId.set(w.id, w);
  }

  return {
    principal,
    workspaces: [...byId.values()],
    octoWorkspaceId,
    token: ownerKey,
  };
}

export type TenancyResult =
  | {
      ok: true;
      session: AppSession;
      principal: { id: string; displayName: string; email: string };
      role: WorkspaceRole;
      workspace: OctoWorkspace;
      workspaces: OctoWorkspace[];
      octoWorkspaceId: string;
      token: string;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

/**
 * Single tenancy enforcement choke for every workspace-scoped /app-api/* route.
 */
export async function resolveTenancy(
  req: IncomingMessage,
  res: ServerResponse,
  env: Env,
  config: OctoClientConfig,
  requestedWorkspaceId?: string,
): Promise<TenancyResult> {
  const session = await readSession(req, res, env);
  if (!session.octoToken && !session.principalId) {
    return { ok: false, status: 401, body: { error: "UNAUTHENTICATED" } };
  }
  if (isIdleExpired(session)) {
    session.destroy();
    return {
      ok: false,
      status: 401,
      body: { error: "UNAUTHENTICATED", reason: "idle_expired" },
    };
  }
  let resolved: ResolvedIdentity;
  try {
    resolved = await resolvePrincipalWorkspaces(config, env, session);
  } catch (error) {
    if (
      error instanceof OctoError &&
      (error.status === 401 || error.status === 403)
    ) {
      return {
        ok: false,
        status: 401,
        body: { error: "UNAUTHENTICATED", reason: "octo_token_expired" },
      };
    }
    return { ok: false, status: 502, body: { error: "OCTO_UNAVAILABLE" } };
  }

  const targetId = requestedWorkspaceId || resolved.workspaces[0]?.id;
  const workspace = targetId
    ? resolved.workspaces.find((w) => w.id === targetId)
    : undefined;
  if (!workspace) {
    return {
      ok: false,
      status: 403,
      body: { error: "WORKSPACE_NOT_A_MEMBER" },
    };
  }

  const role = normalizeRole(workspace.role) ?? "member";
  session.role = role;
  session.lastSeenAt = Date.now();
  await session.save();

  return {
    ok: true,
    session,
    principal: {
      id: resolved.principal.id,
      displayName: resolved.principal.displayName ?? resolved.principal.email,
      email: resolved.principal.email,
    },
    role,
    workspace,
    workspaces: resolved.workspaces,
    octoWorkspaceId: resolved.octoWorkspaceId || workspace.id,
    token: resolved.token,
  };
}
