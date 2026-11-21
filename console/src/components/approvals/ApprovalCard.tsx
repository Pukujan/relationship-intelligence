import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Pencil, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  agentById,
  companyById,
  personById,
  relativeTime,
} from "@/data/derive";
import type { Approval, Decision, DeclinePath, World } from "@/data/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EvidenceRow,
  KindBadge,
  PersonAvatar,
  RiskBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";

const SWIPE_THRESHOLD = 110;

const DECLINE_LABELS: Record<DeclinePath, { label: string; consequence: string }> = {
  stop: {
    label: "Stop",
    consequence: "Stops this thread cleanly — no milestone or follow-up created.",
  },
  re_plan: {
    label: "Re-plan",
    consequence: "Declines this draft and queues one fresh alternative proposal.",
  },
  snooze: {
    label: "Snooze 24h",
    consequence: "Holds this decision for 24 hours without cancelling the thread.",
  },
};

export const ApprovalCard = ({
  approval,
  world,
  selected,
  busy,
  onSelect,
  onDecide,
  onEdit,
}: {
  approval: Approval;
  world: World;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDecide: (decision: Decision, declinePath?: DeclinePath) => void;
  onEdit: () => void;
}) => {
  const agent = agentById(world, approval.agentId);
  const person = personById(world, approval.personId);
  const company = companyById(world, approval.companyId);
  const [declinePath, setDeclinePath] = useState<DeclinePath>("stop");
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const decide = (decision: Decision, path?: DeclinePath) => {
    if (leaving || busy) return;
    setLeaving(decision);
    window.setTimeout(
      () => onDecide(decision, decision === "declined" ? (path ?? declinePath) : undefined),
      170,
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (approval.status !== "pending" || leaving) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    start.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || !dragging) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 14) {
      start.current = null;
      setDragging(false);
      setDragX(0);
      return;
    }
    if (Math.abs(dx) > 8) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragX(dx);
    }
  };

  const endDrag = () => {
    if (!start.current) {
      setDragging(false);
      return;
    }
    const dx = dragX;
    start.current = null;
    setDragging(false);
    setDragX(0);
    if (dx > SWIPE_THRESHOLD) decide("approved");
    else if (dx < -SWIPE_THRESHOLD) decide("declined");
  };

  const offset = leaving ? (leaving === "approved" ? 620 : -620) : dragX;
  const swipeIntent =
    dragX > 40 ? "approved" : dragX < -40 ? "declined" : null;

  return (
    <div className="relative" id={`approval-${approval.id}`}>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between overflow-hidden rounded-xl px-5">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-run transition-opacity"
          style={{ opacity: swipeIntent === "approved" ? 1 : 0.25 }}
        >
          <Check className="h-3.5 w-3.5" />
          Approve
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-opacity"
          style={{ opacity: swipeIntent === "declined" ? 1 : 0.25 }}
        >
          Decline ({DECLINE_LABELS[declinePath].label})
          <X className="h-3.5 w-3.5" />
        </span>
      </div>

      <article
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (dragging) endDrag();
        }}
        onFocus={onSelect}
        onClick={onSelect}
        tabIndex={0}
        role="group"
        aria-label={`${approval.title}, from ${agent?.name ?? "an agent"}`}
        className={cn(
          "panel relative flex touch-pan-y select-none flex-col gap-3 p-4 outline-none transition-[box-shadow,border-color,transform] duration-200",
          "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          selected && "border-primary/35 ring-1 ring-primary/25",
          dragging ? "cursor-grabbing" : "cursor-grab",
          leaving && "opacity-0",
        )}
        style={{
          transform: `translateX(${offset}px) rotate(${offset / 70}deg)`,
          transitionDuration: dragging ? "0ms" : "220ms",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {agent ? <AgentAvatar agent={agent} size="sm" showStatus /> : null}
            <div className="min-w-0">
              <p className="text-[12px] font-semibold leading-tight">
                {agent?.name ?? "Agent"}
              </p>
              <p className="max-w-[220px] truncate text-[10.5px] text-muted-foreground">
                {agent?.role ?? "Agent"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <KindBadge kind={approval.kind} />
                <RiskBadge risk={approval.risk} />
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
                  <Clock className="h-2.5 w-2.5" />
                  {relativeTime(approval.createdAt)}
                </span>
              </div>
            </div>
          </div>
          {approval.status !== "pending" ? (
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                approval.status === "approved"
                  ? "border-run/30 bg-run/10 text-run"
                  : "border-border bg-surface-2 text-muted-foreground",
              )}
            >
              {approval.status}
            </span>
          ) : null}
        </div>

        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">
          {approval.title}
        </h3>

        {person ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/people/${person.id}`}
              className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-2 py-1 text-[11px] transition-colors hover:border-border hover:text-foreground"
            >
              <PersonAvatar name={person.name} size="xs" />
              <span className="font-medium">{person.name}</span>
              {company ? (
                <span className="text-muted-foreground">· {company.name}</span>
              ) : null}
            </Link>
          </div>
        ) : null}

        {/* RI-0014 (#39): explicit Do / Don't preview with chosen decline consequence */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-run/25 bg-run/[0.04] p-2.5">
            <p className="eyebrow mb-1 flex items-center gap-1.5 text-run">
              Do (on approve)
              {approval.editedAction ? (
                <span className="rounded border border-primary/25 bg-primary/10 px-1 py-px text-[9px] normal-case tracking-normal text-primary">
                  edited
                </span>
              ) : null}
            </p>
            <p className="text-[12px] leading-relaxed text-foreground/85">
              {approval.editedAction ?? approval.proposedAction}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="eyebrow">Don&apos;t (on decline)</p>
              <div className="flex items-center gap-1">
                {(["stop", "re_plan", "snooze"] as const).map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setDeclinePath(path)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors",
                      declinePath === path
                        ? "bg-surface-3 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {DECLINE_LABELS[path].label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {DECLINE_LABELS[declinePath].consequence}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="eyebrow">Why</p>
          <p className="max-w-[76ch] text-[11.5px] leading-relaxed text-muted-foreground">
            {approval.reason}
          </p>
          <EvidenceRow evidence={approval.evidence} limit={3} />
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Button
            size="sm"
            className="h-8 flex-1 rounded-lg text-[12px]"
            disabled={busy || Boolean(leaving)}
            onClick={() => decide("approved")}
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg px-2.5 text-[12px]"
            disabled={busy || Boolean(leaving)}
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
            disabled={busy || Boolean(leaving)}
            onClick={() => decide("declined", declinePath)}
          >
            {declinePath === "re_plan" ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Decline · {DECLINE_LABELS[declinePath].label}
          </Button>
        </div>
      </article>
    </div>
  );
};
