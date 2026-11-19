import {
  FileLinkSchema,
  FilesViewSchema,
  FileUploadResultSchema,
  NoteSchema,
  RetroSchema,
  SelfProfileSchema,
  TeamMemberSchema,
  type FileLink,
  type FileScope,
  type FilesView,
  type FileUploadResult,
  type LinkEntityKind,
  type NewFileInput,
  type NewNoteInput,
  type ProfilePatch,
  type SelfProfile,
  type TeamMember,
} from "./profileTypes";
import type { Conversation, SessionMessage } from "./sessionTypes";
import type {
  ActivityEntry,
  Agent,
  AgentStatus,
  Approval,
  Connector,
  ConnectorStatus,
  DecisionInput,
  NewProposal,
  Note,
  Plugin,
  Retrospective,
  Session,
  SessionMode,
  World,
} from "./types";
import { z } from "zod";
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

const get = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path, { credentials: "same-origin" });
  if (response.status === 401) {
    throw new Error("Your session expired — sign in again.");
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail ?? `The workspace answered ${response.status}.`);
  }
  return (await response.json()) as T;
};

const patch = async <T,>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: "PATCH",
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

  async listSessions(): Promise<Conversation[]> {
    const response = await fetch(`/app-api/sessions?workspaceId=${encodeURIComponent(workspaceId())}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Sessions answered ${response.status}.`);
    return (await response.json()) as Conversation[];
  },

  async createSession(input): Promise<Conversation> {
    return post<Conversation>("/app-api/sessions", { workspaceId: workspaceId(), ...input });
  },

  async loadMessages(sessionId: string): Promise<SessionMessage[]> {
    const response = await fetch(`/app-api/sessions/${sessionId}/messages?workspaceId=${encodeURIComponent(workspaceId())}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Messages answered ${response.status}.`);
    return (await response.json()) as SessionMessage[];
  },

  async appendMessage(sessionId: string, message: SessionMessage): Promise<SessionMessage> {
    return post<SessionMessage>(`/app-api/sessions/${sessionId}/messages`, { workspaceId: workspaceId(), message });
  },

  async patchSession(sessionId: string, patch): Promise<Conversation> {
    const response = await fetch(`/app-api/sessions/${sessionId}?workspaceId=${encodeURIComponent(workspaceId())}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`Session patch answered ${response.status}.`);
    return (await response.json()) as Conversation;
  },

  /* RI-0010 task C: profile/team/knowledge through the adapter's profile
   * routes. The adapter enforces principal-private defaults and the scope
   * privacy rule server-side; responses are validated here at the boundary. */

  async loadProfile(): Promise<SelfProfile> {
    const data = await get<unknown>(
      `/app-api/profile?workspaceId=${encodeURIComponent(workspaceId())}`,
    );
    return SelfProfileSchema.parse(data);
  },

  async patchProfile(input: ProfilePatch): Promise<SelfProfile> {
    const data = await patch<unknown>("/app-api/profile", {
      workspaceId: workspaceId(),
      ...input,
    });
    return SelfProfileSchema.parse(data);
  },

  async loadTeam(): Promise<TeamMember[]> {
    const data = await get<unknown>(
      `/app-api/team?workspaceId=${encodeURIComponent(workspaceId())}`,
    );
    return z.array(TeamMemberSchema).parse(data);
  },

  async loadFiles(scope: FileScope): Promise<FilesView> {
    const data = await get<unknown>(
      `/app-api/files?workspaceId=${encodeURIComponent(workspaceId())}&scope=${scope}`,
    );
    return FilesViewSchema.parse(data);
  },

  async createFile(input: NewFileInput): Promise<FileUploadResult> {
    // Metadata only — the adapter returns an Octo Files upload hint; bytes
    // never travel through this interface.
    const data = await post<unknown>("/app-api/files", {
      workspaceId: workspaceId(),
      ...input,
    });
    return FileUploadResultSchema.parse(data);
  },

  async linkFile(
    fileId: string,
    link: { entityKind: LinkEntityKind; entityId: string },
  ): Promise<FileLink> {
    const data = await post<{ link: unknown }>(
      `/app-api/files/${encodeURIComponent(fileId)}/link`,
      { workspaceId: workspaceId(), ...link },
    );
    return FileLinkSchema.parse(data.link);
  },

  async loadNotes(): Promise<Note[]> {
    const data = await get<unknown>(
      `/app-api/notes?workspaceId=${encodeURIComponent(workspaceId())}`,
    );
    return z.array(NoteSchema).parse(data);
  },

  async createNote(input: NewNoteInput): Promise<Note> {
    const data = await post<unknown>("/app-api/notes", {
      workspaceId: workspaceId(),
      ...input,
    });
    return NoteSchema.parse(data);
  },

  async loadRetros(): Promise<Retrospective[]> {
    const data = await get<unknown>(
      `/app-api/retros?workspaceId=${encodeURIComponent(workspaceId())}`,
    );
    return z.array(RetroSchema).parse(data);
  },

  async logActivity(input: NewActivity): Promise<ActivityEntry> {
    return post<ActivityEntry>("/app-api/activity", {
      workspaceId: workspaceId(),
      entry: input,
    });
  },
});
