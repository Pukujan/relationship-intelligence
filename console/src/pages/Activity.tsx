import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  FileText,
  Phone,
  Radar,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  companyById,
  eventById,
  groupActivityByDay,
  personById,
  timeOfDay,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  EvidenceRow,
  PersonAvatar,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import type { ActivityType } from "@/data/types";

const typeMeta: Record<
  ActivityType,
  { label: string; icon: typeof Radar; className: string; dot: string }
> = {
  research: {
    label: "Research",
    icon: Radar,
    className: "text-agent-indigo",
    dot: "bg-agent-indigo",
  },
  outreach: {
    label: "Outreach",
    icon: Send,
    className: "text-primary",
    dot: "bg-primary",
  },
  call: { label: "Call", icon: Phone, className: "text-run", dot: "bg-run" },
  approval: {
    label: "Approval",
    icon: ShieldCheck,
    className: "text-warn",
    dot: "bg-warn",
  },
  system: {
    label: "System",
    icon: Settings2,
    className: "text-muted-foreground",
    dot: "bg-idle",
  },
};

const typeFilters: { id: "all" | ActivityType; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "research", label: "Research" },
  { id: "outreach", label: "Outreach" },
  { id: "call", label: "Calls" },
  { id: "approval", label: "Approvals" },
  { id: "system", label: "System" },
];

const Activity = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const navigate = useNavigate();
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ActivityType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => {
    if (!world) return [];
    return world.activity
      .filter(
        (entry) =>
          (agentFilter === "all" || entry.agentId === agentFilter) &&
          (typeFilter === "all" || entry.type === typeFilter),
      )
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [world, agentFilter, typeFilter]);

  const groups = useMemo(() => groupActivityByDay(entries), [entries]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .getElementById(`activity-${selectedId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || !entries.length) return;
      const index = entries.findIndex((entry) => entry.id === selectedId);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId(entries[Math.min(entries.length - 1, index + 1)]?.id ?? entries[0].id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId(entries[Math.max(0, index - 1)]?.id ?? entries[0].id);
      } else if (event.key === "Enter" && selectedId) {
        const entry = entries.find((item) => item.id === selectedId);
        if (entry?.personId) {
          event.preventDefault();
          navigate(`/people/${entry.personId}`);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entries, selectedId, navigate]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-9 w-64 rounded bg-surface-2" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-16 rounded-xl border border-border/60 bg-surface-1"
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="The timeline didn't load"
          description={error ?? "Something went wrong reading the activity feed."}
          action={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const typeCounts = (Object.keys(typeMeta) as ActivityType[]).map((type) => ({
    type,
    count: world.activity.filter(
      (entry) =>
        entry.type === type &&
        (agentFilter === "all" || entry.agentId === agentFilter),
    ).length,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">Everything the team did</p>
          <h1 className="text-[26px] font-semibold leading-tight sm:text-[30px]">
            Activity timeline
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            One feed across every agent. Each entry links to the person,
            company, or event it concerns — and to the evidence behind it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-lg text-[12px]"
          onClick={() => openCopilot("What did the team do today?")}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Summarise the day
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAgentFilter("all")}
            className={cn(
              "focus-ring rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              agentFilter === "all"
                ? "border-border bg-surface-2 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            All agents
          </button>
          {world.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setAgentFilter(agent.id)}
              className={cn(
                "focus-ring inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] font-medium transition-colors",
                agentFilter === agent.id
                  ? "border-border bg-surface-2 text-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <AgentAvatar
                agent={agent}
                size="sm"
                className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]"
              />
              {agent.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {typeFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setTypeFilter(filter.id)}
              className={cn(
                "focus-ring rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                typeFilter === filter.id
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
          <span className="ml-auto hidden items-center gap-1 text-[10.5px] text-muted-foreground sm:inline-flex">
            <kbd className="kbd">J</kbd>
            <kbd className="kbd">K</kbd>
            to move
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_248px]">
        <div className="space-y-5">
          {groups.length === 0 ? (
            <div className="panel p-5">
              <EmptyState
                icon={ShieldCheck}
                title="Nothing matches this filter"
                description="The team is quiet on this channel right now. Widen the filter, or ask the copilot what is running."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => {
                      setAgentFilter("all");
                      setTypeFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-[12px] font-semibold text-foreground/90">
                    {group.label}
                  </h2>
                  <span className="num text-[10px] text-muted-foreground">
                    {group.entries.length}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
                <div className="relative space-y-1.5 pl-0">
                  {group.entries.map((entry) => {
                    const agent = agentById(world, entry.agentId);
                    const person = personById(world, entry.personId);
                    const company = companyById(world, entry.companyId);
                    const event = eventById(world, entry.eventId);
                    const meta = typeMeta[entry.type];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={entry.id}
                        id={`activity-${entry.id}`}
                        onClick={() => setSelectedId(entry.id)}
                        className={cn(
                          "relative flex gap-3 rounded-xl border p-3 transition-colors",
                          selectedId === entry.id
                            ? "border-primary/30 bg-surface-2/60"
                            : "border-border/60 bg-card/60 hover:border-border hover:bg-surface-2/30",
                        )}
                      >
                        <div className="relative flex w-8 shrink-0 flex-col items-center">
                          {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="num text-[10px] text-muted-foreground">
                              {timeOfDay(entry.at)}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded border border-border/70 bg-surface-2/70 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-[0.08em]",
                                meta.className,
                              )}
                            >
                              <Icon className="h-2.5 w-2.5" />
                              {meta.label}
                            </span>
                            {entry.outcome === "pending" ? (
                              <span className="rounded border border-warn/30 bg-warn/10 px-1.5 py-px text-[9.5px] font-medium text-warn">
                                waiting on you
                              </span>
                            ) : entry.outcome === "declined" ? (
                              <span className="rounded border border-border bg-surface-2 px-1.5 py-px text-[9.5px] font-medium text-muted-foreground">
                                declined
                              </span>
                            ) : null}
                            {agent ? (
                              <span className="text-[10px] text-muted-foreground">
                                {agent.name}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[13px] font-medium leading-snug">
                            {entry.title}
                          </p>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                            {entry.detail}
                          </p>
                          {entry.evidence?.length ? (
                            <EvidenceRow evidence={entry.evidence} limit={2} className="mt-1.5" />
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {person ? (
                              <Link
                                to={`/people/${person.id}`}
                                className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] transition-colors hover:text-foreground"
                              >
                                <PersonAvatar name={person.name} size="xs" />
                                {person.name}
                              </Link>
                            ) : null}
                            {company ? (
                              <Link
                                to={`/people?tab=companies&focus=${company.id}`}
                                className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Building2 className="h-2.5 w-2.5" />
                                {company.name}
                              </Link>
                            ) : null}
                            {event ? (
                              <Link
                                to={`/events?focus=${event.id}`}
                                className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <CalendarDays className="h-2.5 w-2.5" />
                                {event.name}
                              </Link>
                            ) : null}
                            {entry.approvalId ? (
                              <Link
                                to={`/approvals?focus=${entry.approvalId}`}
                                className="focus-ring inline-flex items-center gap-1 rounded-full border border-warn/25 bg-warn/[0.06] px-1.5 py-0.5 text-[10.5px] text-warn/90 transition-colors hover:text-warn"
                              >
                                <ArrowRight className="h-2.5 w-2.5" />
                                decision
                              </Link>
                            ) : null}
                            {entry.evidence?.length && (person || company) ? (
                              <Link
                                to={
                                  person
                                    ? `/people/${person.id}`
                                    : `/people?tab=companies&focus=${company?.id}`
                                }
                                className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                sources
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <aside className="space-y-3">
          <div className="panel p-3.5">
            <SectionHeader title="By type" count={entries.length} />
            <div className="mt-2.5 space-y-2">
              {typeCounts.map(({ type, count }) => {
                const meta = typeMeta[type];
                const Icon = meta.icon;
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface-2",
                        meta.className,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="flex-1 text-[11.5px] text-muted-foreground">
                      {meta.label}
                    </span>
                    <span className="num text-[11.5px] font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface-1/50 p-3.5">
            <p className="text-[11.5px] font-medium">Evidence policy</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Every research claim carries a source label and a confidence.
              Unverified facts stay flagged and never become canonical.
            </p>
            <Link
              to="/people"
              className="focus-ring mt-2 inline-flex items-center gap-1 rounded text-[11px] text-primary transition-opacity hover:opacity-80"
            >
              Browse the people graph
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => openCopilot("What did the team do today?")}
            className="focus-ring flex w-full items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-left text-[11.5px] text-foreground/90 transition-colors hover:bg-primary/10"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Ask for the day in plain language</span>
          </button>
        </aside>
      </div>
    </div>
  );
};

export default Activity;
