import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  agentById,
  companyById,
  personById,
  relativeTime,
} from "@/data/derive";
import type { Approval, Decision, World } from "@/data/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EvidenceRow,
  KindBadge,
  PersonAvatar,
  RiskBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";

const SWIPE_THRESHOLD = 110;

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
  onDecide: (decision: Decision) => void;
  onEdit: () => void;
}) => {
  const agent = agentById(world, approval.agentId);
  const person = personById(world, approval.personId);
  const company = companyById(world, approval.companyId);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const decide = (decision: Decision) => {
    if (leaving || busy) return;
    setLeaving(decision);
    window.setTimeout(() => onDecide(decision), 170);
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

  const offset = leaving
    ? leaving === "approved"
      ? 620
      : -620
    : dragX;

  const swipeIntent =
    dragX > 40 ? "approved" : dragX < -40 ? "declined" : null;

  return (
    <div className="relative" id={`approval-${approval.id}`}>
      {/* Swipe affordance under the card */}
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
          Decline
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

        <div className="rounded-lg border border-border/60 bg-background/50 p-3">
          <p className="eyebrow mb-1.5 flex items-center gap-1.5">
            Proposed action
            {approval.editedAction ? (
              <span className="rounded border border-primary/25 bg-primary/10 px-1 py-px text-[9px] normal-case tracking-normal text-primary">
                edited
              </span>
            ) : null}
          </p>
          <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-foreground/85">
            {approval.editedAction ?? approval.proposedAction}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="eyebrow">Why</p>
          <p className="max-w-[76ch] text-[11.5px] leading-relaxed text-muted-foreground">
            {approval.reason}
          </p>
          <EvidenceRow evidence={approval.evidence} limit={3} />
        </div>

        <div className="mt-auto flex items-center gap-1.5 pt-1">
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
            onClick={() => decide("declined")}
          >
            <X className="h-3.5 w-3.5" />
            Decline
          </Button>
        </div>
      </article>
    </div>
  );
};
