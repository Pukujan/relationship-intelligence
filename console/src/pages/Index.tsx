import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Phone,
  Plus,
  Sparkles,
  Snowflake,
  Sun,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  daySummary,
  daysQuiet,
  eventAttendees,
  goingCold,
  missionsDueToday,
  missionsThisWeek,
  pendingApprovals,
  relativeTime,
  shortDate,
  upcomingEvents,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useApprovalDecision } from "@/hooks/useApprovalDecision";
import { AgentCard } from "@/components/AgentCard";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  KindBadge,
  LoadingRows,
  PersonAvatar,
  RiskBadge,
  SectionHeader,
  StrengthMeter,
} from "@/components/common";
import { MissionRow, Pill } from "@/components/work";
import { Button } from "@/components/ui/button";

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const Index = () => {
  const { world, status, error, reload, session, activeProject, activeProjectId } =
    useData();
  const { openCopilot, startCall, call } = useOrchestrator();
  const { act, pendingId } = useApprovalDecision();
  const navigate = useNavigate();

  if (status === "loading") {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-surface-2" />
          <div className="h-8 w-72 rounded bg-surface-2" />
        </div>
        <div className="h-24 rounded-xl border border-border/60 bg-surface-1" />
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="The workspace didn't load"
          description={error ?? "Something went wrong reading the workspace."}
          action={
            <Button size="sm" onClick={reload} className="rounded-lg">
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const summary = daySummary(world);
  const pending = pendingApprovals(world);
  const highRisk = pending.filter((approval) => approval.risk === "high").length;
  const inScope = (projectId: string) =>
    activeProjectId === "all" || projectId === activeProjectId;
  const todayMissions = missionsDueToday(world).filter((mission) =>
    inScope(mission.projectId),
  );
  const weekMissions = missionsThisWeek(world)
    .filter((mission) => inScope(mission.projectId))
    .filter((mission) => !todayMissions.some((item) => item.id === mission.id))
    .slice(0, 4);
  const cold = goingCold(world).slice(0, 4);
  const recent = world.activity
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
  const nextEvents = upcomingEvents(world).slice(0, 2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow flex items-center gap-2">
            {format(new Date(), "EEEE d MMMM")}
            <span className="text-border">·</span>
            <span className="normal-case tracking-normal text-muted-foreground/80">
              {summary.agentsActive} agents working
            </span>
          </p>
          <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px]">
            {greeting()}, {session?.mode === "guest" ? "guest" : "Alex"}.
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            {pending.length > 0 ? (
              <span className="text-foreground/90">
                {pending.length} decisions are waiting on you
              </span>
            ) : (
              <span className="text-foreground/90">Your approval inbox is clear</span>
            )}{" "}
            and {todayMissions.length} mission
            {todayMissions.length === 1 ? " is" : "s are"} due today.{" "}
            {activeProject ? (
              <span className="text-foreground/80">
                Scoped to {activeProject.name}.
              </span>
            ) : (
              "Everything else the team can handle alone."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("What's due today across the team?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask copilot
            <kbd className="kbd ml-1">⌘K</kbd>
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => {
              if (call.state === "idle" || call.state === "ended") startCall();
              navigate("/voice");
            }}
          >
            <Phone className="h-3.5 w-3.5" />
            Call me now
          </Button>
        </div>
      </div>

      {session?.mode === "guest" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2">
          <Pill className="border-warn/30 bg-warn/10 text-warn">Demo</Pill>
          <p className="text-[11.5px] leading-relaxed text-foreground/85">
            You're exploring the seeded Fieldstone workspace. Decisions reset
            when you reload — sign in with Google to load your own workspace.
          </p>
        </div>
      ) : null}

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border/60 sm:grid-cols-4">
        {[
          {
            label: "Approvals waiting",
            value: pending.length,
            hint: highRisk ? `${highRisk} high risk` : "nothing high risk",
            tone: pending.length ? "warn" : undefined,
            to: "/approvals",
          },
          {
            label: "Missions today",
            value: todayMissions.length,
            hint: `${weekMissions.length} more this week`,
            to: "/missions",
          },
          {
            label: "Going cold",
            value: cold.length,
            hint: "14+ days quiet",
            tone: cold.length ? "warn" : undefined,
            to: "/people",
          },
          {
            label: "Agents active",
            value: summary.agentsActive,
            hint: `${world.runs.length} runs in history`,
            to: "/agents",
          },
        ].map((metric) => (
          <Link
            key={metric.label}
            to={metric.to}
            className="focus-ring bg-card p-3.5 transition-colors hover:bg-surface-1 sm:p-4"
          >
            <p className="eyebrow">{metric.label}</p>
            <p className="num mt-1.5 text-[26px] font-semibold leading-none">
              {metric.value}
            </p>
            <p
              className={cn(
                "mt-1 text-[11px] text-muted-foreground",
                metric.tone === "warn" && "text-warn",
              )}
            >
              {metric.hint}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.92fr)]">
        <section className="panel flex flex-col p-4">
          <SectionHeader
            title="My approvals"
            count={pending.length}
            action={
              <Link
                to="/approvals"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Inbox
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {pending.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={Check}
              title="Inbox clear"
              description="Every agent is running inside its autonomy. Ask the copilot to find the next opportunity."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => openCopilot("Who should I follow up with this week?")}
                >
                  Find the next follow-up
                </Button>
              }
            />
          ) : (
            <div className="mt-1 divide-y divide-border/60">
              {pending.slice(0, 4).map((approval) => {
                const agent = agentById(world, approval.agentId);
                if (!agent) return null;
                return (
                  <div key={approval.id} className="flex items-start gap-2.5 py-2.5 last:pb-1">
                    <AgentAvatar agent={agent} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] font-medium text-muted-foreground">
                          {agent.name}
                        </span>
                        <KindBadge kind={approval.kind} />
                        <RiskBadge risk={approval.risk} />
                      </div>
                      <Link
                        to={`/approvals?focus=${approval.id}`}
                        className="focus-ring mt-1 block truncate rounded text-[12.5px] font-medium transition-colors hover:text-primary"
                      >
                        {approval.title}
                      </Link>
                      <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
                        {approval.reason}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-run/10 hover:text-run"
                        aria-label={`Approve: ${approval.title}`}
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "approved")}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                        aria-label={`Decline: ${approval.title}`}
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "declined")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel flex flex-col p-4">
          <SectionHeader
            title="Missions due today"
            count={todayMissions.length}
            action={
              <Link
                to="/missions"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                All missions
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {todayMissions.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={Sun}
              title="Nothing due today"
              description="No mission lands today in this scope. The next ones are already queued for this week."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => openCopilot("What's due this week?")}
                >
                  Review the week
                </Button>
              }
            />
          ) : (
            <div className="mt-2.5 space-y-2">
              {todayMissions.map((mission) => (
                <MissionRow key={mission.id} world={world} mission={mission} />
              ))}
            </div>
          )}

          {weekMissions.length ? (
            <div className="mt-3 border-t border-border/60 pt-2.5">
              <p className="eyebrow mb-1.5">Later this week</p>
              <div className="space-y-1">
                {weekMissions.map((mission) => (
                  <Link
                    key={mission.id}
                    to={`/missions/${mission.id}`}
                    className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <Target className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{mission.name}</span>
                    <span className="num text-[10px]">{shortDate(mission.due)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel flex flex-col p-4">
          <SectionHeader
            title="Going cold"
            count={cold.length}
            action={
              <Link
                to="/people"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Graph
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {cold.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={Snowflake}
              title="Nobody is going cold"
              description="Every relationship has been touched inside its window. Smart lists re-check this automatically."
            />
          ) : (
            <div className="mt-1 divide-y divide-border/60">
              {cold.map((person) => {
                const company = world.companies.find(
                  (item) => item.id === person.companyId,
                );
                return (
                  <Link
                    key={person.id}
                    to={`/people/${person.id}`}
                    className="focus-ring group flex items-center gap-2.5 rounded-md py-2.5 transition-colors last:pb-1 hover:bg-surface-2/40"
                  >
                    <PersonAvatar name={person.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {person.name}
                      </p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {company?.name} · {daysQuiet(person.lastContact)}d quiet
                      </p>
                    </div>
                    <StrengthMeter value={person.strength} />
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
                  </Link>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => openCopilot("Who should I follow up with this week?")}
            className="focus-ring mt-auto flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface-1/50 px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            Ask Mira to draft the warm-up
          </button>
        </section>
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Your team"
          count={world.agents.length}
          action={
            <Link
              to="/agents"
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              All agents
              <ChevronRight className="h-3 w-3" />
            </Link>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {world.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} world={world} />
          ))}
          <button
            type="button"
            onClick={() =>
              openCopilot("Add an ops agent that keeps vendor relationships warm")
            }
            className="focus-ring group flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-surface-1/30 p-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
              <Plus className="h-4 w-4" />
            </span>
            <span className="text-[12.5px] font-medium">Add an agent</span>
            <span className="max-w-[170px] text-[11px] leading-relaxed text-muted-foreground">
              Start from a mission. Ops, recruiting, partnerships.
            </span>
          </button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className="panel flex flex-col p-4">
          <SectionHeader
            title="Live activity"
            action={
              <Link
                to="/activity"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Full timeline
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <div className="mt-1 divide-y divide-border/60">
            {recent.map((entry) => {
              const agent = agentById(world, entry.agentId);
              const person = world.people.find((item) => item.id === entry.personId);
              return (
                <div key={entry.id} className="flex gap-2.5 py-2.5 last:pb-1">
                  {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium leading-snug">
                      {entry.title}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {entry.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num text-[10px] text-muted-foreground/70">
                      {relativeTime(entry.at)}
                    </span>
                    {person ? (
                      <Link
                        to={`/people/${person.id}`}
                        className="focus-ring rounded-full"
                        aria-label={`Open ${person.name}`}
                      >
                        <PersonAvatar name={person.name} size="xs" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel p-4">
          <SectionHeader
            title="Next up"
            action={
              <Link
                to="/calendar"
                className="focus-ring inline-flex items-center gap-1 rounded-md px-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Calendar
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <div className="mt-3 space-y-2">
            {nextEvents.map((event) => {
              const agent = agentById(world, event.agentId);
              const attendees = eventAttendees(world, event);
              return (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
                >
                  <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border/70 bg-surface-2">
                    <span className="num text-[13px] font-semibold leading-none">
                      {format(new Date(event.date), "d")}
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {format(new Date(event.date), "MMM")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/events?focus=${event.id}`}
                      className="focus-ring rounded text-[13px] font-medium transition-colors hover:text-primary"
                    >
                      {event.name}
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {event.location} · {shortDate(event.date)} ·{" "}
                      {attendees.length} people
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 rounded-md px-2 text-[11px]"
                      onClick={() => openCopilot(`Prep me for ${event.name}`)}
                    >
                      <CalendarDays className="h-3 w-3" />
                      Prep
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <Link
            to="/projects"
            className="focus-ring mt-3 flex items-center gap-2 rounded-lg border border-border/60 bg-surface-1/40 px-3 py-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1">
              {world.projects.length} projects ·{" "}
              {world.objectives.length} objectives in this workspace
            </span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
      </div>
    </div>
  );
};

export default Index;
