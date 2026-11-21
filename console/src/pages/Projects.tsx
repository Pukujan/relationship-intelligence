import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FolderKanban, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { invalidate, scopePrefix } from "@/lib/cache";
import { useData } from "@/data/store";
import { milestonesDueToday } from "@/data/derive";
import type { Project } from "@/data/types";
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
import { Input } from "@/components/ui/input";

const chain = [
  {
    label: "Project + mission",
    to: "/projects",
    detail: "A deal, event, or initiative — and its mission: the enduring why.",
  },
  {
    label: "Objective",
    to: "/objectives",
    detail: "A bounded, measurable goal that serves the mission.",
  },
  {
    label: "Milestone",
    to: "/milestones",
    detail: "One time-boxed unit an agent executes this week.",
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
    session,
    activeProject,
    activeProjectId,
    setActiveProject,
  } = useData();
  const { openCopilot } = useOrchestrator();
  // Glance-first: the portfolio table is the default read; Deep adds cards.
  const [altitude, setAltitude] = useAltitude("projects");
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  // Drop the cached world snapshot first: reload() alone can be served stale
  // by the 60s SWR cache, hiding the write that just happened.
  const refreshWorld = () => {
    if (session?.mode === "owner") {
      invalidate(
        scopePrefix({
          mode: session.mode,
          workspaceId: session.workspaceId,
          principalId: session.principalId ?? "",
        }) + "world",
      );
    }
    reload();
  };

  const createProject = async () => {
    if (!name.trim() || !session) return;
    setBusy(true);
    try {
      const response = await fetch("/app-api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          name: name.trim(),
          summary: summary.trim(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(
          body.detail ?? body.error ?? "Could not create the project.",
        );
      }
      toast.success(`Project "${name.trim()}" created`);
      setName("");
      setSummary("");
      setCreating(false);
      refreshWorld();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not create the project.",
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteProject = async (project: Project) => {
    if (!session) return;
    const confirmed = window.confirm(
      `Delete "${project.name}" and its objectives, milestones and plans?`,
    );
    if (!confirmed) return;
    try {
      const response = await fetch(
        `/app-api/projects/${encodeURIComponent(project.id)}?workspaceId=${encodeURIComponent(session.workspaceId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(
          body.detail ?? body.error ?? "Could not delete the project.",
        );
      }
      toast.success(`Deleted "${project.name}"`);
      if (activeProjectId === project.id) setActiveProject("all");
      refreshWorld();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not delete the project.",
      );
    }
  };

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

  const today = milestonesDueToday(world);
  const totalMilestones = world.milestones.length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Projects"
        description="Every project carries a mission — the enduring reason it exists. Objectives are bounded goals that serve it, milestones are the time-boxed units agents execute, and the people inside stay in the graph — referenced, never copied."
        actions={
          <>
            <AltitudeControl
              view="projects"
              value={altitude}
              onChange={setAltitude}
            />
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              aria-expanded={creating}
              onClick={() => setCreating((current) => !current)}
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </Button>
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

      {creating ? (
        <form
          className="panel flex flex-wrap items-center gap-2 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            placeholder="Project name"
            aria-label="Project name"
            className="h-9 min-w-56 flex-1 rounded-lg border-border/70 bg-surface-1 text-[13px]"
          />
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={500}
            placeholder="Summary (optional)"
            aria-label="Project summary"
            className="h-9 min-w-56 flex-1 rounded-lg border-border/70 bg-surface-1 text-[13px]"
          />
          <Button
            type="submit"
            size="sm"
            className="h-9 gap-1.5 rounded-lg"
            disabled={busy || !name.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 rounded-lg text-[12px] text-muted-foreground"
            onClick={() => setCreating(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

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
          { label: "Milestones", value: totalMilestones },
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
              <div key={project.id} className="relative">
                <ProjectCard
                  world={world}
                  project={project}
                  active={activeProjectId === project.id}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute -right-2 -top-2 h-7 w-7 rounded-full border border-border/70 bg-card p-0 text-muted-foreground shadow-sm hover:text-destructive"
                  aria-label="Delete project"
                  onClick={() => void deleteProject(project)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
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
          Projects and milestones reference people, companies, and events from the
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
            description="Projects are the container for objectives and milestones. Ask the copilot to open the first one from a relationship that needs work."
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
        <span>Missions endure; objectives and milestones are bounded — progress rolls up from milestones to objectives.</span>
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
