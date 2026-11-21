import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Columns2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  milestonesForProject,
  objectivesForProject,
  personById,
  projectProgress,
  projectsForPerson,
  relativeTime,
  shortDate,
} from "@/data/derive";
import type { Project, World } from "@/data/types";
import { PersonAvatar } from "@/components/common";
import { Pill, ProgressBar } from "@/components/work";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RollupSignal, rollupForProject } from "./RollupSignal";
import type { PeekTarget } from "./Peek";

/**
 * The portfolio read: one row per project with rolled-up progress, the
 * worst-child signal, the next deadline, the owner, and the people it
 * references — each person chip shows how many projects reach them, because
 * people live in the graph and are referenced, never copied.
 *
 * Row click opens Peek (Brief). Compare mode pins 2–3 projects side by side.
 */

const nextDeadline = (world: World, project: Project) => {
  const open = milestonesForProject(world, project.id).filter(
    (milestone) => milestone.status !== "done",
  );
  const first = open[0];
  if (first) return { date: first.due, label: first.name, overdue: new Date(first.due).getTime() < Date.now() };
  if (project.targetDate) return { date: project.targetDate, label: "Target", overdue: false };
  return null;
};

/** Avatars + the "in N projects" reach chip (graph references, not copies). */
const PeopleReach = ({ world, project }: { world: World; project: Project }) => {
  const people = project.personIds
    .map((id) => personById(world, id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  if (!people.length) {
    return <span className="text-[10.5px] text-muted-foreground/70">No people</span>;
  }
  const shared = people.filter(
    (person) => projectsForPerson(world, person.id).length >= 2,
  ).length;
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center -space-x-1.5">
        {people.slice(0, 3).map((person) => (
          <span
            key={person.id}
            title={`${person.name} — in ${projectsForPerson(world, person.id).length} projects`}
          >
            <PersonAvatar name={person.name} size="xs" className="ring-2 ring-card" />
          </span>
        ))}
      </span>
      <Pill className="border-border/70 bg-transparent text-muted-foreground">
        <Users className="h-2.5 w-2.5" />
        {shared > 0 ? `${shared} in 2+ projects` : `${people.length} people`}
      </Pill>
    </span>
  );
};

const CompareBrief = ({
  world,
  project,
  onRemove,
}: {
  world: World;
  project: Project;
  onRemove: () => void;
}) => {
  const objectives = objectivesForProject(world, project.id);
  const milestones = milestonesForProject(world, project.id);
  const progress = projectProgress(world, project.id);
  const rollup = rollupForProject(world, project.id);
  const next = nextDeadline(world, project);
  return (
    <div className="panel flex flex-col gap-2.5 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/projects/${project.id}`}
            className="focus-ring rounded text-[13px] font-semibold transition-colors hover:text-primary"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 truncate text-[10.5px] capitalize text-muted-foreground">
            {project.kind} · {project.owner}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Remove ${project.name} from comparison`}
          onClick={onRemove}
          className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <RollupSignal rollup={rollup} />
      <ProgressBar value={progress} label={`${project.name} progress`} />
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <CalendarDays className="h-3 w-3" />
        {next ? (
          <span className={cn(next.overdue && "text-warn")}>
            {next.label} · {shortDate(next.date)} ({relativeTime(next.date)})
          </span>
        ) : (
          "No deadline set"
        )}
      </p>
      <div className="space-y-1 border-t border-border/50 pt-2">
        {objectives.slice(0, 3).map((objective) => (
          <p key={objective.id} className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
            <span className="truncate">{objective.name}</span>
            <span className="num shrink-0">{objective.progress}%</span>
          </p>
        ))}
        {!objectives.length ? (
          <p className="text-[10.5px] text-muted-foreground/70">No objectives yet.</p>
        ) : null}
      </div>
      <p className="mt-auto text-[10px] text-muted-foreground">
        {objectives.length} objectives · {milestones.length} milestones ·{" "}
        {project.personIds.length} people referenced
      </p>
    </div>
  );
};

export const PortfolioTable = ({
  world,
  projects,
  onPeek,
}: {
  world: World;
  projects: Project[];
  onPeek: (target: PeekTarget) => void;
}) => {
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (projectId: string) => {
    setSelected((current) => {
      if (current.includes(projectId)) {
        return current.filter((id) => id !== projectId);
      }
      // Compare is a brief read of 2–3 projects, never a wall of panels.
      if (current.length >= 3) return current;
      return [...current, projectId];
    });
  };

  const compared = selected
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is Project => Boolean(project));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {compareMode
            ? "Pick 2–3 projects to compare their briefs side by side."
            : "Click a row to peek at the brief — no page change."}
        </p>
        <Button
          size="sm"
          variant={compareMode ? "secondary" : "outline"}
          className="h-8 gap-1.5 rounded-lg px-2.5 text-[11.5px]"
          aria-pressed={compareMode}
          onClick={() => {
            setCompareMode((current) => !current);
            setSelected([]);
          }}
        >
          <Columns2 className="h-3.5 w-3.5" />
          {compareMode ? "Done comparing" : "Compare"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-1/60 hover:bg-surface-1/60">
              {compareMode ? <TableHead className="w-8" /> : null}
              <TableHead className="text-[10.5px] uppercase tracking-[0.08em]">Project</TableHead>
              <TableHead className="w-36 text-[10.5px] uppercase tracking-[0.08em]">Progress</TableHead>
              <TableHead className="text-[10.5px] uppercase tracking-[0.08em]">Signal</TableHead>
              <TableHead className="text-[10.5px] uppercase tracking-[0.08em]">Next deadline</TableHead>
              <TableHead className="text-[10.5px] uppercase tracking-[0.08em]">Owner</TableHead>
              <TableHead className="text-[10.5px] uppercase tracking-[0.08em]">People</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const progress = projectProgress(world, project.id);
              const rollup = rollupForProject(world, project.id);
              const next = nextDeadline(world, project);
              const company = project.companyIds[0]
                ? world.companies.find((item) => item.id === project.companyIds[0])
                : undefined;
              const isSelected = selected.includes(project.id);
              return (
                <TableRow
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Peek at ${project.name}`}
                  onClick={() => onPeek({ kind: "project", id: project.id })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPeek({ kind: "project", id: project.id });
                    }
                  }}
                  className={cn(
                    "cursor-pointer transition-colors",
                    isSelected && "bg-primary/[0.05]",
                  )}
                >
                  {compareMode ? (
                    <TableCell
                      className="w-8"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={!isSelected && selected.length >= 3}
                        onCheckedChange={() => toggle(project.id)}
                        aria-label={`Compare ${project.name}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <p className="text-[12.5px] font-medium">{project.name}</p>
                    <p className="mt-0.5 truncate text-[10.5px] capitalize text-muted-foreground">
                      {project.kind}
                      {company ? ` · ${company.name}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="w-36">
                    <ProgressBar value={progress} label={`${project.name} progress`} />
                  </TableCell>
                  <TableCell>
                    <RollupSignal rollup={rollup} />
                  </TableCell>
                  <TableCell>
                    {next ? (
                      <span className={cn("text-[11px]", next.overdue ? "text-warn" : "text-muted-foreground")}>
                        <span className="num">{shortDate(next.date)}</span>
                        <span className="block truncate text-[10px] opacity-80">
                          {next.label} · {relativeTime(next.date)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/70">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[11.5px] text-muted-foreground">
                    {project.owner}
                  </TableCell>
                  <TableCell>
                    <PeopleReach world={world} project={project} />
                  </TableCell>
                </TableRow>
              );
            })}
            {!projects.length ? (
              <TableRow>
                <TableCell colSpan={compareMode ? 7 : 6} className="py-6 text-center text-[11.5px] text-muted-foreground">
                  No projects in this scope.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {compareMode && compared.length >= 2 ? (
        <div
          className={cn(
            "grid gap-3",
            compared.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {compared.map((project) => (
            <CompareBrief
              key={project.id}
              world={world}
              project={project}
              onRemove={() => toggle(project.id)}
            />
          ))}
        </div>
      ) : null}

      {compareMode && compared.length === 1 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          Select one more project to see the side-by-side briefs.
        </p>
      ) : null}
    </div>
  );
};
