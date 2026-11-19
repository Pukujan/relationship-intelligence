import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Circle,
  Clock,
  ListChecks,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  missionStatusMeta,
  objectiveById,
  pendingApprovals,
  personById,
  planForMission,
  planProgress,
  projectById,
  relativeTime,
  shortDate,
  tasksForMission,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  KindBadge,
  LoadError,
  PageHeader,
  PageSkeleton,
  PersonAvatar,
  RiskBadge,
  SectionHeader,
} from "@/components/common";
import { Pill, ProgressBar } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { StepStatus, TaskStatus } from "@/data/types";

const stepIcon = (status: StepStatus) => {
  if (status === "done") return <Check className="h-3.5 w-3.5 text-run" />;
  if (status === "doing")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <Circle className="h-3 w-3 text-border" />;
};

const taskTone: Record<TaskStatus, { label: string; className: string }> = {
  running: { label: "Running", className: "border-run/30 bg-run/10 text-run" },
  queued: {
    label: "Queued",
    className: "border-border bg-surface-2 text-muted-foreground",
  },
  blocked: { label: "Blocked", className: "border-warn/30 bg-warn/10 text-warn" },
  done: { label: "Done", className: "border-primary/30 bg-primary/10 text-primary" },
};

const MissionDetail = () => {
  const { missionId } = useParams();
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="This mission didn't load"
        description={error ?? "Something went wrong reading the mission."}
        onRetry={reload}
      />
    );
  }

  const mission = world.missions.find((item) => item.id === missionId);
  if (!mission) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={CalendarDays}
          title="Mission not found"
          description="That mission is not in this workspace. It may have been closed or belongs to another project."
          action={
            <Button size="sm" className="rounded-lg" asChild>
              <Link to="/missions">Back to missions</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const project = projectById(world, mission.projectId);
  const objective = objectiveById(world, mission.objectiveId);
  const plan = planForMission(world, mission.id);
  const tasks = tasksForMission(world, mission.id);
  const people = mission.personIds
    .map((id) => personById(world, id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  const event = mission.eventId
    ? world.events.find((item) => item.id === mission.eventId)
    : undefined;
  const approvals = pendingApprovals(world).filter((approval) =>
    mission.agentIds.includes(approval.agentId),
  );
  const meta = missionStatusMeta[mission.status];
  const agents = mission.agentIds
    .map((id) => agentById(world, id))
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Missions", href: "/missions" }}
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5 normal-case tracking-normal">
            {project ? (
              <Link
                to={`/projects/${project.id}`}
                className="focus-ring rounded transition-colors hover:text-foreground"
              >
                {project.name}
              </Link>
            ) : null}
            <span className="text-border">›</span>
            {objective ? (
              <Link
                to={`/objectives?focus=${objective.id}`}
                className="focus-ring rounded transition-colors hover:text-foreground"
              >
                {objective.name}
              </Link>
            ) : null}
          </span>
        }
        title={mission.name}
        description={mission.summary}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot(`What's the plan for ${mission.name}?`)}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about this mission
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Pill className={meta.className}>{meta.label}</Pill>
        <Pill className="border-border/70 bg-transparent text-muted-foreground">
          {mission.horizon === "today" ? "Due today" : "This week"}
        </Pill>
        <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {relativeTime(mission.due)} · {shortDate(mission.due)}
        </Pill>
        <div className="flex items-center gap-1.5">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:text-primary"
            >
              <AgentAvatar
                agent={agent}
                size="sm"
                className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]"
              />
              {agent.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
        <div className="space-y-3">
          <section className="panel p-4">
            <SectionHeader
              title="Plan"
              count={plan ? `${plan.steps.length} steps` : undefined}
              action={
                <Link
                  to="/plans"
                  className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  All plans
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
            {!plan ? (
              <EmptyState
                className="mt-3"
                icon={ListChecks}
                title="No plan drafted yet"
                description={`${agents[0]?.name ?? "The agent"} drafts the plan when this mission starts. Until then it stays queued.`}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() =>
                      openCopilot(`Draft a plan for ${mission.name}`)
                    }
                  >
                    Draft the plan
                  </Button>
                }
              />
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-medium">{plan.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {plan.summary}
                    </p>
                  </div>
                  <span className="num text-[10.5px] text-muted-foreground">
                    updated {relativeTime(plan.updatedAt)}
                  </span>
                </div>
                <ProgressBar
                  value={planProgress(plan)}
                  className="mt-2.5"
                  label="Plan progress"
                />
                <ol className="mt-3 space-y-1.5">
                  {plan.steps.map((step, index) => {
                    const agent = agentById(world, step.agentId);
                    return (
                      <li
                        key={step.id}
                        className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2"
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                          {stepIcon(step.status)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-[12px] leading-snug",
                              step.status === "done" &&
                                "text-muted-foreground line-through decoration-border",
                            )}
                          >
                            <span className="num mr-1.5 text-[10px] text-muted-foreground/70">
                              {index + 1}
                            </span>
                            {step.label}
                          </p>
                          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                            {step.detail}
                          </p>
                        </div>
                        {agent ? (
                          <Link
                            to={`/agents/${agent.id}`}
                            className="focus-ring shrink-0 rounded-full"
                            aria-label={`Open ${agent.name}`}
                          >
                            <AgentAvatar agent={agent} size="sm" />
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>

          <section className="panel p-4">
            <SectionHeader title="Tasks" count={tasks.length} />
            {tasks.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border/70 px-2.5 py-2.5 text-[11px] text-muted-foreground">
                No atomic tasks yet. Tasks appear here once the plan is accepted.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-border/60">
                {tasks.map((task) => {
                  const agent = agentById(world, task.agentId);
                  const tone = taskTone[task.status];
                  return (
                    <div key={task.id} className="flex items-center gap-2.5 py-2 last:pb-1">
                      {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium">{task.title}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">
                          {agent?.name} · {task.priority} priority
                          {task.note ? ` · ${task.note}` : ""}
                        </p>
                      </div>
                      <Pill className={tone.className}>{tone.label}</Pill>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          {objective ? (
            <div className="panel p-3.5">
              <SectionHeader title="Objective" />
              <div className="mt-2 flex items-start gap-1.5">
                <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <Link
                    to={`/objectives?focus=${objective.id}`}
                    className="focus-ring rounded text-[12.5px] font-medium transition-colors hover:text-primary"
                  >
                    {objective.name}
                  </Link>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {objective.targetLabel}
                  </p>
                </div>
              </div>
              <ProgressBar
                value={objective.progress}
                tone={objective.status === "at_risk" ? "warn" : "run"}
                className="mt-2.5"
                label="Objective progress"
              />
              {project ? (
                <Link
                  to={`/projects/${project.id}`}
                  className="focus-ring mt-2.5 inline-flex items-center gap-1 rounded text-[11px] text-primary transition-colors hover:text-primary/80"
                >
                  {project.name}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          ) : null}

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
                    <p className="truncate text-[11.5px] font-medium">{person.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {person.role}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {event ? (
            <div className="panel p-3.5">
              <SectionHeader title="Event" />
              <Link
                to={`/events?focus=${event.id}`}
                className="focus-ring mt-2 flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-surface-2"
              >
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] font-medium">{event.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {event.location} · {shortDate(event.date)}
                  </p>
                </div>
              </Link>
            </div>
          ) : null}

          <div className="panel p-3.5">
            <SectionHeader title="Waiting on you" count={approvals.length} />
            {approvals.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Nothing from these agents is waiting on a decision.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {approvals.slice(0, 3).map((approval) => (
                  <Link
                    key={approval.id}
                    to={`/approvals?focus=${approval.id}`}
                    className="focus-ring block rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 transition-colors hover:border-border hover:bg-surface-2/50"
                  >
                    <p className="truncate text-[11.5px] font-medium">
                      {approval.title}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <KindBadge kind={approval.kind} />
                      <RiskBadge risk={approval.risk} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default MissionDetail;
