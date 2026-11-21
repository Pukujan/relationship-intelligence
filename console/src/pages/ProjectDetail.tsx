import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  FolderKanban,
  NotebookPen,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  milestonesForProject,
  notesForProject,
  personById,
  projectProgress,
  relativeTime,
  shortDate,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  PersonAvatar,
  SectionHeader,
} from "@/components/common";
import { MilestoneRow, Pill, ProgressBar } from "@/components/work";
import { Button } from "@/components/ui/button";

const statusClass = (status: string) =>
  status === "at_risk"
    ? "border-warn/30 bg-warn/10 text-warn"
    : status === "active"
      ? "border-run/30 bg-run/10 text-run"
      : "border-border bg-surface-2 text-muted-foreground";

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { world, status, error, reload, setActiveProject } = useData();
  const { openCopilot } = useOrchestrator();

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="This project didn't load"
        description={error ?? "Something went wrong reading the project."}
        onRetry={reload}
      />
    );
  }

  const project = world.projects.find((item) => item.id === projectId);
  if (!project) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          description="That project is not in this workspace. It may live in another scope."
          action={
            <Button size="sm" className="rounded-lg" asChild>
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const objectives = world.objectives.filter(
    (objective) => objective.projectId === project.id,
  );
  const milestones = milestonesForProject(world, project.id);
  const notes = notesForProject(world, project.id);
  const company = project.companyIds[0]
    ? world.companies.find((item) => item.id === project.companyIds[0])
    : undefined;
  const events = project.eventIds
    .map((id) => world.events.find((event) => event.id === id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const people = project.personIds
    .map((id) => personById(world, id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  const progress = projectProgress(world, project.id);
  const relatedActivity = world.activity
    .filter(
      (entry) =>
        (entry.personId && project.personIds.includes(entry.personId)) ||
        (entry.companyId && project.companyIds.includes(entry.companyId)),
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Projects", href: "/projects" }}
        eyebrow={`${project.kind} · ${project.owner}`}
        title={project.name}
        description={project.summary}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => openCopilot(`Where does ${project.name} stand?`)}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Ask about this project
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => {
                setActiveProject(project.id);
                toast.success(`Scoped to ${project.name}`, {
                  description:
                    "Objectives, milestones, plans, and the calendar now follow this project.",
                });
              }}
            >
              <Target className="h-3.5 w-3.5" />
              Scope to this project
            </Button>
          </>
        }
      />

      {project.mission ? (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.05] px-3.5 py-2.5">
          <p className="eyebrow text-primary">Mission</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/90">
            {project.mission}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface-1/30 px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
          No mission statement yet — the enduring why this project exists.{" "}
          <button
            type="button"
            onClick={() => openCopilot(`Draft a mission statement for ${project.name}`)}
            className="focus-ring rounded text-primary underline-offset-2 hover:underline"
          >
            Ask the copilot to draft one
          </button>
          .
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Pill className={statusClass(project.status)}>
          {project.status === "at_risk" ? "At risk" : project.status}
        </Pill>
        <Pill className="border-border/70 bg-transparent capitalize text-muted-foreground">
          {project.kind}
        </Pill>
        {project.targetDate ? (
          <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            Target {shortDate(project.targetDate)}
          </Pill>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {objectives.length} objectives · {milestones.length} milestones ·{" "}
          {people.length} people referenced
        </span>
      </div>

      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Project progress</p>
          <p className="text-[11px] text-muted-foreground">
            Rolled up from {objectives.length} objective
            {objectives.length === 1 ? "" : "s"}
          </p>
        </div>
        <ProgressBar value={progress} className="mt-2" label="Project progress" />
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Chain</span>
          <span>{project.name}</span>
          <ArrowRight className="h-3 w-3" />
          <Link to="/objectives" className="focus-ring rounded hover:text-foreground">
            {objectives.length} objective{objectives.length === 1 ? "" : "s"}
          </Link>
          <ArrowRight className="h-3 w-3" />
          <Link to="/milestones" className="focus-ring rounded hover:text-foreground">
            {milestones.length} milestone{milestones.length === 1 ? "" : "s"}
          </Link>
          <ArrowRight className="h-3 w-3" />
          <Link to="/plans" className="focus-ring rounded hover:text-foreground">
            plans & tasks
          </Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
        <section className="space-y-3">
          <SectionHeader
            title="Objectives & milestones"
            count={objectives.length}
            action={
              <Link
                to="/objectives"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                All objectives
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {objectives.length === 0 ? (
            <div className="panel p-5">
              <EmptyState
                icon={Target}
                title="No objectives yet"
                description="This project needs a measurable outcome before milestones can be planned against it."
                action={
                  <Button
                    size="sm"
                    className="rounded-lg"
                    onClick={() => openCopilot(`Set an objective for ${project.name}`)}
                  >
                    Draft an objective
                  </Button>
                }
              />
            </div>
          ) : (
            objectives.map((objective) => {
              const objectiveMilestones = milestones.filter(
                (milestone) => milestone.objectiveId === objective.id,
              );
              const tone =
                objective.status === "at_risk"
                  ? "warn"
                  : objective.status === "on_track"
                    ? "run"
                    : "primary";
              return (
                <div key={objective.id} className="panel p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5 text-muted-foreground" />
                        <Link
                          to={`/objectives?focus=${objective.id}`}
                          className="focus-ring rounded text-[13px] font-semibold transition-colors hover:text-primary"
                        >
                          {objective.name}
                        </Link>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {objective.targetLabel}
                        {objective.dueDate
                          ? ` · due ${shortDate(objective.dueDate)}`
                          : ""}
                      </p>
                    </div>
                    <Pill className={statusClass(objective.status)}>
                      {objective.status === "at_risk"
                        ? "At risk"
                        : objective.status === "on_track"
                          ? "On track"
                          : objective.status}
                    </Pill>
                  </div>
                  <ProgressBar
                    value={objective.progress}
                    tone={tone}
                    className="mt-2.5"
                    label={`${objective.name} progress`}
                  />
                  <div className="mt-2.5 space-y-1.5">
                    {objectiveMilestones.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/70 px-2.5 py-2 text-[11px] text-muted-foreground">
                        No milestone planned against this objective yet.
                      </p>
                    ) : (
                      objectiveMilestones.map((milestone) => (
                        <MilestoneRow key={milestone.id} world={world} milestone={milestone} showChain={false} />
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <aside className="space-y-3">
          <div className="panel p-3.5">
            <SectionHeader title="People referenced" count={people.length} />
            <div className="mt-2 space-y-1">
              {people.map((person) => (
                <Link
                  key={person.id}
                  to={`/people/${person.id}`}
                  className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <PersonAvatar name={person.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{person.name}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {person.role}
                    </p>
                  </div>
                  <span className="num text-[10px] text-muted-foreground">
                    {person.strength}
                  </span>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              These are references to the graph. Editing a person updates them
              everywhere.
            </p>
          </div>

          {company ? (
            <div className="panel p-3.5">
              <SectionHeader title="Company" />
              <Link
                to={`/people?tab=companies&focus=${company.id}`}
                className="focus-ring mt-2 flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-surface-2"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{company.name}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {company.sector} · {company.stage}
                  </p>
                </div>
              </Link>
            </div>
          ) : null}

          {events.length ? (
            <div className="panel p-3.5">
              <SectionHeader title="Events" count={events.length} />
              <div className="mt-2 space-y-1">
                {events.map((event) => (
                  <Link
                    key={event.id}
                    to={`/events?focus=${event.id}`}
                    className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] font-medium">{event.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {event.location} · {shortDate(event.date)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {notes.length ? (
            <div className="panel p-3.5">
              <SectionHeader
                title="Notes"
                count={notes.length}
                action={
                  <Link
                    to="/knowledge/notes"
                    className="focus-ring text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    All notes
                  </Link>
                }
              />
              <div className="mt-2 space-y-1">
                {notes.map((note) => (
                  <Link
                    key={note.id}
                    to={`/knowledge/notes?focus=${note.id}`}
                    className="focus-ring flex items-start gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <NotebookPen className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-[11.5px] font-medium">{note.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {note.kind === "meeting" ? "Meeting note" : "Note"} ·{" "}
                        {relativeTime(note.at)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel p-3.5">
            <SectionHeader title="Recent activity" />
            {relatedActivity.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No agent activity on this project's people yet.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {relatedActivity.map((entry) => {
                  const agent = agentById(world, entry.agentId);
                  return (
                    <div key={entry.id} className="flex items-start gap-2">
                      {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                      <div className="min-w-0">
                        <p className="truncate text-[11.5px] font-medium">
                          {entry.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {relativeTime(entry.at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {project.name} references {people.length} people from the graph.
        </p>
        <Link
          to="/milestones"
          className={cn(
            "focus-ring inline-flex items-center gap-1 rounded-md text-[11.5px] text-primary transition-colors hover:text-primary/80",
          )}
        >
          Open the milestone board
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default ProjectDetail;
