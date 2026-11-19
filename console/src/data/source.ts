import { seedWorld } from "./seed";
import type {
  ActivityEntry,
  ActivityType,
  Agent,
  AgentStatus,
  Approval,
  Connector,
  ConnectorStatus,
  DecisionInput,
  MissionDesign,
  NewProposal,
  Plugin,
  Project,
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
   * approved proposal materializes objectives, missions, and plans. The
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
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Materialize an approved proposal against the world.
 *
 * `mission` designs create the container if needed, then objective, mission,
 * and plan — all starting as `queued`/`todo`, because approval starts the
 * work, it does not finish it. `replan` designs adjust the mission they
 * reference: a new deadline, a replacement plan, or an acknowledged
 * escalation. The design is data, so the same shape can later be written to
 * Octo's workspace SQL instead of an in-memory world.
 */
export const applyApprovedDesign = (
  world: World,
  design: MissionDesign,
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
    const mission = {
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
    world.missions = [...world.missions, mission];
    const plan = {
      id: nextId("plan-live"),
      missionId: mission.id,
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
      summary: `${mission.name} is queued under ${objective.name} with a ${design.planSteps.length}-step plan.`,
      activity: `Mission created: ${mission.name}`,
    };
  }

  const mission = world.missions.find((item) => item.id === design.missionId);
  if (!mission) {
    return {
      summary: "The mission this replan targeted no longer exists; nothing changed.",
      activity: `Re-plan dropped: ${design.missionName}`,
    };
  }
  if (design.adjustment === "extend") {
    mission.due = design.due;
    return {
      summary: `${mission.name} now runs to ${design.due.slice(0, 10)}; remaining steps keep their owners.`,
      activity: `Deadline extended: ${mission.name}`,
    };
  }
  if (design.adjustment === "replan") {
    const plan = world.plans.find((item) => item.missionId === mission.id);
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
          missionId: mission.id,
          agentId: design.agentIds[0] ?? "research",
          title: `Plan — ${mission.name}`,
          summary: design.rationale,
          steps,
          updatedAt: now,
        },
        ...world.plans,
      ];
    }
    if (mission.status === "queued" || mission.status === "blocked") {
      mission.status = "running";
    }
    return {
      summary: `${mission.name} has a new ${steps.length}-step plan and is running against ${mission.due.slice(0, 10)}.`,
      activity: `Re-planned: ${mission.name}`,
    };
  }
  // escalate: the approval itself was the decision; the block stays visible.
  return {
    summary: `Escalation for ${mission.name} accepted — the decision options are logged and the mission stays blocked until input arrives.`,
    activity: `Escalation approved: ${mission.name}`,
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

  return {
    kind: "local-seed",

    async loadWorld() {
      // A local source still resolves asynchronously so the screens exercise
      // their real loading states.
      await new Promise((resolve) => setTimeout(resolve, 260));
      return clone(world);
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
