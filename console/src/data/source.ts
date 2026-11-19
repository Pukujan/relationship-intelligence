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
  Plugin,
  Session,
  SessionMode,
  World,
} from "./types";

export interface ApprovalDecisionResult {
  approval: Approval;
  activity: ActivityEntry;
  agent: Agent;
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
  loadWorld(): Promise<World>;
  signIn(mode: SessionMode): Promise<Session>;
  decideApproval(input: DecisionInput): Promise<ApprovalDecisionResult>;
  setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent>;
  setConnectorStatus(
    connectorId: string,
    status: ConnectorStatus,
  ): Promise<Connector>;
  setPluginInstalled(pluginId: string, installed: boolean): Promise<Plugin>;
  logActivity(input: NewActivity): Promise<ActivityEntry>;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const createLocalSeedSource = (): MissionControlSource => {
  let world: World = clone(seedWorld);
  let liveId = 0;

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
      };
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
