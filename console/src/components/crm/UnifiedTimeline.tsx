import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { shortDate } from "@/data/derive";
import type { World } from "@/data/types";
import type { PeekTarget } from "./Peek";

/**
 * One timeline, many dated entities: milestone.due, objective.dueDate,
 * event.date, and approval.expiresAt (plus meeting notes, which the calendar
 * has always shown). The Calendar page and Today's next-7-days strip render
 * the same feed, so the two surfaces can never disagree about what lands when.
 * Clicking an item opens Peek at Brief altitude.
 */

export type TimelineKind = "mission" | "objective" | "event" | "approval" | "meeting";

export interface TimelineItem {
  kind: TimelineKind;
  id: string;
  date: string;
  title: string;
  meta: string;
  /** Milestones only — drives the needs-you dot. */
  status?: string;
  /** Fallback navigation for kinds without a Peek (meeting notes). */
  href?: string;
}

export const timelineTone = (item: TimelineItem) =>
  item.kind === "mission"
    ? item.status === "blocked"
      ? "bg-warn"
      : item.status === "done"
        ? "bg-primary"
        : "bg-run"
    : item.kind === "event"
      ? "bg-primary"
      : item.kind === "approval"
        ? "bg-warn"
        : item.kind === "objective"
          ? "bg-agent-teal"
          : "bg-agent-indigo";

export const peekTargetForItem = (item: TimelineItem): PeekTarget | null =>
  item.kind === "meeting" ? null : { kind: item.kind, id: item.id };

interface CollectOptions {
  /** "all" or a project id — milestones/objectives/approvals follow the scope. */
  projectId?: string;
  kinds?: TimelineKind[];
  from?: Date;
  to?: Date;
}

export const collectTimelineItems = (
  world: World,
  { projectId = "all", kinds, from, to }: CollectOptions = {},
): TimelineItem[] => {
  const inScope = (id: string) => projectId === "all" || id === projectId;
  const project = world.projects.find((item) => item.id === projectId);
  const wanted = (kind: TimelineKind) => !kinds || kinds.includes(kind);
  const items: TimelineItem[] = [];

  if (wanted("mission")) {
    for (const milestone of world.milestones) {
      if (!inScope(milestone.projectId)) continue;
      const parent = world.projects.find((item) => item.id === milestone.projectId);
      items.push({
        kind: "mission",
        id: milestone.id,
        date: milestone.due,
        title: milestone.name,
        meta: `${parent?.name ?? "Project"} · ${milestone.status.replace("_", " ")}`,
        status: milestone.status,
      });
    }
  }
  if (wanted("objective")) {
    for (const objective of world.objectives) {
      if (!objective.dueDate || !inScope(objective.projectId)) continue;
      const parent = world.projects.find((item) => item.id === objective.projectId);
      items.push({
        kind: "objective",
        id: objective.id,
        date: objective.dueDate,
        title: objective.name,
        meta: `${parent?.name ?? "Project"} · ${objective.progress}%`,
      });
    }
  }
  if (wanted("event")) {
    // Events belong to the graph, not to a project scope — they stay global.
    for (const event of world.events) {
      items.push({
        kind: "event",
        id: event.id,
        date: event.date,
        title: event.name,
        meta: `${event.location} · ${event.attendeeIds.length} people`,
      });
    }
  }
  if (wanted("approval")) {
    for (const approval of world.approvals) {
      if (approval.status !== "pending" || !approval.expiresAt) continue;
      if (
        projectId !== "all" &&
        approval.design?.projectId !== projectId &&
        !(approval.personId && project?.personIds.includes(approval.personId))
      ) {
        continue;
      }
      items.push({
        kind: "approval",
        id: approval.id,
        date: approval.expiresAt,
        title: approval.title,
        meta: `decision expires · ${approval.risk} risk`,
      });
    }
  }
  if (wanted("meeting")) {
    for (const note of world.notes) {
      if (note.kind !== "meeting") continue;
      if (projectId !== "all" && note.projectId && note.projectId !== projectId) continue;
      items.push({
        kind: "meeting",
        id: note.id,
        date: note.at,
        title: note.title,
        meta: `${note.personIds.length} people · meeting note`,
        href: `/knowledge/notes?focus=${note.id}`,
      });
    }
  }

  const fromTime = from?.getTime();
  const toTime = to?.getTime();
  return items
    .filter((item) => {
      const time = new Date(item.date).getTime();
      if (Number.isNaN(time)) return false;
      if (fromTime !== undefined && time < fromTime) return false;
      if (toTime !== undefined && time > toTime) return false;
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

/**
 * `strip` groups items into day columns (Today's next-7-days read); `list`
 * is the vertical day agenda the Calendar uses. Both call `onSelect` — the
 * page decides whether that opens Peek or navigates (meeting notes).
 */
export const UnifiedTimeline = ({
  items,
  variant = "list",
  onSelect,
  emptyText = "Nothing dated in this window.",
  className,
}: {
  items: TimelineItem[];
  variant?: "strip" | "list";
  onSelect: (item: TimelineItem) => void;
  emptyText?: string;
  className?: string;
}) => {
  const days = useMemo(() => {
    const groups: { key: string; date: Date; items: TimelineItem[] }[] = [];
    for (const item of items) {
      const date = new Date(item.date);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, date)) {
        last.items.push(item);
      } else {
        groups.push({ key: format(date, "yyyy-MM-dd"), date, items: [item] });
      }
    }
    return groups;
  }, [items]);

  if (!items.length) {
    return (
      <p className={cn("rounded-lg border border-dashed border-border/70 px-3 py-3 text-[11.5px] text-muted-foreground", className)}>
        {emptyText}
      </p>
    );
  }

  if (variant === "strip") {
    return (
      <div className={cn("flex gap-2 overflow-x-auto pb-1", className)}>
        {days.map((day) => (
          <div
            key={day.key}
            className="min-w-[150px] flex-1 rounded-lg border border-border/60 bg-surface-1/50 p-2"
          >
            <p className="eyebrow flex items-baseline justify-between">
              {format(day.date, "EEE")}
              <span className="num text-[10px] normal-case tracking-normal text-muted-foreground">
                {shortDate(day.date.toISOString())}
              </span>
            </p>
            <div className="mt-1.5 space-y-1">
              {day.items.slice(0, 4).map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onClick={() => onSelect(item)}
                  title={`${item.title} · ${item.meta}`}
                  className="focus-ring flex w-full items-center gap-1.5 rounded-md border border-border/50 bg-background/40 px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-surface-2/60"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", timelineTone(item))} />
                  <span className="truncate text-[10.5px] font-medium">{item.title}</span>
                </button>
              ))}
              {day.items.length > 4 ? (
                <p className="num px-1 text-[9.5px] text-muted-foreground/70">
                  +{day.items.length - 4} more
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {items.map((item) => (
        <button
          key={`${item.kind}-${item.id}`}
          type="button"
          onClick={() => onSelect(item)}
          className="focus-ring group flex w-full items-start gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface-2/50"
        >
          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", timelineTone(item))} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium">{item.title}</span>
            <span className="block truncate text-[10px] capitalize text-muted-foreground">
              {item.kind} · {item.meta}
            </span>
          </span>
          <span className="num shrink-0 text-[10px] text-muted-foreground">
            {shortDate(item.date)}
          </span>
        </button>
      ))}
    </div>
  );
};
