import { AlertTriangle, CircleCheck, Clock, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  goingCold,
  milestonesForProject,
  pendingApprovals,
} from "@/data/derive";
import { stalledMilestones } from "@/lib/intelligence";
import type { Milestone, World } from "@/data/types";

/**
 * Worst-child rollup: a project or objective row carries the most urgent
 * signal among its children, in the same priority the Today page uses —
 * needs-you > overdue > stalled > going-cold. Nothing drifts silently one
 * level down. People are read from the graph by reference (going-cold is a
 * property of the canonical person, not a copy stored on the project).
 */

export type RollupKey = "needs_you" | "overdue" | "stalled" | "going_cold";

export interface Rollup {
  key: RollupKey;
  label: string;
  detail: string;
  count: number;
}

const rollupMeta: Record<
  RollupKey,
  { label: string; className: string; Icon: typeof AlertTriangle }
> = {
  needs_you: {
    label: "Needs you",
    className: "border-primary/35 bg-primary/10 text-primary",
    Icon: AlertTriangle,
  },
  overdue: {
    label: "Overdue",
    className: "border-warn/30 bg-warn/10 text-warn",
    Icon: Clock,
  },
  stalled: {
    label: "Stalled",
    className: "border-warn/30 bg-warn/10 text-warn",
    Icon: AlertTriangle,
  },
  going_cold: {
    label: "Going cold",
    className: "border-border bg-surface-2 text-muted-foreground",
    Icon: Snowflake,
  },
};

/**
 * The worst signal across a set of milestones and the people they reference.
 * Shared by project and objective rollups so both levels read identically.
 */
export const rollupFor = (
  world: World,
  milestones: Milestone[],
  personIds: string[],
): Rollup | null => {
  if (!milestones.length && !personIds.length) return null;
  const milestoneIds = new Set(milestones.map((milestone) => milestone.id));
  const agentIds = new Set(milestones.flatMap((milestone) => milestone.agentIds));

  // needs-you: pending decisions from these agents, plus blocked milestones
  // that have no open approval (the block itself needs a decision).
  const waiting = pendingApprovals(world).filter((approval) =>
    agentIds.has(approval.agentId),
  );
  const blocked = milestones.filter((milestone) => milestone.status === "blocked");
  const blockedWithoutApproval = blocked.filter(
    (milestone) =>
      !waiting.some((approval) => milestone.agentIds.includes(approval.agentId)),
  );
  const needsCount = waiting.length + blockedWithoutApproval.length;
  if (needsCount > 0) {
    return {
      key: "needs_you",
      label: rollupMeta.needs_you.label,
      count: needsCount,
      detail: `${waiting.length} decision${waiting.length === 1 ? "" : "s"} waiting${
        blockedWithoutApproval.length
          ? ` · ${blockedWithoutApproval.length} blocked without one`
          : ""
      }.`,
    };
  }

  const stalls = stalledMilestones(world).filter((stall) =>
    milestoneIds.has(stall.milestone.id),
  );
  const overdue = stalls.filter((stall) => stall.reason === "overdue");
  if (overdue.length) {
    return {
      key: "overdue",
      label: rollupMeta.overdue.label,
      count: overdue.length,
      detail: overdue[0]?.detail ?? "Past deadline and not done.",
    };
  }
  const stalled = stalls.filter((stall) => stall.reason !== "overdue");
  if (stalled.length) {
    return {
      key: "stalled",
      label: rollupMeta.stalled.label,
      count: stalled.length,
      detail: stalled[0]?.detail ?? "Blocked or unplanned.",
    };
  }

  // going-cold: referenced people quiet past their window (graph read).
  const coldIds = new Set(goingCold(world).map((person) => person.id));
  const cold = personIds.filter((id) => coldIds.has(id));
  if (cold.length) {
    return {
      key: "going_cold",
      label: rollupMeta.going_cold.label,
      count: cold.length,
      detail: `${cold.length} referenced ${cold.length === 1 ? "person is" : "people are"} quiet past their reply window.`,
    };
  }
  return null;
};

export const rollupForProject = (world: World, projectId: string): Rollup | null => {
  const project = world.projects.find((item) => item.id === projectId);
  if (!project) return null;
  return rollupFor(world, milestonesForProject(world, projectId), project.personIds);
};

export const rollupForObjective = (world: World, objectiveId: string): Rollup | null => {
  const objective = world.objectives.find((item) => item.id === objectiveId);
  if (!objective) return null;
  const milestones = world.milestones.filter(
    (milestone) => milestone.objectiveId === objectiveId,
  );
  const personIds = [...new Set(milestones.flatMap((milestone) => milestone.personIds))];
  return rollupFor(world, milestones, personIds);
};

/** The worst-child chip. `null` renders a quiet "Clear" so rows stay scannable. */
export const RollupSignal = ({
  rollup,
  className,
}: {
  rollup: Rollup | null;
  className?: string;
}) => {
  if (!rollup) {
    return (
      <span
        title="No child needs you, nothing overdue or stalled, nobody going cold."
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-run/25 bg-run/[0.07] px-2 py-0.5 text-[10.5px] font-medium text-run",
          className,
        )}
      >
        <CircleCheck className="h-3 w-3" />
        Clear
      </span>
    );
  }
  const meta = rollupMeta[rollup.key];
  const Icon = meta.Icon;
  return (
    <span
      title={rollup.detail}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
        meta.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
      {rollup.count > 1 ? <span className="num">· {rollup.count}</span> : null}
    </span>
  );
};
