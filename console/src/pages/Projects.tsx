import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FolderKanban, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { missionsDueToday } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { ProjectCard, ScopeBanner } from "@/components/work";
import { AltitudeControl, useAltitude } from "@/components/crm/AltitudeControl";
import { PortfolioTable } from "@/components/crm/PortfolioTable";
import { Peek, type PeekTarget } from "@/components/crm/Peek";
import { Button } from "@/components/ui/button";

const chain = [
  {
    label: "Project",
    to: "/projects",
    detail: "A deal, an event, or an initiative.",
  },
  {
    label: "Objective",
    to: "/objectives",
    detail: "A measurable outcome inside it.",
  },
  {
    label: "Mission",
    to: "/missions",
    detail: "A time-boxed unit an agent executes.",
  },
  {
    label: "Plan + tasks",
    to: "/plans",
    detail: "The strategy, then the atomic steps.",
  },
];

const Projects = () => {
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
  // Glance-first: the portfolio table is the default read; Deep adds cards.
  const [altitude] = useAltitude("projects");
  const [peek, setPeek] = useState<PeekTarget | null>(null);

  if (status === "loading") return <PageSkeleton rows={3} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Projects didn't load"
        description={error ?? "Something went wrong reading the work hierarchy."}
        onRetry={reload}
      />
    );
  }

  const today = missionsDueToday(world);
  const totalMissions = world.missions.length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Projects"
        description="Every project is a container for outcomes. Objectives measure them, missions execute them, and the people inside stay in the graph — referenced, never copied."
        actions={
          <>
            <AltitudeControl view="projects" />
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() =>
                openCopilot("Where do my projects stand this week?")
              }
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Ask about the work
            </Button>
          </>
        }
      />

      {activeProject ? (
        <ScopeBanner
          label={activeProject.name}
          onClear={() => setActiveProject("all")}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/60 sm:grid-cols-4">
        {[
          { label: "Projects", value: world.projects.length },
          { label: "Objectives", value: world.objectives.length },
          { label: "Missions", value: totalMissions },
          { label: "Due today", value: today.length, tone: today.length ? "warn" : undefined },
        ].map((metric) => (
          <div key={metric.label} className="bg-card p-3.5">
            <p className="eyebrow">{metric.label}</p>
            <p className="num mt-1.5 text-[22px] font-semibold leading-none">
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <SectionHeader title="In this workspace" count={world.projects.length} />
        <PortfolioTable
          world={world}
          projects={world.projects}
          onPeek={setPeek}
        />
        {altitude === "deep" ? (
          <div className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-3">
            {world.projects.map((project) => (
              <ProjectCard
                key={project.id}
                world={world}
                project={project}
                active={activeProjectId === project.id}
              />
            ))}
          </div>
        ) : null}
      </section>

      {altitude === "deep" ? (
      <section className="panel p-4">
        <SectionHeader title="How the chain works" />
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {chain.map((step, index) => (
            <li key={step.label}>
              <Link
                to={step.to}
                className="focus-ring group flex h-full flex-col gap-1 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:border-primary/35 hover:bg-primary/[0.04]"
              >
                <span className="flex items-center gap-1.5">
                  <span className="num flex h-5 w-5 items-center justify-center rounded-md border border-border/70 bg-surface-2 text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-[12.5px] font-medium">{step.label}</span>
                  <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70" />
                </span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  {step.detail}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Projects and missions reference people, companies, and events from the
          relationship graph. A person shows up in every project that references
          them — there is only ever one record.
        </p>
      </section>
      ) : null}

      {world.projects.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Projects are the container for objectives and missions. Ask the copilot to open the first one from a relationship that needs work."
            action={
              <Button
                size="sm"
                className="rounded-lg"
                onClick={() => openCopilot("Open a project for the Halcyon renewal")}
              >
                <Target className="h-3.5 w-3.5" />
                Open a project
              </Button>
            }
          />
        </div>
      ) : null}

      <div className={cn("flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground")}>
        <span>Objectives are measurable — progress rolls up from their missions.</span>
        <Link
          to="/objectives"
          className="focus-ring rounded text-primary transition-colors hover:text-primary/80"
        >
          See the objectives
        </Link>
      </div>

      <Peek
        world={world}
        target={peek}
        open={Boolean(peek)}
        onOpenChange={(open) => {
          if (!open) setPeek(null);
        }}
      />
    </div>
  );
};

export default Projects;
