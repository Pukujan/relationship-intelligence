import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarRange, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { milestonesDueToday, relativeTime } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { MilestoneRow, ScopeBanner } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { MilestoneStatus } from "@/data/types";

const horizons = [
  { id: "all", label: "All milestones" },
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
] as const;

const statuses: { id: MilestoneStatus | "all"; label: string }[] = [
  { id: "all", label: "Every status" },
  { id: "running", label: "Running" },
  { id: "blocked", label: "Needs you" },
  { id: "queued", label: "Queued" },
  { id: "done", label: "Done" },
];

const Milestones = () => {
  const {
    world,
    status,
    error,
    reload,
    activeProject,
    activeProjectId,
    setActiveProject,
  } = useData();
  const { openCopilot } = useOrchestrator();
  const [horizon, setHorizon] = useState<(typeof horizons)[number]["id"]>("all");
  const [milestoneStatus, setMilestoneStatus] = useState<MilestoneStatus | "all">("all");

  const milestones = useMemo(() => {
    if (!world) return [];
    return world.milestones
      .filter(
        (milestone) =>
          activeProjectId === "all" || milestone.projectId === activeProjectId,
      )
      .filter((milestone) => horizon === "all" || milestone.horizon === horizon)
      .filter(
        (milestone) => milestoneStatus === "all" || milestone.status === milestoneStatus,
      )
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
  }, [world, activeProjectId, horizon, milestoneStatus]);

  if (status === "loading") return <PageSkeleton rows={5} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Milestones didn't load"
        description={error ?? "Something went wrong reading the milestone board."}
        onRetry={reload}
      />
    );
  }

  const grouped = world.projects
    .map((project) => ({
      project,
      milestones: milestones.filter((milestone) => milestone.projectId === project.id),
    }))
    .filter((group) => group.milestones.length > 0);

  const dueToday = milestonesDueToday(world).filter(
    (milestone) =>
      activeProjectId === "all" || milestone.projectId === activeProjectId,
  ).length;
  const blocked = world.milestones.filter(
    (milestone) =>
      milestone.status === "blocked" &&
      (activeProjectId === "all" || milestone.projectId === activeProjectId),
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Milestones"
        description="A milestone is one bounded, time-boxed unit an agent executes to advance an objective. Today or this week — never open-ended. The project's mission is the enduring why; milestones are the bounded how."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("What's due today across the team?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask what's due
          </Button>
        }
      />

      {activeProject ? (
        <ScopeBanner
          label={activeProject.name}
          onClear={() => setActiveProject("all")}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface-1 p-0.5">
          {horizons.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setHorizon(item.id)}
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                horizon === item.id
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {statuses.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMilestoneStatus(item.id)}
              className={cn(
                "focus-ring rounded-full px-2 py-1 text-[11px] font-medium transition-colors",
                milestoneStatus === item.id
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            <span className="num text-warn">{dueToday}</span> due today
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="num text-warn">{blocked}</span> waiting on you
          </span>
        </span>
      </div>

      {milestones.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={CalendarRange}
            title="No milestones match this view"
            description="Try a different horizon or status, or clear the project scope to see every milestone in the workspace."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => {
                    setHorizon("all");
                    setMilestoneStatus("all");
                  }}
                >
                  Reset filters
                </Button>
                {activeProject ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => setActiveProject("all")}
                  >
                    Clear project scope
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.project.id} className="space-y-2">
            <SectionHeader
              title={group.project.name}
              count={group.milestones.length}
              action={
                <Link
                  to={`/projects/${group.project.id}`}
                  className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Project
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
            <div className="space-y-1.5">
              {group.milestones.map((milestone) => (
                <MilestoneRow key={milestone.id} world={world} milestone={milestone} />
              ))}
            </div>
          </section>
        ))
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span>
          {milestones.length} milestone{milestones.length === 1 ? "" : "s"} in this view ·
          next due {milestones[0] ? relativeTime(milestones[0].due) : "—"}
        </span>
        <Link
          to="/plans"
          className="focus-ring inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
        >
          Open the plans
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default Milestones;
