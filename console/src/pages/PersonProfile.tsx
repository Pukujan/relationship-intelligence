import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  Briefcase,
  CalendarDays,
  Check,
  ExternalLink,
  GraduationCap,
  Mail,
  MapPin,
  MessageSquareText,
  NotebookPen,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  activityForPerson,
  approvalsForPerson,
  companyById,
  eventsForPerson,
  milestoneStatusMeta,
  milestonesForPerson,
  peopleForCompany,
  personById,
  projectsForPerson,
  relativeTime,
} from "@/data/derive";
import { buildProfile, type EventLogEntry, type ProfileEntry } from "@/lib/profileSections";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useApprovalDecision } from "@/hooks/useApprovalDecision";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  EmptyState,
  KindBadge,
  PersonAvatar,
  RiskBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";

const monthYear = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "";

const dayMonthYear = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** One LinkedIn-style card: a titled panel with an optional header action. */
const ProfileCard = ({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("panel p-5 sm:p-6", className)} aria-label={title}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** What fills an empty section. Never sample data. */
const EmptyLine = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-[12px] leading-relaxed text-muted-foreground">
    {children}
  </p>
);

const SourceLink = ({ entry }: { entry: ProfileEntry }) =>
  entry.sourceUrl ? (
    <a
      href={entry.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="focus-ring inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {entry.sourceLabel ?? hostOf(entry.sourceUrl)}
      <ExternalLink className="h-3 w-3" />
    </a>
  ) : null;

/** A row in Experience, Education, Projects or Credentials. */
const EntryList = ({
  entries,
  icon: Icon,
}: {
  entries: ProfileEntry[];
  icon: typeof Briefcase;
}) => (
  <ul className="divide-y divide-border/60">
    {entries.map((entry) => (
      <li key={entry.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-2 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">{entry.title}</p>
          {entry.subtitle ? (
            <p className="mt-0.5 text-[13px] text-foreground/80">{entry.subtitle}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
            {entry.date ? <span>Recorded {monthYear(entry.date)}</span> : null}
            {entry.date && entry.sourceUrl ? <span aria-hidden>·</span> : null}
            <SourceLink entry={entry} />
          </div>
        </div>
      </li>
    ))}
  </ul>
);

/** Long log text, clamped to four lines with a toggle. */
const ClampText = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div className="mt-1">
      <p
        className={cn(
          "text-[12.5px] leading-relaxed text-foreground/80",
          long && !open && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="focus-ring mt-0.5 rounded text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
};

const eventLogIcon: Record<EventLogEntry["kind"], typeof CalendarDays> = {
  event: CalendarDays,
  met: UserRound,
  log: MessageSquareText,
  note: NotebookPen,
};

const UnverifiedTag = () => (
  <span className="rounded border border-warn/30 bg-warn/10 px-1 py-px text-[9.5px] font-medium text-warn">
    your note · unverified
  </span>
);

const PersonProfile = () => {
  const { personId } = useParams();
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const { act, pendingId } = useApprovalDecision();

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1128px] space-y-4">
        <div className="h-72 rounded-xl border border-border/60 bg-surface-1" />
        <div className="h-40 rounded-xl border border-border/60 bg-surface-1" />
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
  const events = eventsForPerson(world, person.id);
  const profile = buildProfile({
    name: person.name,
    role: person.role,
    companyName: company?.name,
    claims: person.claims,
    events,
  });
  const approvals = approvalsForPerson(world, person.id);
  const activity = activityForPerson(world, person.id).slice(0, 6);
  const related = person.companyId
    ? peopleForCompany(world, person.companyId).filter((item) => item.id !== person.id)
    : [];
  const projects = projectsForPerson(world, person.id);
  const milestones = milestonesForPerson(world, person.id);
  const firstName = person.name.split(" ")[0];
  const email = person.email || profile.email;
  const lastTouch =
    Date.parse(person.lastContact) > 0 ? relativeTime(person.lastContact) : "No contact logged";

  const introPaths = world.people
    .filter((candidate) => candidate.id !== person.id)
    .map((candidate) => {
      const edges: string[] = [];
      if (person.companyId && candidate.companyId === person.companyId) {
        edges.push(`Same company (${company?.name ?? "org"})`);
      }
      const sharedEvent = events.find((ev) => ev.attendeeIds.includes(candidate.id));
      if (sharedEvent) edges.push(`Event: ${sharedEvent.name}`);
      const sharedProject = projects.find((proj) => proj.personIds.includes(candidate.id));
      if (sharedProject) edges.push(`Project: ${sharedProject.name}`);
      return { candidate, edges };
    })
    .filter((item) => item.edges.length > 0)
    .sort((a, b) => b.candidate.strength - a.candidate.strength)
    .slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[1128px] space-y-4 pb-8">
      <Link
        to="/people"
        className="focus-ring inline-flex items-center gap-1 rounded text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        ← People
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {/* Top card: banner, avatar, name, headline */}
          <section className="panel overflow-hidden" aria-label={`${person.name} profile`}>
            <div
              className="h-24 sm:h-36"
              aria-hidden
              style={{
                background:
                  "radial-gradient(120% 140% at 12% 0%, hsl(var(--primary) / 0.38), transparent 55%), radial-gradient(110% 130% at 88% 10%, hsl(var(--agent-indigo) / 0.34), transparent 60%), linear-gradient(135deg, hsl(var(--surface-3)), hsl(var(--surface-1)))",
              }}
            />
            <div className="px-5 pb-5 sm:px-6 sm:pb-6">
              {person.avatarUrl ? (
                <a
                  href={person.avatarUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="focus-ring inline-block"
                  aria-label={`Open ${person.name}'s profile photo`}
                >
                  <PersonAvatar
                    name={person.name}
                    imageUrl={person.avatarUrl}
                    size="lg"
                    className="-mt-12 h-24 w-24 border-4 border-card text-2xl sm:-mt-16 sm:h-32 sm:w-32 sm:text-3xl"
                  />
                </a>
              ) : (
                <PersonAvatar
                  name={person.name}
                  size="lg"
                  className="-mt-12 h-24 w-24 border-4 border-card text-2xl sm:-mt-16 sm:h-32 sm:w-32 sm:text-3xl"
                />
              )}
              <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] sm:text-[26px]">
                    {person.name}
                  </h1>
                  <p className="mt-1 text-[14px] leading-snug text-foreground/90 sm:text-[15px]">
                    {profile.headline || (
                      <span className="text-muted-foreground">No headline collected yet</span>
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
                    {person.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {person.location}
                      </span>
                    ) : null}
                    {person.location && (email || profile.linkedinUrl) ? (
                      <span aria-hidden>·</span>
                    ) : null}
                    {email ? (
                      <a
                        href={`mailto:${email}`}
                        className="focus-ring inline-flex items-center gap-1 rounded font-medium text-primary hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Contact info
                      </a>
                    ) : null}
                    {profile.linkedinUrl ? (
                      <a
                        href={profile.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring inline-flex items-center gap-1 rounded font-medium text-primary hover:underline"
                      >
                        LinkedIn profile
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    <span className="font-medium capitalize text-foreground/80">{person.warmth}</span>
                    {" · "}last contact {lastTouch}
                  </p>
                </div>
                {company ? (
                  <Link
                    to={`/people?tab=companies&focus=${company.id}`}
                    className="focus-ring flex shrink-0 items-center gap-2 rounded-md text-[13px] font-medium hover:text-primary sm:max-w-[220px]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded border border-border/70 bg-surface-2 text-[11px] font-semibold">
                      {company.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{company.name}</span>
                  </Link>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5 rounded-full px-4 text-[13px]"
                  onClick={() =>
                    openCopilot(`Draft a note to ${person.name}`, { kind: "person", id: person.id })
                  }
                >
                  <Mail className="h-4 w-4" />
                  Draft a message
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-full px-4 text-[13px]"
                  onClick={() =>
                    openCopilot(`Research ${person.name} for me`, { kind: "person", id: person.id })
                  }
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  Ask Atlas
                </Button>
                {profile.linkedinUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 rounded-full px-4 text-[13px]"
                    asChild
                  >
                    <a href={profile.linkedinUrl} target="_blank" rel="noreferrer">
                      Open on LinkedIn
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          <ProfileCard title="About">
            {profile.about ? (
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">
                {profile.about}
              </p>
            ) : (
              <EmptyLine>
                No about text collected yet. It fills in when {firstName}'s public profile summary
                is saved with a source.
              </EmptyLine>
            )}
          </ProfileCard>

          <ProfileCard
            title="Activity"
            action={
              profile.posts.length ? (
                <span className="text-[11.5px] text-muted-foreground">
                  {profile.posts.length} post{profile.posts.length === 1 ? "" : "s"}
                </span>
              ) : null
            }
          >
            {profile.posts.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile.posts.slice(0, 4).map((post) => (
                  <li
                    key={post.id}
                    className="flex flex-col rounded-lg border border-border/60 bg-background/40 p-3"
                  >
                    <p className="text-[11.5px] text-muted-foreground">
                      {post.date ? `Posted ${dayMonthYear(post.date)}` : "Post"}
                    </p>
                    <p className="mt-1 line-clamp-3 flex-1 text-[13px] leading-relaxed text-foreground/90">
                      {post.snippet}
                    </p>
                    {post.url ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring mt-2 inline-flex items-center gap-1 self-start rounded text-[12px] font-medium text-primary hover:underline"
                      >
                        See post
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine>
                No posts collected yet. Recent posts show here as a short snippet and a link once
                the LinkedIn collector saves them.
              </EmptyLine>
            )}
          </ProfileCard>

          <ProfileCard title="Experience">
            {profile.experience.length ? (
              <EntryList entries={profile.experience} icon={Briefcase} />
            ) : (
              <EmptyLine>
                No sourced roles yet. Jobs show here when a role is saved with a source, such as
                their LinkedIn page.
              </EmptyLine>
            )}
          </ProfileCard>

          <ProfileCard title="Education">
            {profile.education.length ? (
              <EntryList entries={profile.education} icon={GraduationCap} />
            ) : (
              <EmptyLine>No education collected yet.</EmptyLine>
            )}
          </ProfileCard>

          {profile.projects.length ? (
            <ProfileCard title="Projects & talks">
              <EntryList entries={profile.projects} icon={BookOpen} />
            </ProfileCard>
          ) : null}

          {profile.credentials.length ? (
            <ProfileCard title="Licenses & credentials">
              <EntryList entries={profile.credentials} icon={Award} />
            </ProfileCard>
          ) : null}

          <ProfileCard
            title="Event log"
            action={
              <span className="text-[11.5px] text-muted-foreground">
                {profile.eventLog.length} entr{profile.eventLog.length === 1 ? "y" : "ies"}
              </span>
            }
          >
            {profile.eventLog.length ? (
              <ol className="relative space-y-4 border-l border-border/70 pl-5">
                {profile.eventLog.map((entry) => {
                  const Icon = eventLogIcon[entry.kind];
                  const title = entry.eventId ? (
                    <Link
                      to={`/events?focus=${entry.eventId}`}
                      className="focus-ring rounded hover:text-primary"
                    >
                      {entry.title}
                    </Link>
                  ) : (
                    entry.title
                  );
                  return (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-[13.5px] font-semibold leading-snug">{title}</p>
                        <span className="num shrink-0 text-[11.5px] text-muted-foreground">
                          {entry.date ? dayMonthYear(entry.date) : "Date not recorded"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        {entry.meta ? <span>{entry.meta}</span> : null}
                        {entry.place ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {entry.place}
                          </span>
                        ) : null}
                        {entry.unverified ? <UnverifiedTag /> : null}
                      </div>
                      {entry.detail ? <ClampText text={entry.detail} /> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyLine>
                No events or meetings with {firstName} yet. They show here when you log where you
                met or an event lists them.
              </EmptyLine>
            )}
          </ProfileCard>

          {profile.notes.length ? (
            <ProfileCard
              title="Your notes"
              action={<span className="text-[11.5px] text-warn">unverified</span>}
            >
              <ul className="space-y-2">
                {profile.notes.map((note) => (
                  <li
                    key={note.id}
                    className="rounded-lg border border-dashed border-warn/30 bg-warn/[0.04] px-3 py-2"
                  >
                    <p className="text-[12.5px] leading-relaxed text-foreground/85">{note.text}</p>
                    {note.date ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {dayMonthYear(note.date)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Your own notes. They stay out of the headline, experience and anything that sends.
              </p>
            </ProfileCard>
          ) : null}

          {activity.length ? (
            <ProfileCard title="Agent activity">
              <ol className="space-y-3">
                {activity.map((entry) => {
                  const agent = agentById(world, entry.agentId);
                  return (
                    <li key={entry.id} className="flex gap-2.5">
                      {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12.5px] font-medium leading-snug">{entry.title}</p>
                          <span className="num shrink-0 text-[10.5px] text-muted-foreground">
                            {relativeTime(entry.at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                          {entry.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </ProfileCard>
          ) : null}

          <ProfileCard
            title="Sources"
            action={
              <span className="text-[11.5px] text-muted-foreground">
                {profile.sources.length} sourced of {person.claims.length}
              </span>
            }
          >
            {profile.sources.length ? (
              <ul className="space-y-1.5">
                {profile.sources.map((claim) => (
                  <li
                    key={claim.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px]"
                  >
                    <span className="min-w-0 flex-1 text-foreground/85">{claim.text}</span>
                    {claim.source.locator ? (
                      <a
                        href={claim.source.locator}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring inline-flex shrink-0 items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {claim.source.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {claim.source.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine>Nothing about {firstName} has a source yet.</EmptyLine>
            )}
          </ProfileCard>
        </div>

        {/* Right rail */}
        <aside className="min-w-0 space-y-4">
          <section className="panel p-4" aria-label="Relationship">
            <h2 className="text-[14px] font-semibold">Relationship</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <p className="eyebrow">Warmth</p>
                <p className="mt-1 font-medium capitalize">{person.warmth}</p>
              </div>
              <div>
                <p className="eyebrow">Stage</p>
                <p className="mt-1 font-medium first-letter:uppercase">
                  {profile.stage ?? "Not recorded"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="eyebrow">Last contact</p>
                <p className="mt-1 font-medium">{lastTouch}</p>
              </div>
            </div>
          </section>

          <section className="panel p-4" aria-label="Open decisions">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Open decisions</h2>
              <Link
                to="/approvals"
                className="focus-ring rounded text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                Inbox
              </Link>
            </div>
            {approvals.length === 0 ? (
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                Nothing waiting for {firstName}.
              </p>
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
                    <p className="mt-1.5 text-[12.5px] font-medium leading-snug">{approval.title}</p>
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

          {projects.length ? (
            <section className="panel p-4" aria-label="Projects and milestones">
              <h2 className="text-[14px] font-semibold">Projects & milestones</h2>
              <div className="mt-2.5 space-y-2">
                {projects.map((project) => {
                  const projectMilestones = milestones.filter(
                    (milestone) => milestone.projectId === project.id,
                  );
                  return (
                    <div key={project.id}>
                      <Link
                        to={`/projects/${project.id}`}
                        className="focus-ring inline-flex items-center gap-1 rounded text-[12.5px] font-medium hover:text-primary"
                      >
                        {project.name}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                      <div className="mt-1 space-y-1">
                        {projectMilestones.map((milestone) => {
                          const meta = milestoneStatusMeta[milestone.status];
                          return (
                            <Link
                              key={milestone.id}
                              to={`/milestones/${milestone.id}`}
                              className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-[11.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                            >
                              <span className="flex-1 truncate">{milestone.name}</span>
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
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="panel p-4" aria-label="Who can introduce me">
            <h2 className="text-[14px] font-semibold">Who can introduce me</h2>
            {introPaths.length === 0 ? (
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                No shared company, event or project with anyone else yet.
              </p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {introPaths.map(({ candidate, edges }) => (
                  <Link
                    key={candidate.id}
                    to={`/people/${candidate.id}`}
                    className="focus-ring flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2"
                  >
                    <PersonAvatar name={candidate.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{candidate.name}</p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {edges.join(" · ")}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {related.length ? (
            <section className="panel p-4" aria-label="Others at the company">
              <h2 className="text-[14px] font-semibold">
                More people at {company?.name ?? "this company"}
              </h2>
              <div className="mt-2.5 space-y-1">
                {related.map((other) => (
                  <Link
                    key={other.id}
                    to={`/people/${other.id}`}
                    className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
                  >
                    <PersonAvatar name={other.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{other.name}</p>
                      <p className="truncate text-[10.5px] text-muted-foreground">{other.role}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
};

export default PersonProfile;
