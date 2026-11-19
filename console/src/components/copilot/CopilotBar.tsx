import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Mic,
  Phone,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentById } from "@/data/derive";
import { useOrchestrator, type CopilotMode } from "./OrchestratorProvider";
import { designAsProposal } from "@/lib/intelligence";
import { AgentAvatar } from "@/components/AgentAvatar";
import { KindBadge, RiskBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Decision } from "@/data/types";

const StepIcon = ({ state }: { state: "done" | "active" | "pending" }) => {
  if (state === "done") {
    return <Check className="h-3.5 w-3.5 text-run" />;
  }
  if (state === "active") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  return <Circle className="h-3 w-3 text-border" />;
};

const designSuggestions = [
  "Re-engage the Halcyon sponsors before the renewal window closes",
  "Turn last week's summit contacts into a warm pipeline",
  "Build a plan to reopen the cold Northwind thread",
];

const ModeToggle = ({
  mode,
  setMode,
}: {
  mode: CopilotMode;
  setMode: (mode: CopilotMode) => void;
}) => (
  <div className="flex shrink-0 items-center rounded-md border border-border/70 bg-surface-1 p-0.5">
    {(["ask", "design"] as const).map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => setMode(option)}
        aria-pressed={mode === option}
        className={cn(
          "focus-ring rounded px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors",
          mode === option
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {option === "ask" ? "Ask" : "Design"}
      </button>
    ))}
  </div>
);

export const CopilotBar = () => {
  const {
    copilotOpen,
    closeCopilot,
    seedPrompt,
    exchange,
    submitPrompt,
    resetExchange,
    mode,
    setMode,
    suggestions,
    startCall,
    call,
  } = useOrchestrator();
  const { world, decide, addProposal } = useData();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [heldApprovalId, setHeldApprovalId] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copilotOpen) return;
    setValue(seedPrompt);
    setHeldApprovalId(null);
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [copilotOpen, seedPrompt]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt) return;
    void submitPrompt(prompt);
    setValue("");
  };

  const handleHold = async () => {
    if (!world || !exchange?.design) return;
    setHolding(true);
    try {
      const approval = await addProposal(
        designAsProposal(world, exchange.design),
      );
      setHeldApprovalId(approval.id);
      toast.success("Held for approval", {
        description:
          "The proposal is in your inbox. Nothing becomes work until you approve it.",
      });
    } catch (error) {
      toast.error("The proposal could not be held", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setHolding(false);
    }
  };

  const handleDecide = async (approvalId: string, decision: Decision) => {
    setDecidingId(approvalId);
    try {
      await decide({
        approvalId,
        decision,
        note:
          decision === "approved"
            ? "Approved from the copilot."
            : "Declined from the copilot.",
      });
      toast.success(decision === "approved" ? "Approved" : "Declined", {
        description: "The decision is in the timeline and the agent's state.",
      });
    } catch (error) {
      toast.error("That decision could not be recorded", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setDecidingId(null);
    }
  };

  const goToVoice = (callNow: boolean) => {
    closeCopilot();
    navigate("/voice");
    if (callNow && (call.state === "idle" || call.state === "ended")) {
      startCall();
    }
  };

  const answer = exchange?.answer;
  const stepIndex = exchange?.stepIndex ?? 0;
  const complete = exchange?.complete ?? false;

  return (
    <Dialog open={copilotOpen} onOpenChange={(open) => !open && closeCopilot()}>
      <DialogContent
        className="!flex left-1/2 top-3 max-h-[92vh] w-[calc(100%-1rem)] max-w-2xl translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border-border/80 bg-popover p-0 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] data-[state=open]:slide-in-from-top-2 sm:top-[8%] sm:rounded-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Copilot</DialogTitle>
        <DialogDescription className="sr-only">
          Ask the copilot in plain language. It routes the request to the right
          agents and shows a live plan.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="border-b border-border/70">
          <div className="flex items-center gap-2.5 px-3 py-2.5 pr-10">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={
                mode === "design"
                  ? "Describe a goal — “re-engage the Halcyon sponsors before renewal”"
                  : "Ask the copilot — “who should I follow up with this week?”"
              }
              className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/80"
              aria-label="Ask the copilot"
            />
            <div className="flex shrink-0 items-center gap-1">
              <ModeToggle mode={mode} setMode={setMode} />
              <button
                type="button"
                onClick={() => goToVoice(false)}
                aria-label="Open voice surface"
                className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Mic className="h-4 w-4" />
              </button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-md px-2 text-[11.5px]"
                onClick={() => goToVoice(true)}
              >
                <Phone className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Call me</span>
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-md px-2.5 text-[11.5px]"
                disabled={!value.trim()}
              >
                Run
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!exchange ? (
            <div className="space-y-3">
              <p className="eyebrow px-1">
                {mode === "design" ? "Describe a goal to design" : "Try a request"}
              </p>
              <div className="grid gap-1">
                {(mode === "design" ? designSuggestions : suggestions).map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => submitPrompt(suggestion)}
                      className="focus-ring group flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      {mode === "design" ? (
                        <Target className="h-3.5 w-3.5 text-primary/70" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-primary/70" />
                      )}
                      <span className="flex-1">{suggestion}</span>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    </button>
                  ),
                )}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-1/60 px-2.5 py-2">
                <span className="text-[11px] text-muted-foreground">
                  {mode === "design"
                    ? "Design mode researches the goal, drafts a mission, objective, and plan — then holds it for your approval."
                    : "Typing, speaking, and phone calls all route through one orchestrator."}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  You
                </span>
                <p className="flex-1 text-[13.5px] leading-relaxed text-foreground">
                  {exchange.prompt}
                </p>
                <button
                  type="button"
                  onClick={resetExchange}
                  className="focus-ring rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Start a new request"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="rounded-xl border border-border/70 bg-surface-1/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" />
                    {answer?.intentLabel}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                      exchange.source === "live-model"
                        ? "border-run/30 bg-run/10 text-run"
                        : "border-border bg-surface-2 text-muted-foreground",
                    )}
                    title={
                      exchange.source === "live-model"
                        ? "Answered by the model over the copilot server"
                        : "Copilot server unreachable — answered by the local router"
                    }
                  >
                    {exchange.source === "live-model"
                      ? "live model"
                      : "offline simulation"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">Routing to</span>
                  <div className="flex items-center gap-1.5">
                    {answer?.agents.map((agentId) => {
                      const agent = world ? agentById(world, agentId) : undefined;
                      if (!agent) return null;
                      return (
                        <span
                          key={agentId}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium"
                        >
                          <AgentAvatar agent={agent} size="sm" className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]" />
                          {agent.name}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <ol className="mt-3 space-y-1.5">
                  {answer?.steps.map((step, index) => {
                    const state =
                      complete || index < stepIndex
                        ? "done"
                        : index === stepIndex
                          ? "active"
                          : "pending";
                    return (
                      <li
                        key={`${step.label}-${index}`}
                        className={cn(
                          "flex items-start gap-2 text-[12px] transition-opacity",
                          state === "pending" ? "opacity-40" : "opacity-100",
                        )}
                      >
                        <span className="mt-0.5 flex h-4 w-4 items-center justify-center">
                          <StepIcon state={state} />
                        </span>
                        <span className="flex-1 leading-relaxed">
                          <span
                            className={cn(
                              state === "active" && "text-foreground",
                              state === "done" && "text-foreground/80",
                            )}
                          >
                            {step.label}
                          </span>
                          {step.detail ? (
                            <span className="ml-1.5 text-[11px] text-muted-foreground">
                              {step.detail}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {complete ? (
                <div className="animate-rise space-y-3">
                  <p className="text-[13px] leading-relaxed text-foreground/90">
                    {answer?.summary}
                  </p>

                  {exchange.design ? (
                    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="eyebrow">Proposed mission — held for you</p>
                        <span className="text-[10.5px] text-muted-foreground">
                          due {exchange.design.due.slice(0, 10)} · autonomy{" "}
                          {exchange.design.autonomy}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13.5px] font-medium text-foreground">
                        {exchange.design.missionName}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                        {exchange.design.missionSummary}
                      </p>
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-border/60 bg-surface-1 px-2.5 py-2">
                        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <div>
                          <p className="text-[12px] font-medium">
                            {exchange.design.objectiveName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            target: {exchange.design.objectiveTarget}
                            {exchange.design.projectName
                              ? ` · new project “${exchange.design.projectName}”`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <ol className="mt-2 space-y-1">
                        {exchange.design.planSteps.map((step, index) => (
                          <li
                            key={`${step.label}-${index}`}
                            className="flex items-start gap-2 text-[12px]"
                          >
                            <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border/70 bg-surface-2 text-[9px] text-muted-foreground">
                              {index + 1}
                            </span>
                            <span>
                              <span className="text-foreground/90">
                                {step.label}
                              </span>
                              {step.detail ? (
                                <span className="ml-1.5 text-[11px] text-muted-foreground">
                                  {step.detail}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                      {exchange.design.unverified.length ? (
                        <ul className="mt-2 space-y-1 rounded-lg border border-border/60 bg-surface-1/70 px-2.5 py-2">
                          {exchange.design.unverified.map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                            >
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-3 flex items-center gap-2">
                        {heldApprovalId ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-run/30 bg-run/10 px-2.5 py-1 text-[11px] font-medium text-run">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            In your approval inbox
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="h-8 rounded-md px-3 text-[11.5px]"
                            disabled={holding}
                            onClick={() => void handleHold()}
                          >
                            {holding ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Hold for approval
                          </Button>
                        )}
                        {heldApprovalId ? (
                          <Link
                            to={`/approvals?focus=${heldApprovalId}`}
                            onClick={closeCopilot}
                            className="text-[11.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            Open in inbox
                          </Link>
                        ) : (
                          <span className="text-[10.5px] text-muted-foreground">
                            Nothing becomes work until you approve it.
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {answer?.draft ? (
                    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                      <p className="eyebrow mb-1.5">
                        {answer?.intentId === "add-agent"
                          ? "Proposed mission brief"
                          : "Draft · held for approval"}
                      </p>
                      <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-foreground/85">
                        {answer.draft}
                      </p>
                    </div>
                  ) : null}

                  {answer?.approvalIds.length ? (
                    <div className="space-y-1.5">
                      <p className="eyebrow">Decisions waiting</p>
                      {answer.approvalIds.map((approvalId) => {
                        const approval = world?.approvals.find(
                          (item) => item.id === approvalId,
                        );
                        if (!world || !approval) return null;
                        const agent = agentById(world, approval.agentId);
                        return (
                          <div
                            key={approvalId}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface-1 px-2.5 py-2"
                          >
                            {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium">
                                {approval.title}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <KindBadge kind={approval.kind} />
                                <RiskBadge risk={approval.risk} />
                              </div>
                            </div>
                            {approval.status === "pending" ? (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-7 rounded-md px-2 text-[11px]"
                                  disabled={decidingId === approval.id}
                                  onClick={() =>
                                    handleDecide(approval.id, "approved")
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 rounded-md px-2 text-[11px] text-muted-foreground"
                                  disabled={decidingId === approval.id}
                                  onClick={() =>
                                    handleDecide(approval.id, "declined")
                                  }
                                >
                                  Decline
                                </Button>
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                                  approval.status === "approved"
                                    ? "border-run/30 bg-run/10 text-run"
                                    : "border-border bg-surface-2 text-muted-foreground",
                                )}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                {approval.status === "approved"
                                  ? "Approved"
                                  : "Declined"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {answer?.links.length ? (
                    <div className="space-y-1">
                      <p className="eyebrow">Open</p>
                      {answer.links.map((link) => (
                        <Link
                          key={`${link.href}-${link.label}`}
                          to={link.href}
                          onClick={closeCopilot}
                          className="focus-ring group flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                          <ArrowRight className="h-3 w-3 text-primary/70" />
                          <span className="flex-1 truncate">{link.label}</span>
                          {link.meta ? (
                            <span className="truncate text-[10.5px] text-muted-foreground/80">
                              {link.meta}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2 text-[10.5px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">K</kbd>
              <span className="ml-0.5">toggle</span>
            </span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="kbd">Esc</kbd>
              <span className="ml-0.5">close</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => goToVoice(false)}
            className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Mic className="h-3 w-3" />
            Voice surface
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
