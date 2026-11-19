import {
  daysQuiet,
  goingCold,
  missionById,
  missionStatusMeta,
  pendingApprovals,
  planForMission,
  projectById,
} from "@/data/derive";
import type {
  Approval,
  ApprovalKind,
  EvidenceRef,
  Mission,
  MissionDesign,
  MissionHorizon,
  NewProposal,
  Risk,
  World,
} from "@/data/types";

/**
 * The intelligence layer that runs without a model.
 *
 * CONSOLE.md promises three things the seed world can already honour:
 * signals as data (nothing drifts silently), deadlines with an iteration loop
 * (a stall becomes a proposal, never a dead end), and propose-don't-decide
 * (every adjustment waits in the approval inbox). These functions are pure —
 * they read the world and describe what it means. Writing happens only
 * through the data source, so an Octo-backed source can replace it whole.
 */

/* ------------------------------------------------------------------ */
/* Stall detection                                                     */
/* ------------------------------------------------------------------ */

export type StallReason = "blocked" | "overdue" | "unplanned";

export interface Stall {
  mission: Mission;
  reason: StallReason;
  detail: string;
}

const isPast = (iso: string) => new Date(iso).getTime() < Date.now();

/**
 * A mission is stalled when it cannot move on its own: it is blocked on a
 * decision, its deadline has passed without completion, or it is running
 * with no plan to execute. Each case gets a different proposed way forward.
 */
export const stallFor = (world: World, mission: Mission): Stall | null => {
  if (mission.status === "done") return null;
  if (mission.status === "blocked") {
    const approvals = pendingApprovals(world).filter((approval) =>
      mission.agentIds.includes(approval.agentId),
    );
    return {
      mission,
      reason: "blocked",
      detail: approvals.length
        ? `Waiting on ${approvals.length} approval${approvals.length === 1 ? "" : "s"} — the first is “${approvals[0].title}”.`
        : "Marked blocked with no open approval — the block itself needs a decision.",
    };
  }
  if (isPast(mission.due)) {
    const days = Math.max(
      1,
      Math.round((Date.now() - new Date(mission.due).getTime()) / 86_400_000),
    );
    return {
      mission,
      reason: "overdue",
      detail: `Past its deadline by ${days} day${days === 1 ? "" : "s"} and still ${mission.status.replace("_", " ")}.`,
    };
  }
  const plan = planForMission(world, mission.id);
  if (!plan || plan.steps.length === 0) {
    return {
      mission,
      reason: "unplanned",
      detail: "Queued or running with no plan attached — nothing tells the agents what to do.",
    };
  }
  return null;
};

export const stalledMissions = (world: World): Stall[] =>
  world.missions
    .map((mission) => stallFor(world, mission))
    .filter((stall): stall is Stall => stall !== null);

/* ------------------------------------------------------------------ */
/* The iteration loop: a stall becomes a proposal                      */
/* ------------------------------------------------------------------ */

const replanHorizon = (mission: Mission): MissionHorizon =>
  mission.horizon === "today" ? "this_week" : mission.horizon;

/**
 * The proposed way forward for one stalled mission. Deterministic on purpose:
 * the loop must keep working when the model is unreachable, and the human
 * gate makes a conservative default safe. Extend the deadline, re-plan the
 * steps, or escalate the block — never silently drop the work.
 */
export const replanProposalFor = (world: World, stall: Stall): NewProposal => {
  const { mission, reason, detail } = stall;
  const project = projectById(world, mission.projectId);
  const agentId = mission.agentIds[0] ?? "research";
  const due = new Date(
    Math.max(Date.now(), new Date(mission.due).getTime()) + 7 * 86_400_000,
  ).toISOString();

  const design: MissionDesign = {
    kind: "replan",
    missionId: mission.id,
    adjustment:
      reason === "blocked" ? "escalate" : reason === "overdue" ? "extend" : "replan",
    missionName: mission.name,
    missionSummary: mission.summary,
    projectId: mission.projectId,
    objectiveId: mission.objectiveId,
    objectiveName: `Recover ${mission.name}`,
    objectiveTarget: reason === "blocked" ? "unblock within 1 day" : "land within 7 days",
    horizon: replanHorizon(mission),
    due,
    agentIds: mission.agentIds.length ? mission.agentIds : [agentId],
    autonomy: "approve",
    planSteps:
      reason === "blocked"
        ? [
            { label: "List what the block depends on", detail: "Name the decision or input missing", agentId },
            { label: "Draft the decision options", detail: "One page: option, cost, risk", agentId },
            { label: "Escalate to you with a recommendation", detail: "Nothing proceeds until you choose" },
          ]
        : reason === "overdue"
          ? [
              { label: "Audit what is already done", detail: "Keep finished steps, mark the rest", agentId },
              { label: "Cut the mission to what still matters", detail: "Drop or defer the rest with your approval" },
              { label: `Re-run to a new deadline (${due.slice(0, 10)})`, detail: "Progress reported against the new date", agentId },
            ]
          : [
              { label: "Draft the missing plan", detail: "Steps, owners, and evidence per step", agentId },
              { label: "Hold the plan for your approval", detail: "You edit before it runs" },
              { label: "Execute the approved steps", detail: "Progress logged against the deadline", agentId },
            ],
    rationale: `${mission.name} is ${reason} — ${detail} The loop says a stall becomes a proposal, so here is the way forward: ${
      reason === "blocked"
        ? "escalate the decision rather than wait it out."
        : reason === "overdue"
          ? "extend the deadline by a week and re-scope to what still moves the objective."
          : "attach a plan so the agents have something to execute."
    }`,
    unverified: [
      "The block, cause of the slip, and remaining scope come from the current world state — check them before approving.",
    ],
  };

  return {
    agentId,
    kind: "replan",
    title: `Re-plan: ${mission.name}`,
    proposedAction: design.rationale,
    reason: detail,
    evidence: [
      { label: project?.name ?? "Mission", detail: `${mission.status.replace("_", " ")} · due ${mission.due.slice(0, 10)}` },
      { label: missionStatusMeta[mission.status]?.label ?? mission.status, detail: reason },
    ],
    risk: reason === "blocked" ? "medium" : "low",
    design,
    personId: mission.personIds[0],
    eventId: mission.eventId,
  };
};

/** True when a pending replan proposal already covers this mission. */
export const replanAlreadyPending = (world: World, missionId: string) =>
  world.approvals.some(
    (approval) =>
      approval.kind === "replan" &&
      approval.status === "pending" &&
      approval.design?.missionId === missionId,
  );

/* ------------------------------------------------------------------ */
/* Signal layer                                                        */
/* ------------------------------------------------------------------ */

export type SignalKey =
  | "needs_decision"
  | "overdue"
  | "stalled"
  | "going_cold";

export interface SignalItem {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "primary" | "warn" | "muted";
}

export interface SignalGroup {
  key: SignalKey;
  label: string;
  hint: string;
  items: SignalItem[];
}

/**
 * One aggregated "needs attention" read of the world: what needs a decision,
 * what is overdue, what is stalled, and who is going cold. The Today page
 * renders it; the copilot prompt carries it; nothing drifts silently.
 */
export const attentionSignals = (world: World): SignalGroup[] => {
  const pending = pendingApprovals(world);
  const overdue = world.missions.filter(
    (mission) => mission.status !== "done" && isPast(mission.due),
  );
  const stalled = stalledMissions(world).filter(
    (stall) => stall.reason !== "overdue",
  );
  const cold = goingCold(world).slice(0, 6);

  return [
    {
      key: "needs_decision",
      label: "Needs a decision",
      hint: "Agents are holding these for you.",
      items: pending.slice(0, 5).map((approval: Approval) => ({
        id: approval.id,
        label: approval.title,
        detail: `${approval.risk} risk · waiting since ${approval.createdAt.slice(0, 10)}`,
        href: `/approvals?focus=${approval.id}`,
        tone: "primary",
      })),
    },
    {
      key: "overdue",
      label: "Overdue",
      hint: "Past deadline and not done.",
      items: overdue.slice(0, 5).map((mission) => ({
        id: mission.id,
        label: mission.name,
        detail: `due ${mission.due.slice(0, 10)} · ${mission.status.replace("_", " ")}`,
        href: `/missions/${mission.id}`,
        tone: "warn",
      })),
    },
    {
      key: "stalled",
      label: "Stalled",
      hint: "Blocked or unplanned — each has a proposed way forward.",
      items: stalled.slice(0, 5).map((stall) => ({
        id: stall.mission.id,
        label: stall.mission.name,
        detail: stall.detail,
        href: `/missions/${stall.mission.id}`,
        tone: "warn",
      })),
    },
    {
      key: "going_cold",
      label: "Going cold",
      hint: "Quiet longer than the reply window.",
      items: cold.map((person) => ({
        id: person.id,
        label: person.name,
        detail: `${daysQuiet(person.lastContact)} days quiet · strength ${person.strength}`,
        href: `/people/${person.id}`,
        tone: "muted",
      })),
    },
  ];
};

export const totalSignals = (groups: SignalGroup[]) =>
  groups.reduce((sum, group) => sum + group.items.length, 0);

/* ------------------------------------------------------------------ */
/* Design → approval conversion                                        */
/* ------------------------------------------------------------------ */

/** Wrap a model-produced design as an approval proposal for the inbox. */
export const designAsProposal = (
  world: World,
  design: MissionDesign,
): NewProposal => {
  const agentId = design.agentIds[0] ?? "research";
  const project = design.projectId ? projectById(world, design.projectId) : undefined;
  const evidence: EvidenceRef[] = [
    {
      label: project ? project.name : "New project",
      detail: design.projectName ? `named “${design.projectName}” on approval` : "existing container",
    },
    {
      label: "Objective",
      detail: `${design.objectiveName} — ${design.objectiveTarget}`,
    },
  ];
  if (design.unverified.length) {
    evidence.push({
      label: "Unverified",
      detail: `${design.unverified.length} item${design.unverified.length === 1 ? "" : "s"} flagged — not canonical`,
    });
  }
  return {
    agentId,
    kind: "mission",
    title: `New mission: ${design.missionName}`,
    proposedAction: `${design.missionSummary} Plan: ${design.planSteps
      .map((step) => step.label)
      .join(" → ")}. Autonomy: ${design.autonomy}.`,
    reason: design.rationale,
    evidence,
    risk: design.autonomy === "full" ? "high" : design.autonomy === "approve" ? "medium" : "low",
    design,
  };
};

export const missionByIdSafe = (world: World, id?: string) =>
  id ? missionById(world, id) : undefined;
