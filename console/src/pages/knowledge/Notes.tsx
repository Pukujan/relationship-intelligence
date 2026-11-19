import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  NotebookPen,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  projectById,
  relativeTime,
  shortDate,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  PersonAvatar,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Notes = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [filter, setFilter] = useState<"all" | "meeting" | "note">("all");
  const [query, setQuery] = useState("");

  const notes = useMemo(() => {
    if (!world) return [];
    const text = query.trim().toLowerCase();
    return world.notes
      .filter((note) => filter === "all" || note.kind === filter)
      .filter(
        (note) =>
          !text ||
          `${note.title} ${note.body}`.toLowerCase().includes(text),
      )
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [world, filter, query]);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Notes didn't load"
        description={error ?? "Something went wrong reading the notes."}
        onRetry={reload}
      />
    );
  }

  const selected =
    notes.find((note) => note.id === focusId) ?? notes[0] ?? undefined;
  const selectedProject = selected ? projectById(world, selected.projectId) : undefined;
  const selectedEvent = selected?.eventId
    ? world.events.find((event) => event.id === selected.eventId)
    : undefined;
  const selectedAgent = selected ? agentById(world, selected.agentId) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Knowledge"
        title="Notes & meeting notes"
        description="What was said, who was in the room, and which project it moved. Meeting notes stay attached to the people they mention."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("Summarise my meeting notes this week")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Summarise the week
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface-1 p-0.5">
          {(
            [
              ["all", "All notes"],
              ["meeting", "Meeting notes"],
              ["note", "Notes"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                filter === id
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="num ml-1 text-[10px] text-muted-foreground">
                {id === "all"
                  ? world.notes.length
                  : world.notes.filter((note) => note.kind === id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="h-9 rounded-lg border-border/70 bg-surface-1 pl-8 text-[12px]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={NotebookPen}
            title="No notes match this view"
            description="Try another filter or clear the search. Meeting notes are written from calls and events."
            action={
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Reset
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="space-y-1.5">
            {notes.map((note) => {
              const project = projectById(world, note.projectId);
              const isActive = selected?.id === note.id;
              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() =>
                    setSearchParams({ focus: note.id }, { replace: true })
                  }
                  aria-pressed={isActive}
                  className={cn(
                    "focus-ring block w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "border-primary/35 bg-surface-2/70"
                      : "border-border/60 bg-card/50 hover:border-border hover:bg-surface-2/30",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill
                      className={cn(
                        note.kind === "meeting"
                          ? "border-agent-indigo/30 bg-agent-indigo/10 text-agent-indigo"
                          : "border-border bg-surface-2 text-muted-foreground",
                      )}
                    >
                      {note.kind === "meeting" ? "Meeting" : "Note"}
                    </Pill>
                    <span className="num text-[10px] text-muted-foreground">
                      {shortDate(note.at)}
                    </span>
                    {project ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        · {project.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-[12.5px] font-medium">
                    {note.title}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">
                    {note.body}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    {note.personIds.slice(0, 4).map((id) => {
                      const person = world.people.find((item) => item.id === id);
                      if (!person) return null;
                      return (
                        <PersonAvatar
                          key={id}
                          name={person.name}
                          size="xs"
                          className="ring-2 ring-card"
                        />
                      );
                    })}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {relativeTime(note.at)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <article className="panel h-fit p-4">
              <SectionHeader
                title={selected.kind === "meeting" ? "Meeting note" : "Note"}
                action={
                  selectedAgent ? (
                    <Link
                      to={`/agents/${selectedAgent.id}`}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:text-primary"
                    >
                      <AgentAvatar
                        agent={selectedAgent}
                        size="sm"
                        className="[&>div]:h-4 [&>div]:w-4 [&>div]:rounded-[5px]"
                      />
                      {selectedAgent.name}
                    </Link>
                  ) : undefined
                }
              />
              <h2 className="mt-2 text-[16px] font-semibold leading-snug">
                {selected.title}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                <span>{relativeTime(selected.at)}</span>
                {selectedEvent ? (
                  <>
                    <span className="text-border">·</span>
                    <Link
                      to={`/events?focus=${selectedEvent.id}`}
                      className="focus-ring inline-flex items-center gap-1 rounded transition-colors hover:text-foreground"
                    >
                      <CalendarDays className="h-3 w-3" />
                      {selectedEvent.name}
                    </Link>
                  </>
                ) : null}
                {selectedProject ? (
                  <>
                    <span className="text-border">·</span>
                    <Link
                      to={`/projects/${selectedProject.id}`}
                      className="focus-ring rounded transition-colors hover:text-foreground"
                    >
                      {selectedProject.name}
                    </Link>
                  </>
                ) : null}
              </p>

              <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-foreground/85">
                {selected.body}
              </p>

              <div className="mt-4 border-t border-border/60 pt-3">
                <p className="eyebrow mb-1.5 flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  People mentioned
                </p>
                <div className="space-y-1">
                  {selected.personIds.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No people attached to this note.
                    </p>
                  ) : (
                    selected.personIds.map((id) => {
                      const person = world.people.find((item) => item.id === id);
                      if (!person) return null;
                      const company = world.companies.find(
                        (item) => item.id === person.companyId,
                      );
                      return (
                        <Link
                          key={id}
                          to={`/people/${person.id}`}
                          className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
                        >
                          <PersonAvatar name={person.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11.5px] font-medium">
                              {person.name}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {person.role} · {company?.name}
                            </span>
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default Notes;
