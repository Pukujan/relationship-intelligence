import { seedWorld } from "./seed";
import type {
  FileLink,
  FileScope,
  FilesView,
  FileUploadResult,
  LinkEntityKind,
  NewFileInput,
  NewNoteInput,
  ProfileFile,
  ProfilePatch,
  SelfProfile,
  TeamMember,
} from "./profileTypes";
import type { Conversation, SessionMessage } from "./sessionTypes";
import type {
  ActivityEntry,
  ActivityType,
  Agent,
  AgentStatus,
  Approval,
  Connector,
  ConnectorStatus,
  DecisionInput,
  MilestoneDesign,
  NewProposal,
  Note,
  Plugin,
  Project,
  Retrospective,
  Session,
  SessionMode,
  World,
} from "./types";

export interface ApprovalDecisionResult {
  approval: Approval;
  activity: ActivityEntry;
  agent: Agent;
  /**
   * Present when the decision changed more than the approval row — an
   * approved proposal materializes objectives, milestones, and plans. The
   * store adopts this snapshot whole so created work reaches every screen.
   */
  world?: World;
}

export interface NewActivity {
  agentId: string;
  type: ActivityType;
  title: string;
  detail: string;
  personId?: string;
  approvalId?: string;
  outcome?: ActivityEntry["outcome"];
}

/**
 * The single seam between the console and its data.
 *
 * Every screen reads and writes through this interface only, so the seed
 * implementation below can be replaced without touching a single component.
 *
 * To point the console at Octo, implement `MissionControlSource` with the
 * surfaces it already expects:
 *
 * - `loadWorld().people / companies / events / claims`
 *     → Octo epistemic API (facts + evidence). Claims must keep their source
 *       label and confidence; never promote an unsourced claim to canonical.
 * - `loadWorld().agents / tasks / runs / approvals / activity`
 *     → the workspace SQL surface:
 *       POST `${OCTO_BASE_URL}/api/workspaces/${OCTO_WORKSPACE_ID}/query`
 *       with `{ sql: "SELECT ... FROM <schema>.approvals" }`; read the `rows`
 *       array (each row is keyed by column name).
 * - search
 *     → Octo RAG + graph. The local source filters `world.people` in memory;
 *       when the directory moves server-side, add a `search(query)` method to
 *       this interface and call it from the People page instead.
 *
 * - `signIn(mode)`
 *     → Octo auth. `google` is the real OAuth handshake; it returns a session
 *       carrying the workspace the account owns. `guest` never authenticates:
 *       it opens the seeded demo workspace read-only in spirit, clearly
 *       labelled as a demo.
 * - `setConnectorStatus` / `setPluginInstalled`
 *     → workspace SQL writes. Connector credentials never travel through this
 *       interface — only status and the owning principal.
 *
 * The server call must live in an `/api/*` route (Nitro) because the Octo key
 * is server-only; this module would then fetch that route.
 */
export interface MissionControlSource {
  readonly kind: "local-seed" | "octo";
  loadWorld(workspaceId?: string): Promise<World>;
  signIn(mode: SessionMode): Promise<Session>;
  decideApproval(input: DecisionInput): Promise<ApprovalDecisionResult>;
  addProposal(input: NewProposal): Promise<Approval>;
  setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent>;
  setConnectorStatus(
    connectorId: string,
    status: ConnectorStatus,
  ): Promise<Connector>;
  setPluginInstalled(pluginId: string, installed: boolean): Promise<Plugin>;
  logActivity(input: NewActivity): Promise<ActivityEntry>;
  listSessions(): Promise<Conversation[]>;
  createSession(input: { title: string; scopeKind: string; scopeId?: string | null }): Promise<Conversation>;
  loadMessages(sessionId: string): Promise<SessionMessage[]>;
  appendMessage(sessionId: string, message: SessionMessage): Promise<SessionMessage>;
  patchSession(sessionId: string, patch: { title?: string; archived?: boolean; scopeKind?: string; scopeId?: string | null }): Promise<Conversation>;
  /* RI-0010 task C: self/team profile + personal knowledge.
   * Privacy contract (enforced by the Octo adapter, mirrored by the seed):
   * writes are principal-private by default; reads return own + shared;
   * "team"/"shared" file scopes never include another principal's private rows. */
  loadProfile(): Promise<SelfProfile>;
  patchProfile(patch: ProfilePatch): Promise<SelfProfile>;
  loadTeam(): Promise<TeamMember[]>;
  loadFiles(scope: FileScope): Promise<FilesView>;
  createFile(input: NewFileInput): Promise<FileUploadResult>;
  linkFile(fileId: string, link: { entityKind: LinkEntityKind; entityId: string }): Promise<FileLink>;
  loadNotes(): Promise<Note[]>;
  createNote(input: NewNoteInput): Promise<Note>;
  loadRetros(): Promise<Retrospective[]>;
}


/* RI-0010: guest sessions persist in sessionStorage so the demo resumes. */
const SESSIONS_KEY = "mission-control.sessions.v1";
interface SeedSessions {
  conversations: Conversation[];
  messages: Record<string, SessionMessage[]>;
}
const readSeedSessions = (): SeedSessions => {
  try {
    const raw = window.sessionStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as SeedSessions) : { conversations: [], messages: {} };
  } catch {
    return { conversations: [], messages: {} };
  }
};
const writeSeedSessions = (value: SeedSessions) => {
  try {
    window.sessionStorage.setItem(SESSIONS_KEY, JSON.stringify(value));
  } catch {
    // storage blocked: sessions stay in memory for this visit
  }
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* RI-0010 task C: demo profile/knowledge persistence, same sessionStorage
 * pattern as guest sessions so edits survive navigation in the demo. */
const PROFILE_KEY = "mission-control.profile.v1";
const FILES_KEY = "mission-control.files.v1";
const NOTES_KEY = "mission-control.notes.v1";
const LINKS_KEY = "mission-control.fileLinks.v1";

const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeStore = (key: string, value: unknown) => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: edits live in memory for this visit only
  }
};

/** The demo signs in as Alex Rivera; the seed world has no other principals. */
const DEMO_PRINCIPAL_ID = "principal-alex";

const demoProfile = (): SelfProfile => ({
  id: `profile-${DEMO_PRINCIPAL_ID}`,
  workspaceId: seedWorld.workspaces[0]?.id ?? "ws-gtm",
  principalId: DEMO_PRINCIPAL_ID,
  displayName: "Alex Rivera",
  role: "Founder",
  team: "Fieldstone",
  resumeFileId: null,
  preferences: [
    "Every outbound send needs my approval",
    "Warm intros before cold outreach",
  ],
  goals: ["Save the Halcyon renewal", "Ship the Loomcraft beta"],
  updatedAt: new Date().toISOString(),
});

const principalForOwner = (owner: string) =>
  owner === "Alex Rivera"
    ? DEMO_PRINCIPAL_ID
    : `principal-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

interface StoredNote {
  note: Note;
  visibility: "private" | "shared";
  principalId: string;
}

/**
 * Materialize an approved proposal against the world.
 *
 * `milestone` designs create the container if needed, then objective, milestone,
 * and plan — all starting as `queued`/`todo`, because approval starts the
 * work, it does not finish it. `replan` designs adjust the milestone they
 * reference: a new deadline, a replacement plan, or an acknowledged
 * escalation. The design is data, so the same shape can later be written to
 * Octo's workspace SQL instead of an in-memory world.
 */
export const applyApprovedDesign = (
  world: World,
  design: MilestoneDesign,
  nextId: (prefix: string) => string,
): { summary: string; activity: string } => {
  const now = new Date().toISOString();

  if (design.kind === "mission") {
    let projectId = design.projectId;
    if (!projectId) {
      const project: Project = {
        id: nextId("prj-live"),
        workspaceId: world.workspaces[0]?.id ?? "w1",
        name: design.projectName ?? design.missionName,
        kind: "initiative",
        status: "active",
        owner: "Alex Rivera",
        summary: design.missionSummary,
        ...(design.projectMission ? { mission: design.projectMission } : {}),
        personIds: [],
        companyIds: [],
        eventIds: [],
        startedAt: now,
        targetDate: design.due,
      };
      world.projects = [project, ...world.projects];
      projectId = project.id;
    }
    const objective = {
      id: nextId("obj-live"),
      projectId,
      name: design.objectiveName,
      targetLabel: design.objectiveTarget,
      progress: 0,
      status: "on_track" as const,
      dueDate: design.due,
    };
    world.objectives = [...world.objectives, objective];
    const milestone = {
      id: nextId("ms-live"),
      objectiveId: objective.id,
      projectId,
      name: design.missionName,
      summary: design.missionSummary,
      horizon: design.horizon,
      status: "queued" as const,
      agentIds: design.agentIds,
      personIds: [],
      due: design.due,
    };
    world.milestones = [...world.milestones, milestone];
    const plan = {
      id: nextId("plan-live"),
      milestoneId: milestone.id,
      agentId: design.agentIds[0] ?? "research",
      title: `Plan — ${design.missionName}`,
      summary: design.rationale,
      steps: design.planSteps.map((step, index) => ({
        id: `step-${index + 1}`,
        label: step.label,
        detail: step.detail,
        status: "todo" as const,
        agentId: step.agentId,
      })),
      updatedAt: now,
    };
    world.plans = [...world.plans, plan];
    return {
      summary: `${milestone.name} is queued under ${objective.name} with a ${design.planSteps.length}-step plan.`,
      activity: `Milestone created: ${milestone.name}`,
    };
  }

  const milestone = world.milestones.find(
    (item) => item.id === (design.milestoneId ?? design.missionId),
  );
  if (!milestone) {
    return {
      summary: "The milestone this replan targeted no longer exists; nothing changed.",
      activity: `Re-plan dropped: ${design.missionName}`,
    };
  }
  if (design.adjustment === "extend") {
    milestone.due = design.due;
    return {
      summary: `${milestone.name} now runs to ${design.due.slice(0, 10)}; remaining steps keep their owners.`,
      activity: `Deadline extended: ${milestone.name}`,
    };
  }
  if (design.adjustment === "replan") {
    const plan = world.plans.find((item) => item.milestoneId === milestone.id);
    const steps = design.planSteps.map((step, index) => ({
      id: `step-${index + 1}`,
      label: step.label,
      detail: step.detail,
      status: "todo" as const,
      agentId: step.agentId,
    }));
    if (plan) {
      plan.steps = steps;
      plan.summary = design.rationale;
      plan.updatedAt = now;
    } else {
      world.plans = [
        {
          id: nextId("plan-live"),
          milestoneId: milestone.id,
          agentId: design.agentIds[0] ?? "research",
          title: `Plan — ${milestone.name}`,
          summary: design.rationale,
          steps,
          updatedAt: now,
        },
        ...world.plans,
      ];
    }
    if (milestone.status === "queued" || milestone.status === "blocked") {
      milestone.status = "running";
    }
    return {
      summary: `${milestone.name} has a new ${steps.length}-step plan and is running against ${milestone.due.slice(0, 10)}.`,
      activity: `Re-planned: ${milestone.name}`,
    };
  }
  // escalate: the approval itself was the decision; the block stays visible.
  return {
    summary: `Escalation for ${milestone.name} accepted — the decision options are logged and the milestone stays blocked until input arrives.`,
    activity: `Escalation approved: ${milestone.name}`,
  };
};

export const createLocalSeedSource = (): MissionControlSource => {
  const world: World = clone(seedWorld);
  let liveId = 0;
  let entityId = 0;
  const nextId = (prefix: string) => `${prefix}-${++entityId}`;

  const findAgent = (agentId: string) => {
    const agent = world.agents.find((item) => item.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  };

  /* Demo knowledge rows created through the source, shared across pages via
   * sessionStorage (the seed world itself stays the canonical demo fixture). */
  const createdFiles = () => readStore<ProfileFile[]>(FILES_KEY, []);
  const createdNotes = () => readStore<StoredNote[]>(NOTES_KEY, []);
  const storedLinks = () => readStore<Record<string, FileLink[]>>(LINKS_KEY, {});

  const linksForFile = (file: ProfileFile): FileLink[] => {
    const derived: FileLink[] = [
      ...file.personIds.map((personId) => ({
        id: `link-${file.id}-${personId}`,
        fileId: file.id,
        entityKind: "person" as const,
        entityId: personId,
        principalId: file.principalId,
      })),
      ...(file.projectId
        ? [{
            id: `link-${file.id}-${file.projectId}`,
            fileId: file.id,
            entityKind: "project" as const,
            entityId: file.projectId,
            principalId: file.principalId,
          }]
        : []),
    ];
    return [...derived, ...(storedLinks()[file.id] ?? [])];
  };

  /** Seed files as owned rows. f1 is private to Alex to demo the privacy rule. */
  const seedFileRows = (): ProfileFile[] =>
    world.files.map((file) => ({
      ...file,
      principalId: principalForOwner(file.owner),
      visibility: file.id === "f1" ? ("private" as const) : ("shared" as const),
      links: [],
    }));

  const allFileRows = (): ProfileFile[] =>
    [...seedFileRows(), ...createdFiles()].map((file) => ({
      ...file,
      links: linksForFile(file),
    }));

  return {
    kind: "local-seed",

    async loadWorld() {
      // A local source still resolves asynchronously so the screens exercise
      // their real loading states. Demo-created files/notes ride along so the
      // Knowledge pages see what the Profile page created.
      await new Promise((resolve) => setTimeout(resolve, 260));
      return clone({
        ...world,
        files: [...world.files, ...createdFiles()],
        notes: [...world.notes, ...createdNotes().map((entry) => entry.note)],
      });
    },

    async signIn(mode) {
      // Stands in for the Octo OAuth handshake. The real implementation
      // redirects to Octo, then exchanges the callback for a workspace token.
      await new Promise((resolve) => setTimeout(resolve, 620));
      const base = {
        organizationId: world.organization.id,
        workspaceId: world.workspaces[0].id,
        signedInAt: new Date().toISOString(),
      };
      return mode === "guest"
        ? {
            ...base,
            mode,
            name: "Guest",
            email: "guest@demo.fieldstone.studio",
          }
        : {
            ...base,
            mode,
            name: "Alex Rivera",
            email: "alex@fieldstone.studio",
          };
    },

    async setConnectorStatus(connectorId, status) {
      const connector = world.connectors.find((item) => item.id === connectorId);
      if (!connector) throw new Error(`Unknown connector: ${connectorId}`);
      connector.status = status;
      if (status === "connected") connector.lastSync = new Date().toISOString();
      return clone(connector);
    },

    async setPluginInstalled(pluginId, installed) {
      const plugin = world.plugins.find((item) => item.id === pluginId);
      if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);
      plugin.installed = installed;
      return clone(plugin);
    },

    async decideApproval({ approvalId, decision, note, editedAction }) {
      const approval = world.approvals.find((item) => item.id === approvalId);
      if (!approval) throw new Error(`Unknown approval: ${approvalId}`);
      if (approval.status !== "pending") {
        throw new Error("That decision has already been made.");
      }

      approval.status = decision;
      approval.decidedAt = new Date().toISOString();
      approval.decisionNote = note;
      if (editedAction) approval.editedAction = editedAction;

      // An approved proposal becomes work; a declined one stays a record.
      const outcome =
        approval.design && decision === "approved"
          ? applyApprovedDesign(world, approval.design, nextId)
          : null;

      const agent = findAgent(approval.agentId);
      const remaining = world.approvals.filter(
        (item) => item.agentId === agent.id && item.status === "pending",
      );
      if (remaining.length === 0 && agent.status === "needs_you") {
        agent.status = "running";
        agent.currentTask = {
          title: "Resuming the task queue",
          startedAt: new Date().toISOString(),
          progress: 12,
        };
      }

      const entry: ActivityEntry = {
        id: `act-live-${++liveId}`,
        at: new Date().toISOString(),
        agentId: approval.agentId,
        type: "approval",
        title:
          decision === "approved"
            ? `You approved: ${approval.title}`
            : `You declined: ${approval.title}`,
        detail:
          note?.trim() ||
          outcome?.summary ||
          (decision === "approved"
            ? `${agent.name} will execute this now and log the result.`
            : `${agent.name} will stop this thread and try a different angle.`),
        personId: approval.personId,
        companyId: approval.companyId,
        eventId: approval.eventId,
        approvalId: approval.id,
        outcome: decision === "approved" ? "ok" : "declined",
      };
      world.activity = [entry, ...world.activity];

      return {
        approval: clone(approval),
        activity: clone(entry),
        agent: clone(agent),
        world: outcome ? clone(world) : undefined,
      };
    },

    async addProposal(input) {
      const approval: Approval = {
        id: nextId("ap-live"),
        agentId: input.agentId,
        kind: input.kind,
        title: input.title,
        proposedAction: input.proposedAction,
        reason: input.reason,
        evidence: clone(input.evidence),
        risk: input.risk,
        personId: input.personId,
        companyId: input.companyId,
        eventId: input.eventId,
        createdAt: new Date().toISOString(),
        status: "pending",
        design: clone(input.design),
      };
      world.approvals = [approval, ...world.approvals];
      return clone(approval);
    },

    async setAgentStatus(agentId, status) {
      const agent = findAgent(agentId);
      agent.status = status;
      if (status === "paused") {
        agent.currentTask = null;
      } else if (status === "running" && !agent.currentTask) {
        agent.currentTask = {
          title: "Working the task queue",
          startedAt: new Date().toISOString(),
          progress: 8,
        };
      }
      return clone(agent);
    },

    async listSessions() {
      return clone(readSeedSessions().conversations);
    },

    async createSession(input) {
      const store = readSeedSessions();
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: `sess-live-${++liveId}`,
        workspaceId: world.workspaces[0]?.id ?? "w1",
        scopeKind: (input.scopeKind as Conversation["scopeKind"]) ?? "workspace",
        scopeId: input.scopeId ?? null,
        title: input.title,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      store.conversations = [conversation, ...store.conversations];
      store.messages[conversation.id] = [];
      writeSeedSessions(store);
      return clone(conversation);
    },

    async loadMessages(sessionId) {
      return clone(readSeedSessions().messages[sessionId] ?? []);
    },

    async appendMessage(sessionId, message) {
      const store = readSeedSessions();
      store.messages[sessionId] = [...(store.messages[sessionId] ?? []), message];
      store.conversations = store.conversations.map((conversation) =>
        conversation.id === sessionId ? { ...conversation, updatedAt: message.createdAt } : conversation,
      );
      writeSeedSessions(store);
      return clone(message);
    },

    async patchSession(sessionId, patch) {
      const store = readSeedSessions();
      let next: Conversation | null = null;
      store.conversations = store.conversations.map((conversation) => {
        if (conversation.id !== sessionId) return conversation;
        next = {
          ...conversation,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.scopeKind !== undefined ? { scopeKind: patch.scopeKind as Conversation["scopeKind"] } : {}),
          ...(patch.scopeId !== undefined ? { scopeId: patch.scopeId } : {}),
          archivedAt: patch.archived === undefined ? conversation.archivedAt : patch.archived ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        };
        return next;
      });
      writeSeedSessions(store);
      if (!next) throw new Error(`Unknown session: ${sessionId}`);
      return clone(next);
    },

    async loadProfile() {
      return clone(readStore<SelfProfile>(PROFILE_KEY, demoProfile()));
    },

    async patchProfile(patch) {
      const current = readStore<SelfProfile>(PROFILE_KEY, demoProfile());
      const next: SelfProfile = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      writeStore(PROFILE_KEY, next);
      return clone(next);
    },

    async loadTeam() {
      // The demo has one human principal; agents are agents, not teammates.
      return clone([
        {
          id: DEMO_PRINCIPAL_ID,
          displayName: "Alex Rivera",
          email: "alex@fieldstone.studio",
          role: "owner",
          isSelf: true,
        },
      ]);
    },

    async loadFiles(scope) {
      // Mirrors the adapter's privacy rule: private rows only appear in the
      // owner's "mine" scope; team/shared never include anyone's private rows.
      const rows = allFileRows().filter((file) =>
        scope === "mine"
          ? file.principalId === DEMO_PRINCIPAL_ID
          : scope === "shared"
            ? file.visibility === "shared" && file.principalId !== DEMO_PRINCIPAL_ID
            : file.visibility === "shared",
      );
      const folders =
        scope === "shared"
          ? []
          : world.folders.map((folder) => ({ ...folder }));
      return clone({ scope, folders, files: rows });
    },

    async createFile(input) {
      const now = new Date().toISOString();
      const file: ProfileFile = {
        id: nextId("file-live"),
        folderId: input.folderId ?? "",
        name: input.name,
        kind: input.kind ?? "doc",
        size: input.size ?? "—",
        updatedAt: now,
        owner: "Alex Rivera",
        summary: input.summary ?? "",
        personIds: input.personIds ?? [],
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.octoFileId !== undefined ? { octoFileId: input.octoFileId } : {}),
        principalId: DEMO_PRINCIPAL_ID,
        // Private by default, exactly like the Octo adapter.
        visibility: input.visibility ?? "private",
        links: [],
      };
      writeStore(FILES_KEY, [...createdFiles(), file]);
      return clone({
        file,
        uploadUrl: "/api/files",
        uploadNote:
          "Demo mode: metadata only. In owner mode the bytes go to Octo Files (MCP upload_file / ingest_document or REST /api/files) — Octo stays canonical.",
      });
    },

    async linkFile(fileId, link) {
      const file = allFileRows().find((item) => item.id === fileId);
      if (!file) throw new Error(`Unknown file: ${fileId}`);
      const existing = storedLinks();
      const mine = existing[fileId] ?? [];
      const found = mine.find(
        (item) => item.entityKind === link.entityKind && item.entityId === link.entityId,
      );
      if (found) return clone(found);
      const entry: FileLink = {
        id: nextId("link-live"),
        fileId,
        entityKind: link.entityKind,
        entityId: link.entityId,
        principalId: DEMO_PRINCIPAL_ID,
      };
      writeStore(LINKS_KEY, { ...existing, [fileId]: [...mine, entry] });
      return clone(entry);
    },

    async loadNotes() {
      // Own notes (whatever their visibility) plus the shared demo notes.
      const own = createdNotes().map((entry) => entry.note);
      return clone(
        [...own, ...world.notes].sort(
          (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
        ),
      );
    },

    async createNote(input) {
      const note: Note = {
        id: nextId("note-live"),
        title: input.title,
        kind: input.kind ?? "note",
        at: new Date().toISOString(),
        body: input.body,
        personIds: input.personIds ?? [],
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      };
      const entry: StoredNote = {
        note,
        visibility: input.visibility ?? "private",
        principalId: DEMO_PRINCIPAL_ID,
      };
      writeStore(NOTES_KEY, [...createdNotes(), entry]);
      return clone(note);
    },

    async loadRetros() {
      return clone(world.retrospectives);
    },

    async logActivity(input) {
      const entry: ActivityEntry = {
        id: `act-live-${++liveId}`,
        at: new Date().toISOString(),
        agentId: input.agentId,
        type: input.type,
        title: input.title,
        detail: input.detail,
        personId: input.personId,
        approvalId: input.approvalId,
        outcome: input.outcome ?? "info",
      };
      world.activity = [entry, ...world.activity];
      return clone(entry);
    },
  };
};

export const dataSource: MissionControlSource = createLocalSeedSource();
