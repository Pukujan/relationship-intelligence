import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  objectivesForProject,
  relativeTime,
  shortDate,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill, ProgressBar, ScopeBanner } from "@/components/work";
import { Button } from "@/components/ui/button";

const statusPill = (status: string) =>
  status === "at_risk"
    ? "border-warn/30 bg-warn/10 text-warn"
    : status === "on_track"
      ? "border-run/30 bg-run/10 text-run"
      : status === "met"
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-border bg-surface-2 text-muted-foreground";

const statusLabel = (status: string) =>
  status === "at_risk"
    ? "At risk"
    : status === "on_track"
      ? "On track"
      : status === "met"
        ? "Met"
        : "Paused";

const Objectives = () => {
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
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");

  const projects = useMemo(() => {
    if (!world) return [];
    return activeProjectId === "all"
      ? world.projects
      : world.projects.filter((project) => project.id === activeProjectId);
  }, [world, activeProjectId]);

  useEffect(() => {
    if (!focusId) return;
    const node = document.getElementById(`objective-${focusId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Objectives didn't load"
        description={error ?? "Something went wrong reading the objectives."}
        onRetry={reload}
      />
    );
  }

  const totalObjectives = projects.reduce(
    (sum, project) => sum + objectivesForProject(world, project.id).length,
    0,
  );
  const atRisk = projects.reduce(
    (sum, project) =>
      sum +
      objectivesForProject(world, project.id).filter(
        (objective) => objective.status === "at_risk",
      ).length,
    0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Objectives"
        description="Bounded, measurable goals inside every project — each with a target and a deadline, serving the project's mission. Each objective rolls up the milestones its agents are executing right now."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("Which objectives are at risk this week?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about objectives
          </Button>
        }
      />

      {activeProject ? (
        <ScopeBanner
          label={activeProject.name}
          onClear={() => setActiveProject("all")}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span>
          <span className="num text-foreground">{totalObjectives}</span> objectives
          in scope
        </span>
        <span className="text-border">·</span>
        <span className={cn(atRisk > 0 && "text-warn")}>
          <span className="num">{atRisk}</span> at risk
        </span>
        <span className="text-border">·</span>
        <Link
          to="/milestones"
          className="focus-ring inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
        >
          See the milestones
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={Target}
            title="No projects in scope"
            description="Switch the project switcher to “All projects” to see every objective in the workspace."
            action={
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => setActiveProject("all")}
              >
                Show all projects
              </Button>
            }
          />
        </div>
      ) : (
        projects.map((project) => {
          const objectives = objectivesForProject(world, project.id);
          return (
            <section key={project.id} className="space-y-3">
              <SectionHeader
                title={project.name}
                count={objectives.length}
                action={
                  <Link
                    to={`/projects/${project.id}`}
                    className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Open project
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                }
              />
              {objectives.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-surface-1/30 px-3 py-4 text-[11.5px] text-muted-foreground">
                  No objectives yet in {project.name}.{" "}
                  <button
                    type="button"
                    onClick={() =>
                      openCopilot(`Draft an objective for ${project.name}`)
                    }
                    className="focus-ring rounded text-primary underline-offset-2 hover:underline"
                  >
                    Ask the copilot to draft one
                  </button>
                  .
                </div>
              ) : (
                <div className="grid gap-2.5 lg:grid-cols-2">
                  {objectives.map((objective) => {
                    const milestones = world.milestones.filter(
                      (milestone) => milestone.objectiveId === objective.id,
                    );
                    const focused = focusId === objective.id;
                    return (
                      <div
                        key={objective.id}
                        id={`objective-${objective.id}`}
                        className={cn(
                          "panel flex flex-col gap-2.5 p-3.5 transition-colors",
                          focused && "border-primary/35 ring-1 ring-primary/20",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold">
                              {objective.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {objective.targetLabel}
                            </p>
                          </div>
                          <Pill className={statusPill(objective.status)}>
                            {statusLabel(objective.status)}
                          </Pill>
                        </div>

                        <ProgressBar
                          value={objective.progress}
                          tone={
                            objective.status === "at_risk"
                              ? "warn"
                              : objective.status === "on_track"
                                ? "run"
                                : "primary"
                          }
                          label={`${objective.name} progress`}
                        />

                        <div className="space-y-1.5">
                          {milestones.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-border/70 px-2.5 py-2 text-[11px] text-muted-foreground">
                              No milestones planned yet.
                            </p>
                          ) : (
                            milestones.map((milestone) => (
                              <Link
                                key={milestone.id}
                                to={`/milestones/${milestone.id}`}
                                className="focus-ring flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-border hover:bg-surface-2/60"
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    milestone.status === "running" && "bg-run",
                                    milestone.status === "blocked" && "bg-warn",
                                    milestone.status === "queued" && "bg-idle",
                                    milestone.status === "done" && "bg-primary",
                                  )}
                                />
                                <span className="flex-1 truncate">{milestone.name}</span>
                                <span className="num text-[10px] text-muted-foreground">
                                  {relativeTime(milestone.due)}
                                </span>
                              </Link>
                            ))
                          )}
                        </div>

                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground">
                          <span>
                            {milestones.length} milestone
                            {milestones.length === 1 ? "" : "s"} ·{" "}
                            {milestones.filter((m) => m.status === "blocked").length}{" "}
                            need you
                          </span>
                          {objective.dueDate ? (
                            <span>Due {shortDate(objective.dueDate)}</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
};

export default Objectives;
