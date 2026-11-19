import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Circle, ListChecks, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  missionById,
  planProgress,
  relativeTime,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { MissionChain, ProgressBar, ScopeBanner } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { StepStatus } from "@/data/types";

const StepMark = ({ status }: { status: StepStatus }) => {
  if (status === "done") return <Check className="h-3 w-3 text-run" />;
  if (status === "doing")
    return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
  return <Circle className="h-2.5 w-2.5 text-border" />;
};

const Plans = () => {
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

  const plans = useMemo(() => {
    if (!world) return [];
    return world.plans
      .filter((plan) => {
        const mission = world.missions.find((item) => item.id === plan.missionId);
        if (!mission) return false;
        return activeProjectId === "all" || mission.projectId === activeProjectId;
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [world, activeProjectId]);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Plans didn't load"
        description={error ?? "Something went wrong reading the plans."}
        onRetry={reload}
      />
    );
  }

  const missionsWithoutPlan = world.missions.filter(
    (mission) =>
      (activeProjectId === "all" || mission.projectId === activeProjectId) &&
      !world.plans.some((plan) => plan.missionId === mission.id),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Plans"
        description="The agent's strategy for each mission, step by step. A plan is where you can see exactly what will happen before anything goes out."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("What's the plan for the Halcyon renewal?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about a plan
          </Button>
        }
      />

      {activeProject ? (
        <ScopeBanner
          label={activeProject.name}
          onClear={() => setActiveProject("all")}
        />
      ) : null}

      {plans.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={ListChecks}
            title="No plans in this scope"
            description="Plans appear once an agent starts a mission. Switch the project scope to see the rest of the workspace."
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
        <div className="grid gap-3 lg:grid-cols-2">
          {plans.map((plan) => {
            const mission = missionById(world, plan.missionId);
            const agent = agentById(world, plan.agentId);
            if (!mission) return null;
            const done = plan.steps.filter((step) => step.status === "done").length;
            return (
              <article key={plan.id} className="panel flex flex-col gap-2.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/missions/${mission.id}`}
                      className="focus-ring rounded text-[13px] font-semibold transition-colors hover:text-primary"
                    >
                      {plan.title}
                    </Link>
                    {mission ? (
                      <MissionChain world={world} mission={mission} className="mt-1" />
                    ) : null}
                  </div>
                  {agent ? (
                    <Link
                      to={`/agents/${agent.id}`}
                      className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:text-primary"
                    >
                      <AgentAvatar
                        agent={agent}
                        size="sm"
                        className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]"
                      />
                      {agent.name}
                    </Link>
                  ) : null}
                </div>

                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {plan.summary}
                </p>

                <ProgressBar
                  value={planProgress(plan)}
                  label={`${plan.title} progress`}
                />

                <ol className="space-y-1">
                  {plan.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2">
                      <span className="mt-1 flex h-3 w-3 shrink-0 items-center justify-center">
                        <StepMark status={step.status} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[11.5px]",
                            step.status === "done" && "text-muted-foreground",
                          )}
                        >
                          {step.label}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground/80">
                          {step.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground">
                  <span>
                    {done}/{plan.steps.length} steps done · updated{" "}
                    {relativeTime(plan.updatedAt)}
                  </span>
                  <Link
                    to={`/missions/${mission.id}`}
                    className="focus-ring inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
                  >
                    Open mission
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {missionsWithoutPlan.length ? (
        <section className="space-y-2">
          <SectionHeader title="Missions without a plan yet" count={missionsWithoutPlan.length} />
          <div className="grid gap-1.5 sm:grid-cols-2">
            {missionsWithoutPlan.map((mission) => (
              <Link
                key={mission.id}
                to={`/missions/${mission.id}`}
                className="focus-ring flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-surface-1/30 px-3 py-2 text-[11.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                <ListChecks className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{mission.name}</span>
                <span className="text-[10px]">queued</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default Plans;
