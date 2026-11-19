import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentById, eventAttendees, longDate } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  PageHeader,
  PersonAvatar,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import type { RelationshipEvent } from "@/data/types";

const typeLabel: Record<RelationshipEvent["type"], string> = {
  conference: "Conference",
  dinner: "Dinner",
  community: "Community",
  demo: "Demo",
  mixer: "Mixer",
};

const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

const Events = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const timer = setTimeout(() => {
      document
        .getElementById(`event-${focusId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(timer);
  }, [focusId]);

  const calendar = useMemo(() => {
    const first = startOfMonth(month);
    const offset = (getDay(first) + 6) % 7;
    const total = getDaysInMonth(month);
    const cells: (Date | null)[] = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= total; day += 1) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), day));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-9 w-56 rounded bg-surface-2" />
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="h-72 rounded-xl border border-border/60 bg-surface-1" />
          <div className="space-y-2">
            <div className="h-24 rounded-xl border border-border/60 bg-surface-1" />
            <div className="h-24 rounded-xl border border-border/60 bg-surface-1" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="The calendar didn't load"
          description={error ?? "Something went wrong reading the events."}
          action={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const sorted = world.events
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const upcoming = sorted.filter((event) => event.status === "upcoming");
  const past = sorted
    .filter((event) => event.status === "past")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const dayEvents = selectedDate
    ? sorted.filter((event) => isSameDay(new Date(event.date), selectedDate))
    : [];
  const invited = new Set(world.events.flatMap((event) => event.attendeeIds)).size;

  const renderEvent = (event: RelationshipEvent) => {
    const agent = agentById(world, event.agentId);
    const attendees = eventAttendees(world, event);
    const focused = focusId === event.id;
    return (
      <article
        key={event.id}
        id={`event-${event.id}`}
        className={cn(
          "panel p-4 transition-colors",
          focused && "border-primary/35 ring-1 ring-primary/20",
        )}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-border/70 bg-surface-2">
            <span className="num text-[15px] font-semibold leading-none">
              {format(new Date(event.date), "d")}
            </span>
            <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              {format(new Date(event.date), "MMM")}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {typeLabel[event.type]}
              </span>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium",
                  event.status === "upcoming"
                    ? "border-run/25 bg-run/10 text-run"
                    : "border-border bg-surface-2 text-muted-foreground",
                )}
              >
                {event.status}
              </span>
              {agent ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <AgentAvatar
                    agent={agent}
                    size="sm"
                    className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]"
                  />
                  {agent.name}
                </span>
              ) : null}
            </div>
            <h3 className="mt-1.5 text-[14.5px] font-semibold leading-snug">
              {event.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {event.location}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(event.date), "EEE d MMM · HH:mm")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {attendees.length} attending
              </span>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-foreground/80">
              <span className="text-muted-foreground">Goal — </span>
              {event.goal}
            </p>
            {event.outcome ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/70">Outcome — </span>
                {event.outcome}
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {attendees.slice(0, 4).map((person) => (
                  <Link
                    key={person.id}
                    to={`/people/${person.id}`}
                    className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] transition-colors hover:text-foreground"
                  >
                    <PersonAvatar name={person.name} size="xs" />
                    {person.name.split(" ")[0]}
                  </Link>
                ))}
                {attendees.length > 4 ? (
                  <span className="text-[10px] text-muted-foreground">
                    +{attendees.length - 4}
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-md px-2 text-[11px]"
                onClick={() => openCopilot(`Prep me for ${event.name}`)}
              >
                <Sparkles className="h-3 w-3 text-primary" />
                Prep with copilot
              </Button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Calendar"
        title="Events"
        description="Where the relationships actually move. Your agents prepare the briefs, track attendance, and turn each room into follow-ups."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() =>
              openCopilot(
                upcoming[0]
                  ? `Prep me for ${upcoming[0].name}`
                  : "What events are coming up?",
              )
            }
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Prep the next event
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="panel p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold">
                  {format(month, "MMMM yyyy")}
                </p>
                <p className="text-[10.5px] text-muted-foreground">
                  {upcoming.length} upcoming · {invited} people invited
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth((current) => subMonths(current, 1))}
                  className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-surface-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonth((current) => addMonths(current, 1))}
                  className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-surface-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center">
              {weekdays.map((day, index) => (
                <span
                  key={`${day}-${index}`}
                  className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {day}
                </span>
              ))}
              {calendar.map((day, index) => {
                if (!day) return <span key={`empty-${index}`} />;
                const dayEvents = sorted.filter((event) =>
                  isSameDay(new Date(event.date), day),
                );
                const selected = selectedDate && isSameDay(day, selectedDate);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() =>
                      setSelectedDate(selected ? null : day)
                    }
                    className={cn(
                      "focus-ring relative flex h-9 flex-col items-center justify-center rounded-md text-[11.5px] transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : isToday(day)
                          ? "border border-primary/40 text-foreground"
                          : isSameMonth(day, month)
                            ? "text-foreground/80 hover:bg-surface-2"
                            : "text-muted-foreground/40",
                    )}
                    aria-label={`${format(day, "d MMMM")}${
                      dayEvents.length
                        ? `, ${dayEvents.length} events`
                        : ", no events"
                    }`}
                    aria-pressed={Boolean(selected)}
                  >
                    {format(day, "d")}
                    {dayEvents.length ? (
                      <span className="mt-0.5 flex items-center gap-[2px]">
                        {dayEvents.slice(0, 2).map((event) => (
                          <span
                            key={event.id}
                            className={cn(
                              "h-1 w-1 rounded-full",
                              selected
                                ? "bg-primary-foreground"
                                : event.status === "upcoming"
                                  ? "bg-primary"
                                  : "bg-idle",
                            )}
                          />
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5">
              <button
                type="button"
                onClick={() => {
                  setMonth(startOfMonth(new Date()));
                  setSelectedDate(null);
                }}
                className="focus-ring rounded px-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Today
              </button>
              {selectedDate ? (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="focus-ring rounded px-1 text-[10.5px] text-primary"
                >
                  Show all events
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground/70">
                  Pick a day to focus
                </span>
              )}
            </div>
          </div>

          {selectedDate ? (
            <div className="panel p-3.5">
              <p className="eyebrow">{format(selectedDate, "EEEE d MMMM")}</p>
              <div className="mt-2 space-y-2">
                {dayEvents.length === 0 ? (
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Nothing scheduled. A quiet day is a good day for follow-ups —
                    ask the copilot who has gone cold.
                  </p>
                ) : (
                  dayEvents.map((event) => (
                    <Link
                      key={event.id}
                      to={`/events?focus=${event.id}`}
                      className="focus-ring block rounded-lg border border-border/60 bg-background/40 p-2.5 text-[12px] transition-colors hover:border-border"
                    >
                      <span className="font-medium">{event.name}</span>
                      <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                        {format(new Date(event.date), "HH:mm")} · {event.location}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border/60 bg-surface-1/50 p-3.5">
            <p className="text-[11.5px] font-medium">How events are used</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Every event becomes a brief: who is in the room, what each person
              needs, and which goal matters. Afterward the agents log
              conversations and open follow-up approvals.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {selectedDate ? (
            <section className="space-y-2">
              <SectionHeader
                title={format(selectedDate, "EEEE d MMMM")}
                count={dayEvents.length}
                action={
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="focus-ring rounded text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    All events
                  </button>
                }
              />
              {dayEvents.length ? (
                dayEvents.map(renderEvent)
              ) : (
                <div className="panel p-5">
                  <EmptyState
                    icon={CalendarDays}
                    title="Nothing on this day"
                    description="No events scheduled. Use the space to warm a cold thread instead."
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() =>
                          openCopilot("Who should I follow up with this week?")
                        }
                      >
                        Find a follow-up
                      </Button>
                    }
                  />
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="space-y-2">
                <SectionHeader title="Upcoming" count={upcoming.length} />
                {upcoming.length ? (
                  upcoming.map(renderEvent)
                ) : (
                  <div className="panel p-5">
                    <EmptyState
                      icon={CalendarDays}
                      title="No upcoming events"
                      description="The calendar is clear. Ask the copilot to plan the next room worth being in."
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg"
                          onClick={() =>
                            openCopilot("What events are coming up?")
                          }
                        >
                          Plan with the copilot
                        </Button>
                      }
                    />
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <SectionHeader title="Past" count={past.length} />
                {past.map(renderEvent)}
              </section>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-4 py-3">
        <p className="text-[11.5px] text-muted-foreground">
          Next up:{" "}
          <span className="text-foreground/90">
            {upcoming[0]
              ? `${upcoming[0].name} · ${longDate(upcoming[0].date)}`
              : "nothing scheduled"}
          </span>
        </p>
        <Link
          to="/activity"
          className="focus-ring inline-flex items-center gap-1 rounded text-[11.5px] text-primary transition-opacity hover:opacity-80"
        >
          See how events turn into follow-ups
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default Events;
