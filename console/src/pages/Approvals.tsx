import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Inbox,
  Keyboard,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  pendingApprovals,
  relativeTime,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useApprovalDecision } from "@/hooks/useApprovalDecision";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  LoadingRows,
  PageHeader,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Approval, Decision } from "@/data/types";

const Approvals = () => {
  const { world, status, error, reload, activeProject, setActiveProject } =
    useData();
  const { openCopilot } = useOrchestrator();
  const { act, pendingId } = useApprovalDecision();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [editing, setEditing] = useState<Approval | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const pending = useMemo(
    () => (world ? pendingApprovals(world) : []),
    [world],
  );

  const list = useMemo(
    () =>
      agentFilter === "all"
        ? pending
        : pending.filter((approval) => approval.agentId === agentFilter),
    [pending, agentFilter],
  );

  useEffect(() => {
    if (!list.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((approval) => approval.id === selectedId)) {
      setSelectedId(list[0].id);
    }
  }, [list, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const node = document.getElementById(`approval-${selectedId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const decide = (
    approval: Approval,
    decision: Decision,
    declinePath?: "stop" | "re_plan" | "snooze",
  ) => {
    void act(approval.id, decision, { declinePath });
  };

  const openEdit = (approval: Approval) => {
    setEditing(approval);
    setDraft(approval.editedAction ?? approval.proposedAction);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const result = await act(editing.id, "approved", {
      editedAction: draft.trim(),
      note: "Edited before approving.",
    });
    setSaving(false);
    if (result) setEditing(null);
  };

  // Keyboard-first decisions (j/k/a/d/s/e).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editing) return;
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
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!list.length) return;

      const index = list.findIndex((approval) => approval.id === selectedId);
      const current = list[index];

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId(list[Math.min(list.length - 1, index + 1)]?.id ?? list[0].id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId(list[Math.max(0, index - 1)]?.id ?? list[0].id);
      } else if (event.key.toLowerCase() === "a" && current) {
        event.preventDefault();
        decide(current, "approved");
      } else if (event.key.toLowerCase() === "d" && current) {
        event.preventDefault();
        decide(current, "declined", "stop");
      } else if (event.key.toLowerCase() === "s" && current) {
        event.preventDefault();
        decide(current, "declined", "snooze");
      } else if (event.key.toLowerCase() === "e" && current) {
        event.preventDefault();
        openEdit(current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, list, selectedId]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-9 w-64 rounded bg-surface-2" />
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="The inbox didn't load"
          description={error ?? "Something went wrong reading the approval queue."}
          action={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const counts = world.agents.map((agent) => ({
    agent,
    count: pending.filter((approval) => approval.agentId === agent.id).length,
  }));
  const highRisk = pending.filter((approval) => approval.risk === "high").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Human in the loop"
        title="Approval inbox"
        description={
          pending.length
            ? `${pending.length} decisions across ${counts.filter((row) => row.count > 0).length} agents. Nothing sends, calls, publishes, or commits without you.`
            : "Every agent is working inside its autonomy. Anything outbound will land here first."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("What's waiting on my approval?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about the queue
          </Button>
        }
      />

      {activeProject ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-surface-1/50 px-3 py-2">
          <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
            The inbox stays workspace-wide — every project's decisions land
            here. Today and its counts follow the{" "}
            <span className="font-medium text-foreground/85">
              {activeProject.name}
            </span>{" "}
            scope.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2 text-[11px]"
            onClick={() => setActiveProject("all")}
          >
            Clear scope
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAgentFilter("all")}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            agentFilter === "all"
              ? "border-border bg-surface-2 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          All
          <span className="num text-[10px] text-muted-foreground">
            {pending.length}
          </span>
        </button>
        {counts.map(({ agent, count }) => (
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
            <span className="num text-[10px] text-muted-foreground">{count}</span>
          </button>
        ))}
        {highRisk > 0 ? (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10.5px] font-medium text-primary">
            {highRisk} high risk
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_264px]">
        <div className="space-y-3">
          {list.length === 0 ? (
            pending.length === 0 ? (
              <div className="panel p-5">
                <EmptyState
                  icon={ShieldCheck}
                  title="Inbox clear — the team is running"
                  description="Nothing is waiting on you. Ask the copilot to find the next follow-up, or check what the agents did today."
                  action={
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        size="sm"
                        className="rounded-lg"
                        onClick={() =>
                          openCopilot("Who should I follow up with this week?")
                        }
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Find the next follow-up
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-lg" asChild>
                        <Link to="/activity">View the timeline</Link>
                      </Button>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="panel p-5">
                <EmptyState
                  icon={Inbox}
                  title="Nothing from this agent"
                  description="This agent has no pending decisions. Its work is inside autonomy, or it is waiting on another thread."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => setAgentFilter("all")}
                    >
                      Show all agents
                    </Button>
                  }
                />
              </div>
            )
          ) : (
            <>
              <p className="px-0.5 text-[11px] text-muted-foreground">
                Swipe a card right to approve, left to decline — or use the
                keyboard.
              </p>
              {list.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  world={world}
                  selected={selectedId === approval.id}
                  busy={pendingId === approval.id}
                  onSelect={() => setSelectedId(approval.id)}
                  onDecide={(decision, declinePath) => decide(approval, decision, declinePath)}
                  onEdit={() => openEdit(approval)}
                />
              ))}
            </>
          )}
        </div>

        <aside className="space-y-3">
          <div className="panel p-3.5">
            <SectionHeader title="Queue" count={pending.length} />
            <div className="mt-2.5 space-y-2">
              {counts.map(({ agent, count }) => (
                <div key={agent.id} className="flex items-center gap-2">
                  <AgentAvatar agent={agent} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{agent.name}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {agent.role}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "num text-[12px] font-medium",
                      count ? "text-warn" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-3.5">
            <div className="flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[12px] font-semibold">Keyboard</p>
            </div>
            <dl className="mt-2.5 space-y-1.5 text-[11px] text-muted-foreground">
              {[
                ["J / ↓", "Next decision"],
                ["K / ↑", "Previous decision"],
                ["A", "Approve selected"],
                ["D", "Decline selected"],
                ["E", "Edit then approve"],
                ["⌘K", "Ask the copilot"],
              ].map(([key, action]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <dt className="font-mono text-[10px] text-foreground/70">
                    {key}
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface-1/50 p-3.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-run" />
              What approval means
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Approving releases the action immediately and logs it to the
              timeline. Edit first if the wording is off — the agent keeps your
              version. Declining stops the thread and asks the agent to try
              another angle.
            </p>
            {pending[0] ? (
              <p className="mt-2 text-[10.5px] text-muted-foreground/80">
                Oldest waiting: {relativeTime(pending[pending.length - 1].createdAt)}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => openCopilot("What's waiting on my approval?")}
            className="focus-ring flex w-full items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-left text-[11.5px] text-foreground/90 transition-colors hover:bg-primary/10"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1">
              Or let the copilot walk you through the queue
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </button>
        </aside>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-xl gap-0 border-border/80 bg-popover p-0 sm:rounded-2xl">
          <DialogHeader className="border-b border-border/70 px-4 py-3.5 text-left">
            <DialogTitle className="text-[15px]">Edit before approving</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed">
              {editing
                ? `${agentById(world, editing.agentId)?.name ?? "The agent"} keeps your version and sends it exactly as written.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 py-3.5">
            {editing ? (
              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <p className="eyebrow mb-1">Original</p>
                <p className="line-clamp-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  {editing.proposedAction}
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label
                htmlFor="edited-action"
                className="text-[11.5px] font-medium text-foreground/85"
              >
                Your version
              </label>
              <Textarea
                id="edited-action"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={6}
                className="resize-none border-border/80 bg-background/60 text-[12.5px] leading-relaxed"
              />
              <p className="text-[10.5px] text-muted-foreground">
                {draft.trim().length} characters · the agent's evidence stays
                attached.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 border-t border-border/70 px-4 py-3 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg text-[12px]"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-lg text-[12px]"
              disabled={saving || !draft.trim()}
              onClick={saveEdit}
            >
              <Check className="h-3.5 w-3.5" />
              Save & approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Approvals;
