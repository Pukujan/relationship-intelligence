import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  companyById,
  peopleForCompany,
  peopleForSmartList,
  relativeTime,
  strengthLabel,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  PageHeader,
  PersonAvatar,
  SectionHeader,
  StrengthMeter,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Person } from "@/data/types";

const warmthClass: Record<Person["warmth"], string> = {
  hot: "border-primary/25 bg-primary/10 text-primary",
  warm: "border-warn/25 bg-warn/10 text-warn",
  cool: "border-border bg-surface-2 text-muted-foreground",
  cold: "border-border bg-transparent text-muted-foreground",
};

const People = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "companies" ? "companies" : "people";
  const focusId = searchParams.get("focus");
  const companyFilter = searchParams.get("company");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"strength" | "recent" | "name">("strength");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [smartListId, setSmartListId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  };

  const smartList = useMemo(
    () => world?.smartLists.find((list) => list.id === smartListId),
    [world, smartListId],
  );

  const people = useMemo(() => {
    if (!world) return [];
    const text = query.trim().toLowerCase();
    const smartListIds = smartList
      ? new Set(peopleForSmartList(world, smartList).map((person) => person.id))
      : null;
    return world.people
      .filter((person) => {
        const company = companyById(world, person.companyId);
        const haystack = [
          person.name,
          person.role,
          company?.name ?? "",
          person.location,
          ...person.tags,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!companyFilter || person.companyId === companyFilter) &&
          (!smartListIds || smartListIds.has(person.id)) &&
          (!tagFilter || person.tags.includes(tagFilter)) &&
          (!text || haystack.includes(text))
        );
      })
      .sort((a, b) => {
        if (sort === "strength") return b.strength - a.strength;
        if (sort === "name") return a.name.localeCompare(b.name);
        return (
          new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime()
        );
      });
  }, [world, query, companyFilter, sort, smartList, tagFilter]);

  useEffect(() => {
    if (tab !== "companies" || !focusId) return;
    document
      .getElementById(`company-${focusId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [tab, focusId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      if (event.metaKey || event.ctrlKey || event.altKey || tab !== "people") return;
      if (!people.length) return;
      const index = people.findIndex((person) => person.id === selectedId);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId(people[Math.min(people.length - 1, index + 1)]?.id ?? people[0].id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId(people[Math.max(0, index - 1)]?.id ?? people[0].id);
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        navigate(`/people/${selectedId}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [people, selectedId, tab, navigate]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-9 w-64 rounded bg-surface-2" />
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="h-14 rounded-xl border border-border/60 bg-surface-1"
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="The graph didn't load"
          description={error ?? "Something went wrong reading the people directory."}
          action={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const companies = world.companies;
  const activeCompany = companyFilter
    ? companyById(world, companyFilter)
    : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Relationship graph"
        title="People & companies"
        description="Everyone your agents are working, with sourced facts and relationship strength. Atlas keeps the evidence; Mira keeps the warmth."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("Who are my strongest relationships?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about the graph
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-surface-1 p-0.5">
          <button
            type="button"
            onClick={() => setParam({ tab: null, focus: null })}
            className={cn(
              "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              tab === "people"
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            People
            <span className="num ml-1 text-[10px] text-muted-foreground">
              {world.people.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setParam({ tab: "companies", focus: null })}
            className={cn(
              "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              tab === "companies"
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Companies
            <span className="num ml-1 text-[10px] text-muted-foreground">
              {companies.length}
            </span>
          </button>
        </div>

        {tab === "people" ? (
          <>
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people, roles, companies…"
                className="h-9 rounded-lg border-border/70 bg-surface-1 pl-8 text-[12px]"
                aria-label="Search people"
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
            <div className="flex items-center gap-1">
              {(
                [
                  ["strength", "Strongest"],
                  ["recent", "Recent"],
                  ["name", "A–Z"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSort(id)}
                  className={cn(
                    "focus-ring rounded-full px-2 py-1 text-[11px] font-medium transition-colors",
                    sort === id
                      ? "bg-surface-3 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {companyFilter ? (
          <button
            type="button"
            onClick={() => setParam({ company: null })}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10.5px] font-medium text-primary"
          >
            {activeCompany?.name ?? "Company"}
            <X className="h-3 w-3" />
          </button>
        ) : null}
        {smartList ? (
          <button
            type="button"
            onClick={() => setSmartListId(null)}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10.5px] font-medium text-primary"
          >
            {smartList.name}
            <X className="h-3 w-3" />
          </button>
        ) : null}
        {tagFilter ? (
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-1 text-[10.5px] font-medium text-muted-foreground"
          >
            #{tagFilter}
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {tab === "people" ? (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Tags
          </span>
          {Array.from(
            new Set(world.people.flatMap((person) => person.tags)),
          )
            .slice(0, 10)
            .map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={cn(
                  "focus-ring rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
                  tagFilter === tag
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/60 bg-surface-1 text-muted-foreground hover:text-foreground",
                )}
              >
                #{tag}
              </button>
            ))}
        </div>
      ) : null}

      {tab === "people" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_248px]">
          <div className="space-y-2">
            <div className="hidden items-center gap-3 px-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:flex">
              <span className="w-9" />
              <span className="flex-1">Person</span>
              <span className="w-32">Company</span>
              <span className="w-20">Strength</span>
              <span className="w-24 text-right">Last contact</span>
            </div>
            {people.length === 0 ? (
              <div className="panel p-5">
                <EmptyState
                  icon={Users}
                  title="No one matches that search"
                  description="Try a different name, role, or company — or ask the copilot to find someone in the graph."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => {
                        setQuery("");
                        setSmartListId(null);
                        setTagFilter(null);
                        setParam({ company: null });
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              </div>
            ) : (
              people.map((person) => {
                const company = companyById(world, person.companyId);
                const isSelected = selectedId === person.id;
                return (
                  <Link
                    key={person.id}
                    to={`/people/${person.id}`}
                    onMouseEnter={() => setSelectedId(person.id)}
                    className={cn(
                      "focus-ring group flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors sm:flex-nowrap",
                      isSelected
                        ? "border-primary/30 bg-surface-2/60"
                        : "border-border/60 bg-card/50 hover:border-border hover:bg-surface-2/30",
                    )}
                  >
                    <PersonAvatar name={person.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        {person.name}
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.06em]",
                            warmthClass[person.warmth],
                          )}
                        >
                          {strengthLabel(person)}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {person.role} · {person.location}
                      </p>
                    </div>
                    <div className="hidden w-32 shrink-0 sm:block">
                      <p className="truncate text-[11.5px]">{company?.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {company?.sector}
                      </p>
                    </div>
                    <div className="hidden w-20 shrink-0 sm:block">
                      <StrengthMeter value={person.strength} showLabel />
                    </div>
                    <div className="w-auto shrink-0 text-right sm:w-24">
                      <p className="num text-[10.5px] text-muted-foreground">
                        {relativeTime(person.lastContact)}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {person.claims.length} facts
                      </p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
                  </Link>
                );
              })
            )}
            <p className="px-1 pt-1 text-[10.5px] text-muted-foreground">
              {people.length} of {world.people.length} people · use{" "}
              <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> and{" "}
              <kbd className="kbd">Enter</kbd>
            </p>
          </div>

          <aside className="space-y-3">
            <div className="panel p-3.5">
              <SectionHeader title="Smart lists" count={world.smartLists.length} />
              <div className="mt-2.5 space-y-1">
                {world.smartLists.map((list) => {
                  const members = peopleForSmartList(world, list);
                  const isActive = smartListId === list.id;
                  return (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => setSmartListId(isActive ? null : list.id)}
                      aria-pressed={isActive}
                      className={cn(
                        "focus-ring flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors",
                        isActive
                          ? "bg-surface-2 text-foreground"
                          : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium">
                          {list.name}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {list.description}
                        </span>
                      </span>
                      <span className="num shrink-0 rounded-full border border-border/70 bg-surface-2 px-1.5 text-[10px] leading-4 text-muted-foreground">
                        {members.length}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                Saved filters, not folders — a person can appear in many lists
                and only ever exists once.
              </p>
            </div>

            <div className="panel p-3.5">
              <SectionHeader title="Coverage" />
              <div className="mt-2.5 space-y-2">
                {companies.map((company) => {
                  const members = peopleForCompany(world, company.id);
                  const avg = members.length
                    ? Math.round(
                        members.reduce((sum, person) => sum + person.strength, 0) /
                          members.length,
                      )
                    : 0;
                  return (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() =>
                        setParam({ tab: "people", company: company.id, focus: null })
                      }
                      className="focus-ring flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-2"
                    >
                      <Building2 className="h-3 w-3 text-muted-foreground" />
                      <span className="flex-1 truncate text-[11.5px]">
                        {company.name}
                      </span>
                      <span className="num text-[10.5px] text-muted-foreground">
                        {members.length}
                      </span>
                      <span className="num w-6 text-right text-[10.5px] text-muted-foreground">
                        {avg}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-surface-1/50 p-3.5">
              <p className="text-[11.5px] font-medium">How strength works</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Strength blends reply latency, meeting history, shared events,
                and how many threads you keep alive. It decays when a
                relationship goes quiet.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openCopilot("Which account should I research first, and what should I look for?")}
              className="focus-ring flex w-full items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-left text-[11.5px] text-foreground/90 transition-colors hover:bg-primary/10"
            >
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>Ask Atlas to research an account</span>
            </button>
          </aside>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {companies.map((company) => {
            const members = peopleForCompany(world, company.id);
            const avg = members.length
              ? Math.round(
                  members.reduce((sum, person) => sum + person.strength, 0) /
                    members.length,
                )
              : 0;
            const focused = focusId === company.id;
            return (
              <div
                key={company.id}
                id={`company-${company.id}`}
                className={cn(
                  "panel flex flex-col gap-3 p-4 transition-colors",
                  focused && "border-primary/35 ring-1 ring-primary/20",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[13.5px] font-semibold">{company.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {company.sector} · {company.stage}
                      </p>
                    </div>
                  </div>
                  <span className="num rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {company.headcount} people
                  </span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {company.notes}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {members.slice(0, 5).map((person) => (
                      <Link
                        key={person.id}
                        to={`/people/${person.id}`}
                        className="focus-ring rounded-full"
                        aria-label={person.name}
                      >
                        <PersonAvatar
                          name={person.name}
                          size="sm"
                          className="ring-2 ring-card"
                        />
                      </Link>
                    ))}
                    {members.length > 5 ? (
                      <span className="num text-[10px] text-muted-foreground">
                        +{members.length - 5}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StrengthMeter value={avg} showLabel />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md px-2 text-[11px]"
                      onClick={() =>
                        setParam({ tab: "people", company: company.id, focus: null })
                      }
                    >
                      View
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                  <span>{company.location}</span>
                  <span className="text-border">·</span>
                  <span>{company.domain}</span>
                  <span className="text-border">·</span>
                  <span>{members.length} in the graph</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default People;
