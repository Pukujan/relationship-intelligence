import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isYesterday,
} from "date-fns";
import type {
  ActivityEntry,
  AgentRun,
  AgentTask,
  Approval,
  ConnectorStatus,
  Folder,
  McpServer,
  MilestoneStatus,
  ObjectiveStatus,
  Person,
  Plan,
  ProjectStatus,
  RelationshipEvent,
  SmartList,
  World,
} from "./types";

export const byId = <T extends { id: string }>(items: T[], id?: string) =>
  items.find((item) => item.id === id);

export const agentById = (world: World, id?: string) =>
  byId(world.agents, id);

export const personById = (world: World, id?: string) =>
  byId(world.people, id);

export const companyById = (world: World, id?: string) =>
  byId(world.companies, id);

export const eventById = (world: World, id?: string) =>
  byId(world.events, id);

export const pendingApprovals = (world: World): Approval[] =>
  world.approvals
    .filter((approval) => approval.status === "pending")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

export const pendingApprovalsForAgent = (world: World, agentId: string) =>
  pendingApprovals(world).filter((approval) => approval.agentId === agentId);

export const tasksForAgent = (world: World, agentId: string) =>
  world.tasks.filter((task) => task.agentId === agentId);

export const runsForAgent = (world: World, agentId: string) =>
  world.runs
    .filter((run) => run.agentId === agentId)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

export const activityForAgent = (world: World, agentId: string) =>
  world.activity
    .filter((entry) => entry.agentId === agentId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export const activityForPerson = (world: World, personId: string) =>
  world.activity
    .filter((entry) => entry.personId === personId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export const approvalsForPerson = (world: World, personId: string) =>
  world.approvals.filter(
    (approval) => approval.personId === personId && approval.status === "pending",
  );

export const peopleForCompany = (world: World, companyId: string) =>
  world.people.filter((person) => person.companyId === companyId);

export const eventsForPerson = (world: World, personId: string) =>
  world.events
    .filter((event) => event.attendeeIds.includes(personId))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export const upcomingEvents = (world: World) =>
  world.events
    .filter((event) => event.status === "upcoming")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

export interface AgentStats {
  running: number;
  queued: number;
  blocked: number;
  done: number;
  pending: number;
  successRate: number;
}

export const agentStats = (world: World, agentId: string): AgentStats => {
  const tasks = tasksForAgent(world, agentId);
  const runs = runsForAgent(world, agentId);
  const successes = runs.filter((run) => run.outcome === "success").length;
  return {
    running: tasks.filter((task) => task.status === "running").length,
    queued: tasks.filter((task) => task.status === "queued").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    done: tasks.filter((task) => task.status === "done").length,
    pending: pendingApprovalsForAgent(world, agentId).length,
    successRate: runs.length
      ? Math.round((successes / runs.length) * 100)
      : 0,
  };
};

export interface DaySummary {
  runsToday: number;
  approvalsWaiting: number;
  peopleTouched: number;
  agentsActive: number;
}

export const daySummary = (world: World): DaySummary => {
  const today = new Date();
  const weekAgo = today.getTime() - 7 * 24 * 60 * 60 * 1000;
  const touched = new Set<string>();
  world.activity.forEach((entry) => {
    if (entry.personId && new Date(entry.at).getTime() >= weekAgo) {
      touched.add(entry.personId);
    }
  });
  return {
    runsToday: world.runs.filter((run) => isToday(new Date(run.startedAt)))
      .length,
    approvalsWaiting: pendingApprovals(world).length,
    peopleTouched: touched.size,
    agentsActive: world.agents.filter((agent) => agent.status === "running")
      .length,
  };
};

export const relativeTime = (value: string) => {
  const date = new Date(value);
  const distance = formatDistanceToNowStrict(date, { addSuffix: true });
  return distance.replace(" ago", " ago");
};

export const timeOfDay = (value: string) => format(new Date(value), "HH:mm");

export const dayLabel = (value: string) => {
  const date = new Date(value);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE d MMMM");
};

export const shortDate = (value: string) => format(new Date(value), "d MMM");

export const longDate = (value: string) =>
  format(new Date(value), "EEEE d MMMM · HH:mm");

export const groupActivityByDay = (entries: ActivityEntry[]) => {
  const groups: { key: string; label: string; entries: ActivityEntry[] }[] = [];
  entries
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .forEach((entry) => {
      const label = dayLabel(entry.at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.entries.push(entry);
      } else {
        groups.push({ key: `${label}-${entry.id}`, label, entries: [entry] });
      }
    });
  return groups;
};

export const taskGroups: { status: AgentTask["status"]; label: string }[] = [
  { status: "running", label: "Running" },
  { status: "queued", label: "Queued" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export const outcomeTone: Record<
  AgentRun["outcome"],
  { label: string; className: string }
> = {
  success: {
    label: "Success",
    className: "text-run border-run/30 bg-run/10",
  },
  partial: {
    label: "Partial",
    className: "text-warn border-warn/30 bg-warn/10",
  },
  escalated: {
    label: "Needs you",
    className: "text-primary border-primary/30 bg-primary/10",
  },
  failed: {
    label: "Failed",
    className: "text-destructive border-destructive/30 bg-destructive/10",
  },
};

export const strengthLabel = (person: Person) => {
  if (person.strength >= 80) return "Hot";
  if (person.strength >= 60) return "Warm";
  if (person.strength >= 40) return "Cool";
  return "Cold";
};

export const eventAttendees = (world: World, event: RelationshipEvent) =>
  event.attendeeIds
    .map((id) => personById(world, id))
    .filter((person): person is Person => Boolean(person));

/* ------------------------------------------------------------------ */
/* Work hierarchy                                                      */
/* ------------------------------------------------------------------ */

export const projectById = (world: World, id?: string) =>
  byId(world.projects, id);

export const objectiveById = (world: World, id?: string) =>
  byId(world.objectives, id);

export const milestoneById = (world: World, id?: string) =>
  byId(world.milestones, id);

export const planForMilestone = (world: World, milestoneId: string) =>
  world.plans.find((plan) => plan.milestoneId === milestoneId);

export const objectivesForProject = (world: World, projectId: string) =>
  world.objectives.filter((objective) => objective.projectId === projectId);

export const milestonesForProject = (world: World, projectId: string) =>
  world.milestones
    .filter((milestone) => milestone.projectId === projectId)
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

export const tasksForMilestone = (world: World, milestoneId: string) =>
  world.tasks.filter((task) => task.milestoneId === milestoneId);

export const projectsForPerson = (world: World, personId: string) =>
  world.projects.filter((project) => project.personIds.includes(personId));

export const milestonesForPerson = (world: World, personId: string) =>
  world.milestones
    .filter((milestone) => milestone.personIds.includes(personId))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

export const milestonesForAgent = (world: World, agentId: string) =>
  world.milestones
    .filter((milestone) => milestone.agentIds.includes(agentId))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

export const milestonesDueToday = (world: World) =>
  world.milestones
    .filter((milestone) => isToday(new Date(milestone.due)))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

export const milestonesThisWeek = (world: World) =>
  world.milestones
    .filter((milestone) => milestone.horizon === "this_week")
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());

export const projectProgress = (world: World, projectId: string) => {
  const objectives = objectivesForProject(world, projectId);
  if (!objectives.length) return 0;
  return Math.round(
    objectives.reduce((sum, objective) => sum + objective.progress, 0) /
      objectives.length,
  );
};

export const planProgress = (plan: Plan) => {
  if (!plan.steps.length) return 0;
  const done = plan.steps.filter((step) => step.status === "done").length;
  const doing = plan.steps.filter((step) => step.status === "doing").length;
  return Math.round(((done + doing * 0.5) / plan.steps.length) * 100);
};

/* ------------------------------------------------------------------ */
/* Knowledge                                                           */
/* ------------------------------------------------------------------ */

export const childFolders = (world: World, parentId: string | null) =>
  world.folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));

export const filesInFolder = (world: World, folderId: string) =>
  world.files
    .filter((file) => file.folderId === folderId)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

export const folderPath = (world: World, folderId: string): Folder[] => {
  const path: Folder[] = [];
  let current = byId(world.folders, folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId
      ? byId(world.folders, current.parentId)
      : undefined;
  }
  return path;
};

export const notesForProject = (world: World, projectId: string) =>
  world.notes.filter((note) => note.projectId === projectId);

/* ------------------------------------------------------------------ */
/* Relationships as a graph                                            */
/* ------------------------------------------------------------------ */

export const daysQuiet = (value: string) =>
  Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000));

/** Smart lists re-evaluate against canonical people — they never copy them. */
export const peopleForSmartList = (world: World, list: SmartList) =>
  world.people
    .filter((person) => {
      const { tag, companyId, minQuietDays, maxStrength } = list.rule;
      if (tag && !person.tags.includes(tag)) return false;
      if (companyId && person.companyId !== companyId) return false;
      if (minQuietDays && daysQuiet(person.lastContact) < minQuietDays)
        return false;
      if (maxStrength !== undefined && person.strength > maxStrength) return false;
      return true;
    })
    .sort((a, b) => b.strength - a.strength);

export const goingCold = (world: World) => {
  const list = world.smartLists.find((item) => item.id === "sl1");
  return list ? peopleForSmartList(world, list) : [];
};

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

export const projectStatusMeta: Record<
  ProjectStatus,
  { label: string; className: string }
> = {
  active: { label: "Active", className: "border-run/30 bg-run/10 text-run" },
  at_risk: {
    label: "At risk",
    className: "border-warn/30 bg-warn/10 text-warn",
  },
  planned: {
    label: "Planned",
    className: "border-border bg-surface-2 text-muted-foreground",
  },
  on_hold: {
    label: "On hold",
    className: "border-border bg-transparent text-muted-foreground",
  },
};

export const objectiveStatusMeta: Record<
  ObjectiveStatus,
  { label: string; className: string }
> = {
  on_track: { label: "On track", className: "border-run/30 bg-run/10 text-run" },
  at_risk: { label: "At risk", className: "border-warn/30 bg-warn/10 text-warn" },
  met: { label: "Met", className: "border-primary/30 bg-primary/10 text-primary" },
  paused: {
    label: "Paused",
    className: "border-border bg-surface-2 text-muted-foreground",
  },
};

export const milestoneStatusMeta: Record<
  MilestoneStatus,
  { label: string; className: string }
> = {
  running: { label: "Running", className: "border-run/30 bg-run/10 text-run" },
  queued: {
    label: "Queued",
    className: "border-border bg-surface-2 text-muted-foreground",
  },
  blocked: { label: "Needs you", className: "border-warn/30 bg-warn/10 text-warn" },
  done: { label: "Done", className: "border-primary/30 bg-primary/10 text-primary" },
};

export const connectorStatusMeta: Record<
  ConnectorStatus,
  { label: string; className: string }
> = {
  connected: { label: "Connected", className: "border-run/30 bg-run/10 text-run" },
  needs_setup: {
    label: "Needs setup",
    className: "border-warn/30 bg-warn/10 text-warn",
  },
  expired: {
    label: "Expired",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
};

export const mcpStatusMeta: Record<
  McpServer["status"],
  { label: string; className: string }
> = {
  connected: { label: "Connected", className: "border-run/30 bg-run/10 text-run" },
  needs_setup: {
    label: "Needs setup",
    className: "border-warn/30 bg-warn/10 text-warn",
  },
  error: {
    label: "Error",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};
