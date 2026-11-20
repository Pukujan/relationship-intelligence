import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Database,
  Globe,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  activityForPerson,
  agentById,
  approvalsForPerson,
  companyById,
  eventsForPerson,
  missionStatusMeta,
  missionsForPerson,
  peopleForCompany,
  personById,
  projectsForPerson,
  relativeTime,
  shortDate,
  strengthLabel,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useApprovalDecision } from "@/hooks/useApprovalDecision";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  EvidenceRow,
  KindBadge,
  PageHeader,
  PersonAvatar,
  RiskBadge,
  SectionHeader,
  StrengthMeter,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import type { ClaimSource } from "@/data/types";

const sourceIcons: Record<ClaimSource["kind"], typeof Mail> = {
  email: Mail,
  call: Phone,
  note: StickyNote,
  web: Globe,
  event: CalendarDays,
  crm: Database,
};

const confidenceClass = {
  high: "border-run/25 bg-run/10 text-run",
  medium: "border-border bg-surface-2 text-muted-foreground",
  low: "border-warn/25 bg-warn/10 text-warn",
} as const;

const PersonProfile = () => {
  const { personId } = useParams();
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const { act, pendingId } = useApprovalDecision();

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-4 w-28 rounded bg-surface-2" />
        <div className="h-28 rounded-xl border border-border/60 bg-surface-1" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-20 rounded-xl border border-border/60 bg-surface-1"
            />
          ))}
        </div>
        <div className="h-56 rounded-xl border border-border/60 bg-surface-1" />
      </div>
    );
  }

  if (status === "error" || !world) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load this person"
          description={error ?? "The workspace failed to load."}
          action={
            <Button size="sm" onClick={reload}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const person = personById(world, personId);
  if (!person) {
    return (
      <div className="panel p-6">
        <EmptyState
          icon={AlertTriangle}
          title="That person isn't in the graph"
          description="They may have been merged into another record. The rest of the directory is intact."
          action={
            <Button size="sm" asChild>
              <Link to="/people">Back to people</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const company = companyById(world, person.companyId);
  const approvals = approvalsForPerson(world, person.id);
  const history = activityForPerson(world, person.id).slice(0, 8);
  const events = eventsForPerson(world, person.id);
  const related = peopleForCompany(world, person.companyId).filter(
    (item) => item.id !== person.id,
  );
  const projects = projectsForPerson(world, person.id);
  const missions = missionsForPerson(world, person.id);
  const sourced = person.claims.filter((claim) => claim.status === "sourced");
  const unverified = person.claims.filter(
    (claim) => claim.status === "unverified",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "People", href: "/people" }}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3 w-3" />
            {company?.name ?? "Independent"} · {company?.sector}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {person.name}
            <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {strengthLabel(person)} · {person.strength}
            </span>
          </span>
        }
        description={person.summary}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => openCopilot(`Research ${person.name} for me`)}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Ask Atlas
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => openCopilot(`Draft a note to ${person.name}`)}
            >
              <Mail className="h-3.5 w-3.5" />
              Draft follow-up
            </Button>
          </>
        }
      />

      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <PersonAvatar name={person.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">
            {person.role}
            {company ? (
              <>
                {" "}
                at{" "}
                <Link
                  to={`/people?tab=companies&focus=${company.id}`}
                  className="focus-ring rounded underline decoration-border underline-offset-4 hover:decoration-foreground/40"
                >
                  {company.name}
                </Link>
              </>
            ) : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {person.location} · {person.timezone}
            </span>
            <span className="text-border">·</span>
            <a
              href={`mailto:${person.email}`}
              className="focus-ring rounded transition-colors hover:text-foreground"
            >
              {person.email}
            </a>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {person.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div>
            <p className="eyebrow">Strength</p>
            <div className="mt-1 flex items-center gap-2">
              <StrengthMeter value={person.strength} />
              <span className="num text-[16px] font-semibold">
                {person.strength}
              </span>
            </div>
          </div>
          <div>
            <p className="eyebrow">Last contact</p>
            <p className="mt-1 text-[12.5px] font-medium">
              {relativeTime(person.lastContact)}
            </p>
          </div>
          <div>
            <p className="eyebrow">Sourced facts</p>
            <p className="num mt-1 text-[16px] font-semibold">
              {sourced.length}
              <span className="text-[11px] font-normal text-muted-foreground">
                /{person.claims.length}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <section className="panel p-4">
            <SectionHeader
              title="Current facts"
              count={person.claims.length}
              action={
                unverified.length ? (
                  <span className="text-[10.5px] text-warn">
                    {unverified.length} needs a source
                  </span>
                ) : (
                  <span className="text-[10.5px] text-muted-foreground">
                    all sourced
                  </span>
                )
              }
            />
            <div className="mt-3 space-y-2">
              {person.claims.map((claim) => {
                const Icon = sourceIcons[claim.source.kind];
                const isUnverified = claim.status === "unverified";
                return (
                  <div
                    key={claim.id}
                    className={cn(
                      "rounded-lg border p-3",
                      isUnverified
                        ? "border-dashed border-warn/35 bg-warn/[0.04]"
                        : "border-border/60 bg-background/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12.5px] leading-relaxed text-foreground/90">
                        {claim.text}
                      </p>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium capitalize",
                          confidenceClass[claim.confidence],
                        )}
                      >
                        {claim.confidence}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      <span className="font-medium text-foreground/70">
                        {claim.source.label}
                      </span>
                      <span className="text-border">·</span>
                      <span>{shortDate(claim.source.date)}</span>
                      {isUnverified ? (
                        <span className="ml-1 rounded border border-warn/30 bg-warn/10 px-1 py-px text-[9px] font-medium text-warn">
                          not canonical
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/80">
              Atlas attaches a source to every fact. Unverified claims are held
              out of anything that sends or publishes.
            </p>
          </section>

          <section className="panel p-4">
            <SectionHeader
              title="Interaction history"
              count={history.length}
              action={
                <Link
                  to="/activity"
                  className="focus-ring rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Full timeline
                </Link>
              }
            />
            {history.length === 0 ? (
              <EmptyState
                className="mt-3"
                icon={CalendarDays}
                title="No interactions logged"
                description="Nothing has touched this relationship yet. A first note is the fastest way to start the history."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => openCopilot(`Draft a note to ${person.name}`)}
                  >
                    Draft the first note
                  </Button>
                }
              />
            ) : (
              <ol className="mt-3 space-y-3">
                {history.map((entry) => {
                  const agent = agentById(world, entry.agentId);
                  return (
                    <li key={entry.id} className="flex gap-2.5">
                      {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12px] font-medium leading-snug">
                            {entry.title}
                          </p>
                          <span className="num shrink-0 text-[10px] text-muted-foreground/70">
                            {relativeTime(entry.at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                          {entry.detail}
                        </p>
                        {entry.evidence?.length ? (
                          <EvidenceRow
                            evidence={entry.evidence}
                            limit={1}
                            className="mt-1.5"
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="panel p-4">
            <SectionHeader
              title="Open decisions"
              count={approvals.length}
              action={
                <Link
                  to="/approvals"
                  className="focus-ring rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Inbox
                </Link>
              }
            />
            {approvals.length === 0 ? (
              <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
                <p className="text-[12px] font-medium">Nothing waiting</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  No outbound action is pending for {person.name.split(" ")[0]}.
                  Mira will hold anything new here first.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 rounded-md px-2 text-[11px]"
                  onClick={() => openCopilot(`Draft a note to ${person.name}`)}
                >
                  <Sparkles className="h-3 w-3 text-primary" />
                  Draft the next touch
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-lg border border-border/70 bg-background/40 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={approval.kind} />
                      <RiskBadge risk={approval.risk} />
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {relativeTime(approval.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] font-medium leading-snug">
                      {approval.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {approval.reason}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 flex-1 rounded-md text-[11px]"
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "approved")}
                      >
                        <Check className="h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 rounded-md text-[11px]"
                        disabled={pendingId === approval.id}
                        onClick={() => act(approval.id, "declined")}
                      >
                        <X className="h-3 w-3" />
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-4">
            <SectionHeader title="Events" count={events.length} />
            <div className="mt-2.5 space-y-2">
              {events.map((event) => (
                <Link
                  key={event.id}
                  to={`/events?focus=${event.id}`}
                  className="focus-ring group flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 p-2.5 transition-colors hover:border-border"
                >
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-border/70 bg-surface-2">
                    <span className="num text-[11px] font-semibold leading-none">
                      {new Date(event.date).getDate()}
                    </span>
                    <span className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                      {new Date(event.date).toLocaleString("en-US", {
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">
                      {event.name}
                    </p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {event.location} ·{" "}
                      {event.status === "past" ? "past" : "upcoming"}
                    </p>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
                </Link>
              ))}
              {events.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No events with {person.name.split(" ")[0]} yet.
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <SectionHeader
              title="Projects & missions"
              count={projects.length}
              action={
                <Link
                  to="/projects"
                  className="focus-ring rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  All projects
                </Link>
              }
            />
            {projects.length === 0 ? (
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                No project references {person.name.split(" ")[0]} yet. Projects
                and missions reference people — they never copy them.
              </p>
            ) : (
              <div className="mt-2.5 space-y-2">
                {projects.map((project) => {
                  const projectMissions = missions.filter(
                    (mission) => mission.projectId === project.id,
                  );
                  return (
                    <div key={project.id}>
                      <Link
                        to={`/projects/${project.id}`}
                        className="focus-ring inline-flex items-center gap-1 rounded text-[12px] font-medium transition-colors hover:text-primary"
                      >
                        {project.name}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                      <div className="mt-1 space-y-1">
                        {projectMissions.map((mission) => {
                          const meta = missionStatusMeta[mission.status];
                          return (
                            <Link
                              key={mission.id}
                              to={`/missions/${mission.id}`}
                              className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  mission.status === "running" && "bg-run",
                                  mission.status === "blocked" && "bg-warn",
                                  mission.status === "queued" && "bg-idle",
                                  mission.status === "done" && "bg-primary",
                                )}
                              />
                              <span className="flex-1 truncate">{mission.name}</span>
                              <span
                                className={cn(
                                  "rounded-full border px-1.5 py-px text-[9px]",
                                  meta.className,
                                )}
                              >
                                {meta.label}
                              </span>
                            </Link>
                          );
                        })}
                        {projectMissions.length === 0 ? (
                          <p className="px-1 text-[10.5px] text-muted-foreground/80">
                            No missions reference them in this project yet.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel p-4">
            <SectionHeader
              title="Who can introduce me"
              count={
                world.people.filter(
                  (candidate) =>
                    candidate.id !== person.id &&
                    ((person.companyId &&
                      candidate.companyId === person.companyId) ||
                      events.some((ev) =>
                        ev.attendeeIds.includes(candidate.id),
                      ) ||
                      projects.some((proj) =>
                        proj.personIds.includes(candidate.id),
                      )),
                ).length
              }
            />
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Strength-weighted 1-hop warm connectors from shared company,
              events, or projects.
            </p>
            <div className="mt-2.5 space-y-1.5">
              {(() => {
                const introPaths = world.people
                  .filter((candidate) => candidate.id !== person.id)
                  .map((candidate) => {
                    const edges: string[] = [];
                    if (
                      person.companyId &&
                      candidate.companyId === person.companyId
                    ) {
                      edges.push(`Same company (${company?.name ?? "org"})`);
                    }
                    const sharedEvent = events.find((ev) =>
                      ev.attendeeIds.includes(candidate.id),
                    );
                    if (sharedEvent) edges.push(`Event: ${sharedEvent.name}`);
                    const sharedProject = projects.find((proj) =>
                      proj.personIds.includes(candidate.id),
                    );
                    if (sharedProject)
                      edges.push(`Project: ${sharedProject.name}`);
                    return { candidate, edges };
                  })
                  .filter((item) => item.edges.length > 0)
                  .sort((a, b) => b.candidate.strength - a.candidate.strength)
                  .slice(0, 4);

                if (introPaths.length === 0) {
                  return (
                    <p className="text-[11px] text-muted-foreground">
                      No sourced 1-hop intro path yet. Ask Atlas to enrich
                      shared events or org history.
                    </p>
                  );
                }
                return introPaths.map(({ candidate, edges }) => (
                  <div
                    key={candidate.id}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
                  >
                    <PersonAvatar name={candidate.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/people/${candidate.id}`}
                        className="block truncate text-[12px] font-medium hover:text-primary"
                      >
                        {candidate.name}
                      </Link>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {edges.join(" · ")}
                      </p>
                    </div>
                    <StrengthMeter value={candidate.strength} />
                  </div>
                ));
              })()}
            </div>
          </section>

          <section className="panel p-4">
            <SectionHeader
              title={`Also at ${company?.name ?? "the company"}`}
              count={related.length}
            />
            <div className="mt-2.5 space-y-1">
              {related.map((other) => (
                <Link
                  key={other.id}
                  to={`/people/${other.id}`}
                  className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <PersonAvatar name={other.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">
                      {other.name}
                    </p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {other.role}
                    </p>
                  </div>
                  <StrengthMeter value={other.strength} />
                </Link>
              ))}
              {related.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  The only person mapped at this company.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PersonProfile;
