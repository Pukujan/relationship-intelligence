import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Quote, Search, Target } from "lucide-react";
import { toast } from "sonner";
import { canExecute, isKnownRoute, scopePath, type CopilotAction } from "@/lib/actions";
import { useData } from "@/data/store";
import { Button } from "@/components/ui/button";

/**
 * Renders agent-proposed actions. The LLM proposes; this component disposes:
 * unconfirmed navigation renders as a chip that a human tap confirms, cites
 * jump to a real anchor, scope opens pin the graph, asks seed a thread, and a
 * proposed schedule is created only when the human explicitly confirms it.
 */

/** A schedule the copilot proposed after planning it with the human. The
 *  brief, cadence, and scope are fully disclosed; the confirm click is the
 *  human's decision, and nothing is written before it. */
const ScheduleProposal = ({ action }: { action: Extract<CopilotAction, { kind: "createSchedule" }> }) => {
  const { session, world } = useData();
  const navigate = useNavigate();
  const [state, setState] = useState<"proposed" | "creating" | "created" | "failed">("proposed");
  const scopeName =
    action.scopeKind === "workspace"
      ? "whole workspace"
      : action.scopeKind === "project"
        ? (world?.projects.find((p) => p.id === action.scopeId)?.name ?? "a project")
        : (world?.people.find((p) => p.id === action.scopeId)?.name ?? "a person");

  const confirm = async () => {
    if (!session || !canExecute(action) || state === "creating" || state === "created") return;
    setState("creating");
    try {
      const r = await fetch("/app-api/schedules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          prompt: action.prompt,
          cadence: action.cadence,
          scopeKind: action.scopeKind,
          scopeId: action.scopeId ?? null,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setState("created");
      toast.success("Schedule created", { description: "Agreed in conversation; due runs queue in Schedules." });
    } catch {
      setState("failed");
      toast.error("Could not create the schedule", { description: "Nothing was saved — confirm again to retry." });
    }
  };

  return (
    <div className="w-full max-w-md rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
        <CalendarClock className="h-3.5 w-3.5" /> Proposed schedule — yours to confirm
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed">{action.prompt}</p>
      <p className="mt-1 text-[10.5px] text-muted-foreground">{action.cadence} · {scopeName}</p>
      <div className="mt-2 flex items-center gap-2">
        {state === "created" ? (
          <>
            <span className="text-[11px] text-run">Created</span>
            <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-[11px]" onClick={() => navigate("/schedules")}>
              View in Schedules <ArrowRight className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            className="h-7 rounded-full px-3 text-[11px]"
            disabled={state === "creating" || !canExecute(action)}
            onClick={() => void confirm()}
          >
            {state === "creating" ? "Creating…" : state === "failed" ? "Confirm again" : "Confirm & create"}
          </Button>
        )}
      </div>
    </div>
  );
};

export const SessionActions = ({ actions }: { actions: CopilotAction[] }) => {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState<number[]>([]);

  const run = (action: CopilotAction, index: number) => {
    if (action.kind === "navigate") {
      if (!isKnownRoute(action.path)) return;
      if (!action.go && !confirmed.includes(index)) {
        setConfirmed((current) => [...current, index]);
        return;
      }
      navigate(action.path);
      return;
    }
    if (action.kind === "cite") {
      if (!isKnownRoute(action.path)) return;
      navigate(`${action.path.split("#")[0]}#${action.anchor}`);
      return;
    }
    if (action.kind === "openScope") {
      navigate(scopePath(action));
      return;
    }
    if (action.kind === "createSchedule") return; // handled by its own confirm card
    navigate("/copilot", { state: { seed: action.text } });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action, index) => {
        if (action.kind === "createSchedule") return <ScheduleProposal key={index} action={action} />;
        const executable = canExecute(action) || (action.kind === "navigate" && confirmed.includes(index));
        const icon =
          action.kind === "cite" ? <Quote className="h-3 w-3" /> :
          action.kind === "openScope" ? <Target className="h-3 w-3" /> :
          action.kind === "ask" ? <Search className="h-3 w-3" /> :
          <ArrowRight className="h-3 w-3" />;
        const label =
          action.kind === "navigate" ? (executable ? action.label : `Open ${action.label}?`) :
          action.kind === "cite" ? action.heading :
          action.kind === "openScope" ? action.label :
          action.kind === "ask" ? action.text : "";
        return (
          <Button
            key={index}
            type="button"
            size="sm"
            variant={executable ? "outline" : "ghost"}
            className="h-7 gap-1.5 rounded-full border-border/70 px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => run(action, index)}
          >
            {icon}
            <span className="max-w-56 truncate">{label}</span>
          </Button>
        );
      })}
    </div>
  );
};
