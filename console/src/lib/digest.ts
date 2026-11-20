import { daysQuiet, goingCold, pendingApprovals } from "@/data/derive";
import type { Mission, World } from "@/data/types";

/**
 * A compact snapshot of the world for the copilot server.
 *
 * The model must answer from real state, so the digest carries ids, names,
 * statuses, and dates — everything it needs to route work and link entities —
 * while staying small enough to send on every request. Claims are trimmed to
 * what supports the summary; the full record stays client-side.
 */

export interface DigestClaim {
  text: string;
  status: "sourced" | "unverified";
  source: string;
}

export interface WorldDigest {
  generatedAt: string;
  organization: { id: string; name: string };
  agents: {
    id: string;
    name: string;
    role: string;
    status: string;
    autonomy: string;
    currentTask: string | null;
  }[];
  projects: {
    id: string;
    name: string;
    kind: string;
    status: string;
    summary: string;
    personIds: string[];
    companyIds: string[];
  }[];
  objectives: {
    id: string;
    projectId: string;
    name: string;
    targetLabel: string;
    progress: number;
    status: string;
    dueDate?: string;
  }[];
  missions: {
    id: string;
    projectId: string;
    objectiveId: string;
    name: string;
    summary: string;
    status: string;
    horizon: string;
    due: string;
    agentIds: string[];
    personIds: string[];
    planProgress: number | null;
  }[];
  approvals: {
    id: string;
    agentId: string;
    kind: string;
    title: string;
    status: string;
    risk: string;
    personId?: string;
    companyId?: string;
  }[];
  people: {
    id: string;
    name: string;
    role: string;
    companyId: string;
    strength: number;
    warmth: string;
    lastContact: string;
    quietDays: number;
    tags: string[];
    claims: DigestClaim[];
  }[];
  companies: {
    id: string;
    name: string;
    sector: string;
    stage: string;
    notes: string;
  }[];
  events: {
    id: string;
    name: string;
    date: string;
    status: string;
    attendeeIds: string[];
    goal: string;
  }[];
  goingColdIds: string[];
}

const claimView = (world: World, personId: string): DigestClaim[] => {
  const person = world.people.find((item) => item.id === personId);
  if (!person) return [];
  return person.claims.slice(0, 3).map((claim) => ({
    text: claim.text,
    status: claim.status,
    source: `${claim.source.label} (${claim.source.kind})`,
  }));
};

/**
 * People worth naming: going cold, referenced by pending approvals or active
 * work, or recently active. The rest stay out of the prompt so the model
 * routes by real ids instead of drowning in rows.
 */
const relevantPeople = (world: World) => {
  const cold = new Set(goingCold(world).map((person) => person.id));
  const referenced = new Set<string>();
  for (const approval of pendingApprovals(world)) {
    if (approval.personId) referenced.add(approval.personId);
    if (approval.companyId) {
      for (const person of world.people) {
        if (person.companyId === approval.companyId) referenced.add(person.id);
      }
    }
  }
  for (const mission of world.missions) {
    if (mission.status !== "done") {
      for (const id of mission.personIds) referenced.add(id);
    }
  }
  for (const project of world.projects) {
    if (project.status === "active" || project.status === "at_risk") {
      for (const id of project.personIds) referenced.add(id);
    }
  }
  const picked = world.people.filter(
    (person) =>
      cold.has(person.id) ||
      referenced.has(person.id) ||
      daysQuiet(person.lastContact) <= 7,
  );
  return picked.slice(0, 24);
};

export const missionPlanProgress = (world: World, mission: Mission) => {
  const plan = world.plans.find((item) => item.missionId === mission.id);
  if (!plan || plan.steps.length === 0) return null;
  const done = plan.steps.filter((step) => step.status === "done").length;
  return Math.round((done / plan.steps.length) * 100);
};

export const buildWorldDigest = (
  world: World,
  options?: { includePeopleIds?: string[] },
): WorldDigest => {
  // A pinned scope must always reach the model, even when the person is not
  // in the "relevant" subset (cold/referenced/recent). Otherwise a scoped tab
  // silently sends an empty digest.
  const include = new Set(options?.includePeopleIds ?? []);
  const people = [
    ...relevantPeople(world),
    ...world.people.filter((person) => include.has(person.id) && !relevantPeople(world).some((p) => p.id === person.id)),
  ];
  const companyIds = new Set(people.map((person) => person.companyId));
  for (const project of world.projects) {
    for (const id of project.companyIds) companyIds.add(id);
  }
  const eventIds = new Set<string>();
  for (const project of world.projects) {
    for (const id of project.eventIds) eventIds.add(id);
  }
  for (const mission of world.missions) {
    if (mission.eventId) eventIds.add(mission.eventId);
  }

  return {
    generatedAt: new Date().toISOString(),
    organization: { id: world.organization.id, name: world.organization.name },
    agents: world.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      autonomy: agent.autonomy,
      currentTask: agent.currentTask?.title ?? null,
    })),
    projects: world.projects.map((project) => ({
      id: project.id,
      name: project.name,
      kind: project.kind,
      status: project.status,
      summary: project.summary,
      personIds: project.personIds,
      companyIds: project.companyIds,
    })),
    objectives: world.objectives.map((objective) => ({
      id: objective.id,
      projectId: objective.projectId,
      name: objective.name,
      targetLabel: objective.targetLabel,
      progress: objective.progress,
      status: objective.status,
      dueDate: objective.dueDate,
    })),
    missions: world.missions.map((mission) => ({
      id: mission.id,
      projectId: mission.projectId,
      objectiveId: mission.objectiveId,
      name: mission.name,
      summary: mission.summary,
      status: mission.status,
      horizon: mission.horizon,
      due: mission.due,
      agentIds: mission.agentIds,
      personIds: mission.personIds,
      planProgress: missionPlanProgress(world, mission),
    })),
    approvals: world.approvals.map((approval) => ({
      id: approval.id,
      agentId: approval.agentId,
      kind: approval.kind,
      title: approval.title,
      status: approval.status,
      risk: approval.risk,
      personId: approval.personId,
      companyId: approval.companyId,
    })),
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      companyId: person.companyId,
      strength: person.strength,
      warmth: person.warmth,
      lastContact: person.lastContact,
      quietDays: daysQuiet(person.lastContact),
      tags: person.tags,
      claims: claimView(world, person.id),
    })),
    companies: world.companies
      .filter((company) => companyIds.has(company.id))
      .map((company) => ({
        id: company.id,
        name: company.name,
        sector: company.sector,
        stage: company.stage,
        notes: company.notes,
      })),
    events: world.events
      .filter((event) => eventIds.has(event.id) || event.status === "upcoming")
      .map((event) => ({
        id: event.id,
        name: event.name,
        date: event.date,
        status: event.status,
        attendeeIds: event.attendeeIds,
        goal: event.goal,
      })),
    goingColdIds: goingCold(world).map((person) => person.id),
  };
};
