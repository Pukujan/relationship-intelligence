import { AlertTriangle, CircleCheck, Clock, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  goingCold,
  missionsForProject,
  pendingApprovals,
} from "@/data/derive";
import { stalledMissions } from "@/lib/intelligence";
import type { Mission, World } from "@/data/types";

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
 * The worst signal across a set of missions and the people they reference.
 * Shared by project and objective rollups so both levels read identically.
 */
export const rollupFor = (
  world: World,
  missions: Mission[],
  personIds: string[],
): Rollup | null => {
  if (!missions.length && !personIds.length) return null;
  const missionIds = new Set(missions.map((mission) => mission.id));
  const agentIds = new Set(missions.flatMap((mission) => mission.agentIds));

  // needs-you: pending decisions from these agents, plus blocked missions
  // that have no open approval (the block itself needs a decision).
  const waiting = pendingApprovals(world).filter((approval) =>
    agentIds.has(approval.agentId),
  );
  const blocked = missions.filter((mission) => mission.status === "blocked");
  const blockedWithoutApproval = blocked.filter(
    (mission) =>
      !waiting.some((approval) => mission.agentIds.includes(approval.agentId)),
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

  const stalls = stalledMissions(world).filter((stall) =>
    missionIds.has(stall.mission.id),
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
  return rollupFor(world, missionsForProject(world, projectId), project.personIds);
};

export const rollupForObjective = (world: World, objectiveId: string): Rollup | null => {
  const objective = world.objectives.find((item) => item.id === objectiveId);
  if (!objective) return null;
  const missions = world.missions.filter(
    (mission) => mission.objectiveId === objectiveId,
  );
  const personIds = [...new Set(missions.flatMap((mission) => mission.personIds))];
  return rollupFor(world, missions, personIds);
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
