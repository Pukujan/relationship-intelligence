import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  agentById,
  missionStatusMeta,
  objectiveById,
  personById,
  projectById,
  projectStatusMeta,
  relativeTime,
} from "@/data/derive";
import type { Mission, Project, World } from "@/data/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { PersonAvatar } from "@/components/common";

export const Pill = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
      className,
    )}
  >
    {children}
  </span>
);

export const ProgressBar = ({
  value,
  tone = "primary",
  className,
  label,
}: {
  value: number;
  tone?: "primary" | "run" | "warn";
  className?: string;
  label?: string;
}) => (
  <div
    className={cn("flex items-center gap-2", className)}
    role="progressbar"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={label ?? "Progress"}
  >
    <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
      <span
        className={cn(
          "block h-full rounded-full transition-[width]",
          tone === "run" && "bg-run",
          tone === "warn" && "bg-warn",
          tone === "primary" && "bg-primary/80",
        )}
        style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
      />
    </span>
    <span className="num w-8 text-right text-[10.5px] text-muted-foreground">
      {value}%
    </span>
  </div>
);

export const PersonChips = ({
  world,
  personIds,
  max = 4,
  showNames = false,
  linked = true,
  className,
}: {
  world: World;
  personIds: string[];
  max?: number;
  showNames?: boolean;
  /** Set false when the chips sit inside another link. */
  linked?: boolean;
  className?: string;
}) => {
  const people = personIds
    .map((id) => personById(world, id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="flex items-center -space-x-1.5">
        {shown.map((person) =>
          linked ? (
            <Link
              key={person.id}
              to={`/people/${person.id}`}
              className="focus-ring rounded-full"
              aria-label={`Open ${person.name}`}
              title={`${person.name} · ${person.role}`}
            >
              <PersonAvatar
                name={person.name}
                size="xs"
                className="ring-2 ring-card"
              />
            </Link>
          ) : (
            <PersonAvatar
              key={person.id}
              name={person.name}
              size="xs"
              className="ring-2 ring-card"
            />
          ),
        )}
      </span>
      {people.length > max ? (
        <span className="num text-[10px] text-muted-foreground">
          +{people.length - max}
        </span>
      ) : null}
      {showNames ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {shown
            .map((person) => person.name.split(" ")[0])
            .join(", ")}
          {people.length > max ? ` +${people.length - max}` : ""}
        </span>
      ) : null}
    </span>
  );
};

export const ProjectLink = ({
  world,
  projectId,
  className,
  withKind = false,
}: {
  world: World;
  projectId: string;
  className?: string;
  withKind?: boolean;
}) => {
  const project = projectById(world, projectId);
  if (!project) return null;
  return (
    <Link
      to={`/projects/${project.id}`}
      className={cn(
        "focus-ring rounded text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {project.name}
      {withKind ? (
        <span className="ml-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
          {project.kind}
        </span>
      ) : null}
    </Link>
  );
};

export const MissionChain = ({
  world,
  mission,
  className,
  linked = true,
}: {
  world: World;
  mission: Mission;
  className?: string;
  /** Set false when the chain sits inside another link. */
  linked?: boolean;
}) => {
  const objective = objectiveById(world, mission.objectiveId);
  const project = projectById(world, mission.projectId);
  return (
    <span
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-muted-foreground",
        className,
      )}
    >
      {linked ? (
        <ProjectLink world={world} projectId={mission.projectId} />
      ) : (
        <span className="truncate">{project?.name}</span>
      )}
      <span className="text-border">›</span>
      {objective ? (
        linked ? (
          <Link
            to={`/objectives?focus=${objective.id}`}
            className="focus-ring truncate rounded transition-colors hover:text-foreground"
          >
            {objective.name}
          </Link>
        ) : (
          <span className="truncate">{objective.name}</span>
        )
      ) : null}
    </span>
  );
};

export const MissionRow = ({
  world,
  mission,
  selected = false,
  showChain = true,
}: {
  world: World;
  mission: Mission;
  selected?: boolean;
  showChain?: boolean;
}) => {
  const meta = missionStatusMeta[mission.status];
  return (
    <Link
      to={`/missions/${mission.id}`}
      aria-label={`Open ${mission.name}`}
      className={cn(
        "focus-ring group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        selected
          ? "border-primary/35 bg-surface-2/70"
          : "border-border/60 bg-card/50 hover:border-border hover:bg-surface-2/40",
      )}
    >
      <span className="mt-0.5 flex flex-col items-center gap-1">
        <span
          className={cn(
            "mt-1 h-1.5 w-1.5 rounded-full",
            mission.status === "running" && "bg-run animate-live-dot",
            mission.status === "blocked" && "bg-warn",
            mission.status === "queued" && "bg-idle",
            mission.status === "done" && "bg-primary",
          )}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="max-w-full truncate text-[12.5px] font-medium">
            {mission.name}
          </p>
          <Pill className={meta.className}>{meta.label}</Pill>
          <Pill className="border-border/70 bg-transparent text-muted-foreground">
            {mission.horizon === "today" ? "Today" : "This week"}
          </Pill>
        </div>
        {showChain ? (
          <MissionChain
            world={world}
            mission={mission}
            className="mt-1"
            linked={false}
          />
        ) : (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {mission.summary}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex items-center -space-x-1">
          {mission.agentIds.map((agentId) => {
            const agent = agentById(world, agentId);
            if (!agent) return null;
            return <AgentAvatar key={agentId} agent={agent} size="sm" />;
          })}
        </div>
        <span className="num flex items-center gap-1 text-[10px] text-muted-foreground">
          <CalendarDays className="h-2.5 w-2.5" />
          {relativeTime(mission.due)}
        </span>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
    </Link>
  );
};

export const ProjectCard = ({
  world,
  project,
  active = false,
}: {
  world: World;
  project: Project;
  active?: boolean;
}) => {
  const objectives = world.objectives.filter(
    (objective) => objective.projectId === project.id,
  );
  const missions = world.missions.filter(
    (mission) => mission.projectId === project.id,
  );
  const progress = objectives.length
    ? Math.round(
        objectives.reduce((sum, objective) => sum + objective.progress, 0) /
          objectives.length,
      )
    : 0;
  const next = missions.find((mission) => mission.status !== "done");
  const company = project.companyIds[0]
    ? world.companies.find((item) => item.id === project.companyIds[0])
    : undefined;

  return (
    <Link
      to={`/projects/${project.id}`}
      aria-label={`Open ${project.name}`}
      className={cn(
        "focus-ring group flex flex-col gap-3 rounded-xl border p-4 transition-colors",
        active
          ? "border-primary/35 bg-surface-2/50"
          : "border-border/60 bg-card/50 hover:border-border hover:bg-surface-2/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold">{project.name}</p>
            <Pill className="border-border/70 bg-transparent capitalize text-muted-foreground">
              {project.kind}
            </Pill>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {company?.name ?? "Workspace initiative"} · {project.owner}
          </p>
        </div>
        <Pill className={projectStatusMeta[project.status].className}>
          {projectStatusMeta[project.status].label}
        </Pill>
      </div>

      <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {project.summary}
      </p>

      <ProgressBar value={progress} label={`${project.name} progress`} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
          <span>{objectives.length} objectives</span>
          <span className="text-border">·</span>
          <span>{missions.length} missions</span>
        </div>
        <PersonChips
          world={world}
          personIds={project.personIds}
          max={4}
          linked={false}
        />
      </div>

      {next ? (
        <p className="flex items-center gap-1.5 truncate border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          Next: {next.name} · {relativeTime(next.due)}
        </p>
      ) : null}
    </Link>
  );
};

export const ScopeBanner = ({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2">
    <span className="text-[11px] text-foreground/85">
      Scoped to <span className="font-medium">{label}</span>
    </span>
    <button
      type="button"
      onClick={onClear}
      className="focus-ring ml-auto rounded-md border border-border/70 bg-surface-1 px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      View all projects
    </button>
  </div>
);
