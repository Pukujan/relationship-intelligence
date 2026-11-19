import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Quote, Search, Target } from "lucide-react";
import { canExecute, isKnownRoute, scopePath, type CopilotAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

/**
 * Renders agent-proposed actions. The LLM proposes; this component disposes:
 * unconfirmed navigation renders as a chip that a human tap confirms, cites
 * jump to a real anchor, scope opens pin the graph, and asks seed a thread.
 */
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
    navigate("/copilot", { state: { seed: action.text } });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action, index) => {
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
          action.text;
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
