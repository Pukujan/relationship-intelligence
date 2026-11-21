import { Link } from "react-router-dom";
import { ArrowUpRight, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentStats } from "@/data/derive";
import type { Agent, World } from "@/data/types";
import { AgentAvatar } from "./AgentAvatar";
import { StatusPill } from "./StatusPill";
import { Sparkline } from "./Sparkline";

const sparkTone: Record<Agent["tone"], string> = {
  coral: "text-primary",
  indigo: "text-agent-indigo",
  teal: "text-run",
};

export const AgentCard = ({ agent, world }: { agent: Agent; world: World }) => {
  const stats = agentStats(world, agent.id);
  const pending = stats.pending;

  return (
    <Link
      to={`/agents/${agent.id}`}
      className={cn(
        "panel focus-ring group relative flex flex-col gap-3.5 p-4 transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-border hover:bg-surface-2/30",
      )}
      aria-label={`Open ${agent.name}, ${agent.role}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar agent={agent} size="md" showStatus />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-tight">
              {agent.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {agent.role}
            </p>
          </div>
        </div>
        <StatusPill status={agent.status} className="shrink-0" />
      </div>

      <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
        <div className="flex items-center justify-between">
          <p className="eyebrow flex items-center gap-1.5">
            {agent.status === "running" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
            ) : null}
            Now
          </p>
          {agent.currentTask ? (
            <span className="num text-[10px] text-muted-foreground">
              {agent.currentTask.progress}%
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[32px] text-[12.5px] leading-snug text-foreground/90">
          {agent.currentTask?.title ?? "No task running — waiting for a milestone."}
        </p>
        {agent.currentTask ? (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
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
        ) : null}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3 w-3" />
            <span className="num font-medium text-foreground/85">
              {stats.queued + stats.running}
            </span>
            open
          </span>
          {pending > 0 ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              {pending} waiting
            </span>
          ) : (
            <span className="text-muted-foreground/70">inbox clear</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Sparkline
            values={agent.sparkline}
            width={64}
            height={22}
            className={sparkTone[agent.tone]}
          />
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </Link>
  );
};
