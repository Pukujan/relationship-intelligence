export type AgentStatus = "idle" | "running" | "needs_you" | "paused";
export type AgentTone = "coral" | "indigo" | "teal";
export type AgentIcon = "sales" | "marketing" | "research";

export type TaskStatus = "queued" | "running" | "done" | "blocked";
export type TaskPriority = "low" | "normal" | "high";

export type RunOutcome = "success" | "partial" | "escalated" | "failed";

export type ApprovalKind =
  | "send"
  | "call"
  | "publish"
  | "invite"
  | "commit"
  | "mission"
  | "replan";
export type ApprovalStatus = "pending" | "approved" | "declined";
export type Decision = "approved" | "declined";
export type DeclinePath = "stop" | "re_plan" | "snooze";
export type Risk = "low" | "medium" | "high";

export type ActivityType =
  | "research"
  | "outreach"
  | "call"
  | "approval"
  | "system";
export type ActivityOutcome = "ok" | "pending" | "declined" | "info";

export type SourceKind = "email" | "call" | "note" | "web" | "event" | "crm";
export type Confidence = "high" | "medium" | "low";
export type ClaimStatus = "sourced" | "unverified";
export type Warmth = "hot" | "warm" | "cool" | "cold";

export type EventType = "conference" | "dinner" | "community" | "demo" | "mixer";
export type EventStatus = "upcoming" | "past";

export interface EvidenceRef {
  label: string;
  detail: string;
}

export interface Kpi {
  id: string;
  label: string;
  value: string;
  delta?: string;
  direction?: "up" | "down" | "flat";
  series?: number[];
}

export interface AgentTask {
  id: string;
  agentId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due?: string;
  progress?: number;
  note?: string;
  missionId?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  mission: string;
  icon: AgentIcon;
  tone: AgentTone;
  status: AgentStatus;
  autonomy: "draft" | "approve" | "full";
  currentTask: {
    title: string;
    startedAt: string;
    progress: number;
  } | null;
  sparkline: number[];
  kpis: Kpi[];
  joinedAt: string;
  /** Set when the agent was installed from a starter template. */
  templateId?: string | null;
}

export interface AgentRun {
  id: string;
  agentId: string;
  title: string;
  startedAt: string;
  durationMin: number;
  outcome: RunOutcome;
  summary: string;
  evidence?: EvidenceRef[];
}

export interface Approval {
  id: string;
  agentId: string;
  kind: ApprovalKind;
  title: string;
  proposedAction: string;
  reason: string;
  evidence: EvidenceRef[];
  risk: Risk;
  personId?: string;
  companyId?: string;
  eventId?: string;
  createdAt: string;
  expiresAt?: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decisionNote?: string;
  declinePath?: DeclinePath;
  editedAction?: string;
  /**
   * When present, approving this row creates or adjusts work: `mission`
   * materializes objective + mission + plan; `replan` applies the adjustment
   * to the referenced mission. The proposal is data, so an Octo-backed
   * source can persist it verbatim.
   */
  design?: MissionDesign;
}

/* ------------------------------------------------------------------ */
/* Proposals (intelligence layer)                                      */
/* ------------------------------------------------------------------ */

export type MissionAutonomy = "draft" | "approve" | "full";

export interface DesignStep {
  label: string;
  detail: string;
  agentId?: string;
}

/**
 * A proposal the human can approve to create or adjust work. `mission`
 * designs create objective + mission + plan on approval; `replan` designs
 * adjust an existing mission. It rides on an Approval so the inbox, the
 * decision log, and (later) Octo see one shape.
 */
export interface MissionDesign {
  kind: "mission" | "replan";
  missionName: string;
  missionSummary: string;
  /** Existing project to attach to; when absent, a new project is created. */
  projectId?: string;
  projectName?: string;
  objectiveName: string;
  objectiveTarget: string;
  objectiveId?: string;
  horizon: MissionHorizon;
  due: string;
  agentIds: string[];
  autonomy: MissionAutonomy;
  planSteps: DesignStep[];
  rationale: string;
  unverified: string[];
  /** For replan designs: the mission being adjusted and how. */
  missionId?: string;
  adjustment?: "extend" | "replan" | "escalate";
}

export interface NewProposal {
  agentId: string;
  kind: ApprovalKind;
  title: string;
  proposedAction: string;
  reason: string;
  evidence: EvidenceRef[];
  risk: Risk;
  design: MissionDesign;
  personId?: string;
  companyId?: string;
  eventId?: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  agentId: string;
  type: ActivityType;
  title: string;
  detail: string;
  personId?: string;
  companyId?: string;
  eventId?: string;
  approvalId?: string;
  evidence?: EvidenceRef[];
  outcome?: ActivityOutcome;
}

export interface ClaimSource {
  label: string;
  kind: SourceKind;
  date: string;
  /** Full evidence locator and verbatim excerpt, when the ledger has them. */
  locator?: string;
  excerpt?: string;
}

export interface Claim {
  id: string;
  personId: string;
  text: string;
  source: ClaimSource;
  confidence: Confidence;
  status: ClaimStatus;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  companyId: string;
  location: string;
  timezone: string;
  strength: number;
  warmth: Warmth;
  lastContact: string;
  cadenceDays?: number;
  tags: string[];
  summary: string;
  email: string;
  claims: Claim[];
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  sector: string;
  stage: string;
  headcount: number;
  location: string;
  notes: string;
}

export interface RelationshipEvent {
  id: string;
  name: string;
  date: string;
  location: string;
  type: EventType;
  attendeeIds: string[];
  goal: string;
  agentId: string;
  status: EventStatus;
  outcome?: string;
}

/* ------------------------------------------------------------------ */
/* Tenancy and work hierarchy                                          */
/* ------------------------------------------------------------------ */

export type ProjectKind = "deal" | "event" | "initiative";
export type ProjectStatus = "active" | "at_risk" | "planned" | "on_hold";
export type ObjectiveStatus = "on_track" | "at_risk" | "met" | "paused";
export type MissionHorizon = "today" | "this_week";
export type MissionStatus = "queued" | "running" | "blocked" | "done";
export type StepStatus = "todo" | "doing" | "done";

export interface Organization {
  id: string;
  name: string;
  plan: string;
  domain: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  region: string;
  ownerName: string;
  role?: string;
}

/**
 * A container for a piece of work (a deal, an event, an initiative).
 * Projects *reference* people, companies and events from the graph — they
 * never own or duplicate them.
 */
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  owner: string;
  summary: string;
  personIds: string[];
  companyIds: string[];
  eventIds: string[];
  startedAt: string;
  targetDate?: string;
}

/** A measurable outcome inside a project. */
export interface Objective {
  id: string;
  projectId: string;
  name: string;
  targetLabel: string;
  progress: number;
  status: ObjectiveStatus;
  dueDate?: string;
}

/** A time-boxed unit of work an agent executes to advance an objective. */
export interface Mission {
  id: string;
  objectiveId: string;
  projectId: string;
  name: string;
  summary: string;
  horizon: MissionHorizon;
  status: MissionStatus;
  agentIds: string[];
  personIds: string[];
  eventId?: string;
  due: string;
}

export interface PlanStep {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
  agentId?: string;
}

/** The agent's strategy for a mission. */
export interface Plan {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Knowledge                                                           */
/* ------------------------------------------------------------------ */

export type DocKind = "doc" | "sheet" | "deck" | "pdf";
export type NoteKind = "note" | "meeting";

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FileDoc {
  id: string;
  folderId: string;
  name: string;
  kind: DocKind;
  size: string;
  updatedAt: string;
  owner: string;
  summary: string;
  personIds: string[];
  projectId?: string;
}

export interface Note {
  id: string;
  title: string;
  kind: NoteKind;
  at: string;
  body: string;
  personIds: string[];
  projectId?: string;
  eventId?: string;
  agentId?: string;
}

export interface RetroMetric {
  label: string;
  value: string;
  delta: string;
}

export interface Retrospective {
  id: string;
  month: string;
  title: string;
  summary: string;
  wins: string[];
  misses: string[];
  decisions: string[];
  metrics: RetroMetric[];
}

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

export type ConnectorProvider =
  | "linkedin"
  | "x"
  | "luma"
  | "gmail"
  | "gcal";
export type ConnectorStatus = "connected" | "needs_setup" | "expired";
export type McpStatus = "connected" | "needs_setup" | "error";

export interface Connector {
  id: string;
  provider: ConnectorProvider;
  name: string;
  status: ConnectorStatus;
  principal: string;
  detail: string;
  lastSync?: string;
  scopes: string[];
}

export interface McpTool {
  name: string;
  description: string;
}

export interface McpServer {
  id: string;
  name: string;
  status: McpStatus;
  transport: "http" | "stdio";
  endpoint: string;
  principal: string;
  tools: McpTool[];
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  installed: boolean;
  agentIds: string[];
  permissions: string[];
}

/**
 * A saved filter over the relationship graph. Smart lists never copy people —
 * they re-evaluate against the canonical person records.
 */
export interface SmartList {
  id: string;
  name: string;
  description: string;
  rule: {
    tag?: string;
    companyId?: string;
    minQuietDays?: number;
    maxStrength?: number;
  };
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export type SessionMode = "owner" | "guest";

export interface Session {
  mode: SessionMode;
  name: string;
  email: string;
  organizationId: string;
  workspaceId: string;
  signedInAt: string;
  /** Octo principal id, present in owner mode; used for telemetry attribution. */
  principalId?: string;
}

export interface World {
  organization: Organization;
  workspaces: Workspace[];
  projects: Project[];
  objectives: Objective[];
  missions: Mission[];
  plans: Plan[];
  agents: Agent[];
  tasks: AgentTask[];
  runs: AgentRun[];
  approvals: Approval[];
  activity: ActivityEntry[];
  people: Person[];
  companies: Company[];
  events: RelationshipEvent[];
  folders: Folder[];
  files: FileDoc[];
  notes: Note[];
  retrospectives: Retrospective[];
  connectors: Connector[];
  mcpServers: McpServer[];
  plugins: Plugin[];
  smartLists: SmartList[];
  /** Octo reported the graph projection stale or unreachable. */
  graphStale?: boolean;
  generatedAt: string;
}

export interface DecisionInput {
  approvalId: string;
  decision: Decision;
  declinePath?: DeclinePath;
  note?: string;
  editedAction?: string;
}
