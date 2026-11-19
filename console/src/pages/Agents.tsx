import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Megaphone,
  Microscope,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentStats,
  missionsForAgent,
  relativeTime,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentCard } from "@/components/AgentCard";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { AgentIcon } from "@/data/types";

const domains: {
  id: AgentIcon;
  label: string;
  icon: typeof Megaphone;
  description: string;
}[] = [
  {
    id: "sales",
    label: "Sales",
    icon: Megaphone,
    description: "Revenue relationships — follow-ups, intros, renewals.",
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Sparkles,
    description: "Narrative, publishing, and distribution.",
  },
  {
    id: "research",
    label: "Research",
    icon: Microscope,
    description: "Market and person research, evidence first.",
  },
];

const Agents = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const [searchParams, setSearchParams] = useSearchParams();
  const domainParam = searchParams.get("domain");
  const domain = domains.find((item) => item.id === domainParam);

  if (status === "loading") return <PageSkeleton rows={3} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Agents didn't load"
        description={error ?? "Something went wrong reading the agent roster."}
        onRetry={reload}
      />
    );
  }

  const visibleDomains = domain ? [domain] : domains;
  const openWork = world.tasks.filter((task) => task.status !== "done").length;
  const pending = world.approvals.filter(
    (approval) => approval.status === "pending",
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Agents"
        title="Your agent team"
        description="Three agents, three specializations. Each one works the graph inside its autonomy, and every outbound move waits for your approval."
        actions={
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() =>
              openCopilot("Add an ops agent that keeps vendor relationships warm")
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add agent
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSearchParams({}, { replace: true })}
          className={cn(
            "focus-ring rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            !domain
              ? "border-border bg-surface-2 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          All specializations
          <span className="num ml-1 text-[10px] text-muted-foreground">
            {world.agents.length}
          </span>
        </button>
        {domains.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSearchParams({ domain: item.id }, { replace: true })}
            className={cn(
              "focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              domainParam === item.id
                ? "border-border bg-surface-2 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="h-3 w-3" />
            {item.label}
            <span className="num text-[10px] text-muted-foreground">
              {world.agents.filter((agent) => agent.icon === item.id).length}
            </span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            <span className="num text-foreground">{openWork}</span> open tasks
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="num text-warn">{pending}</span> waiting on you
          </span>
        </span>
      </div>

      {visibleDomains.map((item) => {
        const agents = world.agents.filter((agent) => agent.icon === item.id);
        return (
          <section key={item.id} className="space-y-3">
            <SectionHeader
              title={item.label}
              count={agents.length}
              action={
                <span className="text-[11px] text-muted-foreground">
                  {item.description}
                </span>
              }
            />
            {agents.length === 0 ? (
              <div className="panel p-5">
                <EmptyState
                  icon={Bot}
                  title={`No ${item.label.toLowerCase()} agent yet`}
                  description="A new agent starts from a mission brief. Nothing runs until you accept it."
                  action={
                    <Button
                      size="sm"
                      className="rounded-lg"
                      onClick={() =>
                        openCopilot(`Add a ${item.label.toLowerCase()} agent`)
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add one
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} world={world} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section className="space-y-3">
        <SectionHeader title="Assigned missions" count={world.missions.length} />
        <div className="grid gap-2 lg:grid-cols-2">
          {world.agents.map((agent) => {
            const missions = missionsForAgent(world, agent.id);
            const stats = agentStats(world, agent.id);
            return (
              <div key={agent.id} className="panel p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/agents/${agent.id}`}
                    className="focus-ring inline-flex items-center gap-1.5 rounded text-[12.5px] font-medium transition-colors hover:text-primary"
                  >
                    {agent.name}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <span className="num text-[10.5px] text-muted-foreground">
                    {stats.successRate}% success · {stats.pending} waiting
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {missions.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No missions assigned right now.
                    </p>
                  ) : (
                    missions.map((mission) => (
                      <Link
                        key={mission.id}
                        to={`/missions/${mission.id}`}
                        className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            mission.status === "running" && "bg-run",
                            mission.status === "blocked" && "bg-warn",
                            mission.status === "queued" && "bg-idle",
                            mission.status === "done" && "bg-primary",
                          )}
                        />
                        <span className="flex-1 truncate">{mission.name}</span>
                        <span className="num text-[10px]">
                          {relativeTime(mission.due)}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" />
          Autonomy: draft, approve, or full. Outbound always needs you.
        </span>
        <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
          {world.agents.filter((agent) => agent.status === "running").length}{" "}
          running
        </Pill>
      </div>
    </div>
  );
};

export default Agents;
