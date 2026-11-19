import type {
  ActivityEntry,
  Agent,
  AgentStatus,
  Approval,
  Connector,
  ConnectorStatus,
  DecisionInput,
  NewProposal,
  Plugin,
  Session,
  SessionMode,
  World,
} from "./types";
import type {
  ApprovalDecisionResult,
  MissionControlSource,
  NewActivity,
} from "./source";

/**
 * The Octo-backed source: owner mode.
 *
 * Every call goes to the app adapter (`/app-api/*`) on the same origin, which
 * holds the sealed session cookie and talks to Octo with the signed-in
 * principal's token. The browser never sees a token or the workspace key, and
 * Octo enforces memberships per person. Guest mode never touches this source.
 */

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    throw new Error("Your session expired — sign in again.");
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail ?? `The workspace answered ${response.status}.`);
  }
  return (await response.json()) as T;
};

export const createOctoSource = (workspaceId: () => string): MissionControlSource => ({
  kind: "octo",

  async loadWorld(scope?: string): Promise<World> {
    const id = scope ?? workspaceId();
    const response = await fetch(
      `/app-api/world?workspaceId=${encodeURIComponent(id)}`,
      { credentials: "same-origin" },
    );
    if (response.status === 401) {
      throw new Error("Your session expired — sign in again.");
    }
    if (!response.ok) {
      throw new Error(`The workspace answered ${response.status}.`);
    }
    return (await response.json()) as World;
  },

  async signIn(mode: SessionMode): Promise<Session> {
    if (mode !== "owner") {
      throw new Error("The Octo source only signs in owners; guests use the demo.");
    }
    // The adapter owns the Google-through-Octo handshake and seals the cookie.
    // Return to the console's own base path after the callback.
    const returnTo = import.meta.env.BASE_URL || "/";
    window.location.assign(
      `/octo-auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
    // Navigation is in flight; this promise never settles in this document.
    return new Promise<Session>(() => {});
  },

  async decideApproval(input: DecisionInput): Promise<ApprovalDecisionResult> {
    return post<ApprovalDecisionResult>("/app-api/decision", {
      workspaceId: workspaceId(),
      ...input,
    });
  },

  async addProposal(input: NewProposal): Promise<Approval> {
    return post<Approval>("/app-api/proposal", {
      workspaceId: workspaceId(),
      proposal: input,
    });
  },

  async setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent> {
    return post<Agent>("/app-api/agent-status", {
      workspaceId: workspaceId(),
      agentId,
      status,
    });
  },

  async setConnectorStatus(
    connectorId: string,
    status: ConnectorStatus,
  ): Promise<Connector> {
    return post<Connector>("/app-api/connector-status", {
      workspaceId: workspaceId(),
      connectorId,
      status,
    });
  },

  async setPluginInstalled(pluginId: string, installed: boolean): Promise<Plugin> {
    return post<Plugin>("/app-api/plugin-installed", {
      workspaceId: workspaceId(),
      pluginId,
      installed,
    });
  },

  async logActivity(input: NewActivity): Promise<ActivityEntry> {
    return post<ActivityEntry>("/app-api/activity", {
      workspaceId: workspaceId(),
      entry: input,
    });
  },
});
