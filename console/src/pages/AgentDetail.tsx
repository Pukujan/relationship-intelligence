import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleSlash,
  Clock,
  Minus,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  activityForAgent,
  agentById,
  agentStats,
  outcomeTone,
  pendingApprovalsForAgent,
  relativeTime,
  runsForAgent,
  taskGroups,
  tasksForAgent,
  timeOfDay,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useApprovalDecision } from "@/hooks/useApprovalDecision";
import { AgentAvatar } from "@/components/AgentAvatar";
import { StatusPill } from "@/components/StatusPill";
import { Sparkline } from "@/components/Sparkline";
import {
  EmptyState,
  EvidenceRow,
  KindBadge,
  PageHeader,
  PersonAvatar,
  RiskBadge,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import type { AgentTask } from "@/data/types";

const taskStatusMeta: Record<
  AgentTask["status"],
  { label: string; dot: string; icon: typeof Check }
> = {
  running: { label: "Running", dot: "bg-run", icon: Play },
  queued: { label: "Queued", dot: "bg-idle", icon: Clock },
  blocked: { label: "Blocked", dot: "bg-warn", icon: CircleSlash },
  done: { label: "Done", dot: "bg-run/60", icon: Check },
};

const AgentDetail = () => {
  const { agentId } = useParams();
  const { world, status, reload, toggleAgentPause } = useData();
  const { openCopilot } = useOrchestrator();
  const { act, pendingId } = useApprovalDecision();
  const [pausing, setPausing] = useState(false);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-4 w-28 rounded bg-surface-2" />
        <div className="h-24 rounded-xl border border-border/60 bg-surface-1" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-24 rounded-xl border border-border/60 bg-surface-1"
            />
          ))}
        </div>
        <div className="h-64 rounded-xl border border-border/60 bg-surface-1" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load this agent"
          description="The workspace failed to load. Try again."
          action={
            <Button size="sm" onClick={reload}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const agent = world ? agentById(world, agentId) : undefined;
  if (!world || !agent) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="That agent doesn't exist"
          description="It may have been retired. The rest of the team is still working."
          action={
            <Button size="sm" asChild>
              <Link to="/agents">Back to agents</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const stats = agentStats(world, agent.id);
  const tasks = tasksForAgent(world, agent.id);
  const runs = runsForAgent(world, agent.id);
  const approvals = pendingApprovalsForAgent(world, agent.id);
  const log = activityForAgent(world, agent.id).slice(0, 9);

  const handlePause = async () => {
    setPausing(true);
    try {
      await toggleAgentPause(agent.id);
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Agents", href: "/agents" }}
        eyebrow={`Agent · joined ${relativeTime(agent.joinedAt)}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {agent.name}
            <StatusPill status={agent.status} />
          </span>
        }
        description={agent.mission}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() =>
                openCopilot(`What is ${agent.name} working on right now?`)
              }
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Ask {agent.name}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={handlePause}
              disabled={pausing}
            >
              {agent.status === "paused" ? (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </>
              )}
            </Button>
          </>
        }
      />

      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <AgentAvatar agent={agent} size="lg" showStatus />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              <ShieldCheck className="mr-1 inline h-3 w-3" />
              Autonomy ·{" "}
              {agent.autonomy === "approve"
                ? "asks before sending"
                : agent.autonomy === "draft"
                  ? "drafts only"
                  : "full"}
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              {stats.successRate}% of recent runs fully landed
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/85">
            {agent.currentTask
              ? agent.currentTask.title
              : "No task running. The queue is idle until you assign the next milestone."}
          </p>
          {agent.currentTask ? (
            <div className="flex items-center gap-2">
              <div className="h-1 w-full max-w-[280px] overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    "h-full rounded-full",
                    agent.tone === "coral" && "bg-primary",
                    agent.tone === "indigo" && "bg-agent-indigo",
                    agent.tone === "teal" && "bg-run",
                  )}
                  style={{ width: `${agent.currentTask.progress}%` }}
                />
              </div>
              <span className="num text-[10.5px] text-muted-foreground">
                {agent.currentTask.progress}% · started{" "}
                {relativeTime(agent.currentTask.startedAt)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="eyebrow">Open tasks</p>
            <p className="num text-[20px] font-semibold">
              {stats.queued + stats.running}
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Waiting on you</p>
            <p
              className={cn(
                "num text-[20px] font-semibold",
                stats.pending > 0 && "text-warn",
              )}
            >
              {stats.pending}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {agent.kpis.map((kpi) => (
          <div key={kpi.id} className="panel flex flex-col justify-between gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="eyebrow">{kpi.label}</p>
              {kpi.direction === "up" ? (
                <TrendingUp className="h-3.5 w-3.5 text-run" />
              ) : kpi.direction === "down" ? (
                <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <p className="num text-[26px] font-semibold leading-none">
              {kpi.value}
            </p>
            <div className="flex items-end justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">{kpi.delta}</p>
              {kpi.series ? (
                <Sparkline
                  values={kpi.series}
                  width={56}
                  height={20}
                  className={cn(
                    agent.tone === "coral" && "text-primary",
                    agent.tone === "indigo" && "text-agent-indigo",
                    agent.tone === "teal" && "text-run",
                  )}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <section className="panel p-4">
            <SectionHeader
              title="Task queue"
              count={tasks.length}
              action={
                <span className="text-[11px] text-muted-foreground">
                  {stats.blocked} blocked
                </span>
              }
            />
            <div className="mt-3 space-y-3">
              {taskGroups.map((group) => {
                const groupTasks = tasks.filter(
                  (task) => task.status === group.status,
                );
                if (!groupTasks.length) return null;
                const meta = taskStatusMeta[group.status];
                return (
                  <div key={group.status} className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                      <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {group.label}
                      </p>
                      <span className="num text-[10px] text-muted-foreground/70">
                        {groupTasks.length}
                      </span>
                    </div>
                    {groupTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "text-[12.5px] font-medium leading-snug",
                                group.status === "done" &&
                                  "text-muted-foreground line-through decoration-border",
                              )}
                            >
                              {task.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                              {task.priority === "high" ? (
                                <span className="font-medium text-primary">
                                  High priority
                                </span>
                              ) : null}
                              {task.note ? <span>{task.note}</span> : null}
                              {task.due ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" />
                                  due {relativeTime(task.due)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {typeof task.progress === "number" ? (
                            <span className="num text-[10.5px] text-muted-foreground">
                              {task.progress}%
                            </span>
                          ) : null}
                        </div>
                        {typeof task.progress === "number" ? (
                          <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-run/70"
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel p-4">
            <SectionHeader title="Run history" count={runs.length} />
            <div className="mt-2 divide-y divide-border/60">
              {runs.map((run) => {
                const tone = outcomeTone[run.outcome];
                return (
                  <div key={run.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[10.5px] text-muted-foreground">
                        {timeOfDay(run.startedAt)}
                      </span>
                      <p className="text-[12.5px] font-medium">{run.title}</p>
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          tone.className,
                        )}
                      >
                        {tone.label}
                      </span>
                      <span className="num ml-auto text-[10px] text-muted-foreground">
                        {run.durationMin} min
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                      {run.summary}
                    </p>
                    {run.evidence?.length ? (
                      <EvidenceRow
                        evidence={run.evidence}
                        limit={2}
                        className="mt-1.5"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="panel p-4">
            <SectionHeader
              title="Approvals waiting"
              count={approvals.length}
              action={
                <Link
                  to="/approvals"
                  className="focus-ring rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Inbox
                </Link>
              }
            />
            {approvals.length === 0 ? (
              <EmptyState
                className="mt-3"
                icon={ShieldCheck}
                title="Nothing waiting"
                description={`${agent.name} is working inside its autonomy. Anything outbound will land here first.`}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() =>
                      openCopilot(`What is ${agent.name} working on right now?`)
                    }
                  >
                    Ask what's next
                  </Button>
                }
              />
            ) : (
              <div className="mt-3 space-y-2">
                {approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-lg border border-border/70 bg-background/40 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={approval.kind} />
                      <RiskBadge risk={approval.risk} />
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {relativeTime(approval.createdAt)}
                      </span>
                    </div>
                    <Link
                      to={`/approvals?focus=${approval.id}`}
                      className="focus-ring mt-1.5 block rounded text-[12.5px] font-medium leading-snug transition-colors hover:text-primary"
                    >
                      {approval.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {approval.reason}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 flex-1 rounded-md text-[11px]"
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "approved")}
                      >
                        <Check className="h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 rounded-md text-[11px]"
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "declined")}
                      >
                        <X className="h-3 w-3" />
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-4">
            <SectionHeader
              title="Activity log"
              action={
                <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
                  live
                </span>
              }
            />
            <ol className="mt-3 space-y-3">
              {log.map((entry) => {
                const person = world.people.find(
                  (item) => item.id === entry.personId,
                );
                return (
                  <li key={entry.id} className="relative flex gap-2.5 pl-0.5">
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        entry.type === "research" && "bg-agent-indigo",
                        entry.type === "outreach" && "bg-primary",
                        entry.type === "call" && "bg-run",
                        entry.type === "approval" && "bg-warn",
                        entry.type === "system" && "bg-idle",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] font-medium leading-snug">
                          {entry.title}
                        </p>
                        <span className="num shrink-0 text-[10px] text-muted-foreground/70">
                          {relativeTime(entry.at)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {entry.detail}
                      </p>
                      {person ? (
                        <Link
                          to={`/people/${person.id}`}
                          className="focus-ring mt-1 inline-flex items-center gap-1 rounded text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <PersonAvatar name={person.name} size="xs" />
                          {person.name}
                          <ArrowRight className="h-2.5 w-2.5" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
};

export default AgentDetail;
