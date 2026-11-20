/**
 * Single tenancy and role enforcement choke (RI-0012 / #37).
 *
 * Octo remains the sole authority for principals, workspace memberships, and
 * roles. This module ensures principalId-mode sessions (our own Google OAuth
 * flow) resolve workspace memberships against Octo's members endpoint for the
 * session principal — never against the server-side owner key's workspace list.
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

/**
 * Fetch the active members of a single workspace from Octo.
 * Returns [] if the workspace forbids member listing or returns non-2xx.
 */
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

export interface ResolvedIdentity {
  principal: OctoPrincipal;
  workspaces: OctoWorkspace[];
  /** Bearer token used for Octo API calls on behalf of this session. */
  token: string;
}

/**
 * Resolve the authenticated principal and ONLY the workspaces where that
 * principal is an active member, carrying their effective Octo role.
 */
export async function resolvePrincipalWorkspaces(
  config: OctoClientConfig,
  env: Env,
  session: AppSession,
): Promise<ResolvedIdentity> {
  if (session.octoToken) {
    const token = session.octoToken;
    const isWorkspaceKey = /^octo_live_(ws|acc)_/.test(token);
    const [principal, rawWorkspaces] = await Promise.all([
      fetchPrincipal(config, token),
      fetchWorkspaces(config, token),
    ]);
    const workspaces: OctoWorkspace[] = rawWorkspaces.map((w) => ({
      ...w,
      role:
        normalizeRole(w.role) ??
        (w.isOwner || isWorkspaceKey ? "owner" : "member"),
    }));
    return { principal, workspaces, token };
  }

  // principalId-mode session (own Google OAuth flow): never trust the owner
  // key's workspace list directly — verify active membership per workspace.
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
  const memberWorkspaces: OctoWorkspace[] = [];
  for (const ws of allWorkspaces) {
    const members = await fetchWorkspaceMembers(config, ownerKey, ws.id);
    const hit = matchActiveMember(members, session.principalId, session.email);
    if (!hit) continue;
    const effectiveRole = normalizeRole(hit.role) ?? "member";
    memberWorkspaces.push({
      ...ws,
      role: effectiveRole,
      isOwner: effectiveRole === "owner",
    });
  }
  return { principal, workspaces: memberWorkspaces, token: ownerKey };
}

export type TenancyResult =
  | {
      ok: true;
      session: AppSession;
      principal: { id: string; displayName: string; email: string };
      role: WorkspaceRole;
      workspace: OctoWorkspace;
      workspaces: OctoWorkspace[];
      token: string;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

/**
 * Single tenancy enforcement choke for every workspace-scoped /app-api/* route.
 * Re-validates membership and effective role against Octo on every request.
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
    token: resolved.token,
  };
}
