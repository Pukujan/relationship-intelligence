import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentById, relativeTime, shortDate } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { MissionChain, Pill, ScopeBanner } from "@/components/work";
import { UnifiedTimeline, collectTimelineItems } from "@/components/crm/UnifiedTimeline";
import { Button } from "@/components/ui/button";

type CalendarItem =
  | {
      kind: "event";
      id: string;
      date: string;
      title: string;
      meta: string;
      href: string;
    }
  | {
      kind: "mission";
      id: string;
      date: string;
      title: string;
      meta: string;
      href: string;
      status: string;
    }
  | {
      kind: "meeting";
      id: string;
      date: string;
      title: string;
      meta: string;
      href: string;
    };

const itemTone: Record<CalendarItem["kind"], string> = {
  event: "bg-primary",
  mission: "bg-run",
  meeting: "bg-agent-indigo",
};

const CalendarPage = () => {
  const {
    world,
    status,
    error,
    reload,
    activeProject,
    activeProjectId,
    setActiveProject,
  } = useData();
  const { openCopilot } = useOrchestrator();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<"month" | "week">("month");
  const [selected, setSelected] = useState<Date>(new Date());

  const items = useMemo<CalendarItem[]>(() => {
    if (!world) return [];
    const events: CalendarItem[] = world.events.map((event) => ({
      kind: "event",
      id: event.id,
      date: event.date,
      title: event.name,
      meta: `${event.location} · ${event.attendeeIds.length} people`,
      href: `/events?focus=${event.id}`,
    }));
    const missions: CalendarItem[] = world.missions
      .filter(
        (mission) =>
          activeProjectId === "all" || mission.projectId === activeProjectId,
      )
      .map((mission) => {
        const project = world.projects.find((item) => item.id === mission.projectId);
        return {
          kind: "mission",
          id: mission.id,
          date: mission.due,
          title: mission.name,
          meta: `${project?.name ?? "Project"} · ${mission.status}`,
          href: `/missions/${mission.id}`,
          status: mission.status,
        };
      });
    const meetings: CalendarItem[] = world.notes
      .filter((note) => note.kind === "meeting")
      .map((note) => ({
        kind: "meeting",
        id: note.id,
        date: note.at,
        title: note.title,
        meta: `${note.personIds.length} people · meeting note`,
        href: `/knowledge/notes?focus=${note.id}`,
      }));
    return [...events, ...missions, ...meetings].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [world, activeProjectId]);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="The calendar didn't load"
        description={error ?? "Something went wrong reading the calendar."}
        onRetry={reload}
      />
    );
  }

  const itemsOn = (day: Date) =>
    items.filter((item) => isSameDay(new Date(item.date), day));

  const days =
    view === "month"
      ? eachDayOfInterval({
          start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
          end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
        })
      : eachDayOfInterval({
          start: startOfWeek(selected, { weekStartsOn: 1 }),
          end: endOfWeek(selected, { weekStartsOn: 1 }),
        });

  const selectedItems = itemsOn(selected);
  const monthItems = items.filter((item) => isSameMonth(new Date(item.date), cursor));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Time"
        title="Calendar"
        description="Events, meetings, and dated missions on one surface. Missions follow the project switcher; the relationship graph stays global."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("Prep me for the next event")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
      <UnifiedTimeline
        className="mb-4"
        items={collectTimelineItems(world, {
          projectId: activeProjectId,
          kinds: ["mission", "objective", "event", "approval"],
          from: startOfMonth(cursor),
          to: endOfMonth(cursor),
        })}
        variant="strip"
        emptyText="Nothing dated in this month for the current scope."
        onSelect={(item) => { if (item.href) navigate(item.href); }}
      />
            Prep the next one
          </Button>
        }
      />

      {activeProject ? (
        <ScopeBanner
          label={activeProject.name}
          onClear={() => setActiveProject("all")}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg"
            aria-label={view === "month" ? "Previous month" : "Previous week"}
            onClick={() => {
              if (view === "month") setCursor((current) => subMonths(current, 1));
              else setSelected((current) => subDays(current, 7));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg"
            aria-label={view === "month" ? "Next month" : "Next week"}
            onClick={() => {
              if (view === "month") setCursor((current) => addMonths(current, 1));
              else setSelected((current) => addDays(current, 7));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[13px] font-medium">
          {view === "month"
            ? format(cursor, "MMMM yyyy")
            : `${format(days[0], "d MMM")} – ${format(days[days.length - 1], "d MMM yyyy")}`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg text-[11.5px]"
          onClick={() => {
            setCursor(startOfMonth(new Date()));
            setSelected(new Date());
          }}
        >
          Today
        </Button>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface-1 p-0.5">
          {(["month", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors",
                view === option
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.72fr)]">
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border/60 bg-surface-1/40">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div
                key={day}
                className="px-1.5 py-1.5 text-center text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayItems = itemsOn(day);
              const isCurrentMonth = isSameMonth(day, cursor);
              const isSelected = isSameDay(day, selected);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelected(day)}
                  aria-pressed={isSelected}
                  className={cn(
                    "focus-ring relative flex flex-col items-start gap-1 border-b border-r border-border/50 p-1.5 text-left transition-colors last:border-r-0",
                    view === "month" ? "min-h-[76px]" : "min-h-[150px]",
                    isSelected
                      ? "bg-primary/[0.07]"
                      : "hover:bg-surface-1/70",
                    !isCurrentMonth && view === "month" && "opacity-45",
                  )}
                >
                  <span
                    className={cn(
                      "num flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10.5px]",
                      isToday(day)
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <span className="w-full space-y-0.5">
                    {dayItems.slice(0, view === "month" ? 2 : 5).map((item) => (
                      <span
                        key={`${item.kind}-${item.id}`}
                        className="flex items-center gap-1 rounded px-0.5 text-[9.5px] leading-4 text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "h-1 w-1 shrink-0 rounded-full",
                            item.kind === "mission" &&
                              item.status === "blocked" &&
                              "bg-warn",
                            item.kind === "mission" &&
                              item.status !== "blocked" &&
                              "bg-run",
                            item.kind !== "mission" && itemTone[item.kind],
                          )}
                        />
                        <span className="truncate">{item.title}</span>
                      </span>
                    ))}
                    {dayItems.length > (view === "month" ? 2 : 5) ? (
                      <span className="num block px-0.5 text-[9px] text-muted-foreground/70">
                        +{dayItems.length - (view === "month" ? 2 : 5)} more
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 bg-surface-1/30 px-3 py-2 text-[10px] text-muted-foreground">
            {[
              ["Event", "bg-primary"],
              ["Mission", "bg-run"],
              ["Mission needs you", "bg-warn"],
              ["Meeting note", "bg-agent-indigo"],
            ].map(([label, tone]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", tone)} />
                {label}
              </span>
            ))}
            <span className="ml-auto">
              {monthItems.length} items this month
            </span>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="panel p-3.5">
            <SectionHeader
              title={format(selected, "EEEE d MMMM")}
              count={selectedItems.length}
            />
            {selectedItems.length === 0 ? (
              <EmptyState
                className="mt-2.5"
                icon={CalendarDays}
                title="Nothing on this day"
                description="No events, meetings, or missions land here. Pick another day, or ask the copilot to plan something."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => openCopilot("What's due today across the team?")}
                  >
                    What's due today?
                  </Button>
                }
              />
            ) : (
              <div className="mt-2 space-y-1.5">
                {selectedItems.map((item) => (
                  <Link
                    key={`${item.kind}-${item.id}`}
                    to={item.href}
                    className="focus-ring group flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 transition-colors hover:border-border hover:bg-surface-2/50"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        item.kind === "mission" && item.status === "blocked"
                          ? "bg-warn"
                          : itemTone[item.kind],
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium">
                        {item.title}
                      </span>
                      <span className="block truncate text-[10px] capitalize text-muted-foreground">
                        {item.kind} · {item.meta}
                      </span>
                    </span>
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="panel p-3.5">
            <SectionHeader title="Coming up" />
            <div className="mt-2 space-y-2">
              {items
                .filter((item) => new Date(item.date).getTime() >= Date.now())
                .slice(0, 4)
                .map((item) => {
                  const mission =
                    item.kind === "mission"
                      ? world.missions.find((entry) => entry.id === item.id)
                      : undefined;
                  const agent = mission ? agentById(world, mission.agentIds[0]) : undefined;
                  return (
                    <Link
                      key={`${item.kind}-${item.id}`}
                      to={item.href}
                      className="focus-ring block rounded-lg px-1 py-1 transition-colors hover:bg-surface-2/50"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="num text-[10px] text-muted-foreground">
                          {shortDate(item.date)}
                        </span>
                        <span className="truncate text-[11.5px] font-medium">
                          {item.title}
                        </span>
                      </span>
                      {mission ? (
                        <MissionChain
                          world={world}
                          mission={mission}
                          className="mt-0.5"
                          linked={false}
                        />
                      ) : (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {item.kind === "event" ? "Event" : "Meeting note"} ·{" "}
                          {relativeTime(item.date)}
                          {agent ? ` · ${agent.name}` : ""}
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface-1/40 p-3.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
              <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />
              Meetings become notes
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Every meeting note is linked to the people and project it belongs
              to, so the calendar and the graph never disagree.
            </p>
            <Link
              to="/knowledge/notes"
              className="focus-ring mt-2 inline-flex items-center gap-1 rounded text-[11px] text-primary transition-colors hover:text-primary/80"
            >
              Open meeting notes
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
              {world.events.length} events
            </Pill>
            <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
              {world.missions.length} missions
            </Pill>
            <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
              {world.notes.filter((note) => note.kind === "meeting").length}{" "}
              meeting notes
            </Pill>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CalendarPage;
