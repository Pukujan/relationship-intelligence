import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  agentById,
  milestoneStatusMeta,
  milestonesForProject,
  objectiveById,
  objectivesForProject,
  pendingApprovals,
  personById,
  planForMilestone,
  planProgress,
  projectById,
  projectProgress,
  projectsForPerson,
  relativeTime,
  shortDate,
} from "@/data/derive";
import { stallFor } from "@/lib/intelligence";
import type { World } from "@/data/types";
import { EvidenceRow, PersonAvatar } from "@/components/common";
import { MilestoneRow, Pill, ProgressBar } from "@/components/work";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AltitudeControl, type Altitude } from "./AltitudeControl";
import {
  RollupSignal,
  rollupForObjective,
  rollupForProject,
  rollupFor,
  type Rollup,
} from "./RollupSignal";

/**
 * Peek: the Brief-altitude side sheet. One-line verdict, at most three KPIs,
 * one primary action; everything else waits in collapsed sections that open
 * into Deep. People shown here are references into the graph — never copies.
 *
 * "Research this" opens /copilot with a seeded draft and a pinned scope.
 * Nothing is sent by opening the thread: the user still presses send, and the
 * thread's digest carries only the pinned scope (principal-private).
 */

export type PeekTarget = {
  kind: "project" | "objective" | "mission" | "event" | "approval";
  id: string;
};

interface PeekSection {
  id: string;
  label: string;
  count: number;
  content: ReactNode;
}

interface PeekModel {
  name: string;
  eyebrow: string;
  verdict: string;
  rollup: Rollup | null;
  kpis: { label: string; value: string }[];
  primary: ReactNode;
  research: { seed: string; scope: { kind: string; id: string | null } };
  sections: PeekSection[];
}

/** People rows with graph reach ("in N projects") — read, never duplicated. */
const PeopleList = ({ world, personIds }: { world: World; personIds: string[] }) => {
  const people = personIds
    .map((id) => personById(world, id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  if (!people.length) {
    return <p className="text-[11px] text-muted-foreground">No people referenced.</p>;
  }
  return (
    <div className="space-y-1">
      {people.map((person) => (
        <Link
          key={person.id}
          to={`/people/${person.id}`}
          className="focus-ring flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-surface-2"
        >
          <PersonAvatar name={person.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{person.name}</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">
              {person.role} · in {projectsForPerson(world, person.id).length} projects
            </span>
          </span>
          <span className="num text-[10px] text-muted-foreground">{person.strength}</span>
        </Link>
      ))}
    </div>
  );
};

const ActivityEvidence = ({ world, personIds }: { world: World; personIds: string[] }) => {
  const entries = world.activity
    .filter((entry) => entry.personId && personIds.includes(entry.personId))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5);
  if (!entries.length) {
    return <p className="text-[11px] text-muted-foreground">No recorded evidence yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
          <p className="truncate text-[11.5px] font-medium">{entry.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[10.5px] text-muted-foreground">{entry.detail}</p>
          <p className="num mt-0.5 text-[9.5px] text-muted-foreground/70">{relativeTime(entry.at)}</p>
        </div>
      ))}
    </div>
  );
};

const ApprovalEvidence = ({ world, agentIds }: { world: World; agentIds: string[] }) => {
  const approvals = pendingApprovals(world).filter((approval) =>
    agentIds.includes(approval.agentId),
  );
  if (!approvals.length) return null;
  return (
    <div className="space-y-2">
      {approvals.slice(0, 3).map((approval) => (
        <div key={approval.id}>
          <Link
            to={`/approvals?focus=${approval.id}`}
            className="focus-ring rounded text-[11.5px] font-medium transition-colors hover:text-primary"
          >
            {approval.title}
          </Link>
          <EvidenceRow evidence={approval.evidence} className="mt-1" limit={3} />
        </div>
      ))}
    </div>
  );
};

const buildModel = (
  world: World,
  target: PeekTarget,
  scopeProject: (projectId: string, name: string) => void,
): PeekModel | null => {
  if (target.kind === "project") {
    const project = projectById(world, target.id);
    if (!project) return null;
    const objectives = objectivesForProject(world, project.id);
    const milestones = milestonesForProject(world, project.id);
    const progress = projectProgress(world, project.id);
    const rollup = rollupForProject(world, project.id);
    const open = milestones.filter((milestone) => milestone.status !== "done");
    return {
      name: project.name,
      eyebrow: `${project.kind} · ${project.owner}`,
      verdict: rollup
        ? `${rollup.label} — ${rollup.detail}`
        : `Clear — ${progress}% rolled up across ${objectives.length} objective${objectives.length === 1 ? "" : "s"}.`,
      rollup,
      kpis: [
        { label: "Progress", value: `${progress}%` },
        { label: "Open milestones", value: `${open.length}` },
        { label: "People", value: `${project.personIds.length}` },
      ],
      primary: (
        <Button
          size="sm"
          className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]"
          onClick={() => scopeProject(project.id, project.name)}
        >
          <Target className="h-3.5 w-3.5" />
          Scope to this project
        </Button>
      ),
      research: {
        seed: `Research ${project.name}: where does it stand, what is blocked, and what should I do next?`,
        scope: { kind: "project", id: project.id },
      },
      sections: [
        {
          id: "objectives",
          label: "Objectives",
          count: objectives.length,
          content: (
            <div className="space-y-2">
              {objectives.map((objective) => (
                <div key={objective.id}>
                  <Link
                    to={`/objectives?focus=${objective.id}`}
                    className="focus-ring rounded text-[12px] font-medium transition-colors hover:text-primary"
                  >
                    {objective.name}
                  </Link>
                  <ProgressBar value={objective.progress} className="mt-1" label={`${objective.name} progress`} />
                </div>
              ))}
              {!objectives.length ? (
                <p className="text-[11px] text-muted-foreground">No objectives yet.</p>
              ) : null}
            </div>
          ),
        },
        {
          id: "milestones",
          label: "Milestones",
          count: milestones.length,
          content: (
            <div className="space-y-1.5">
              {milestones.map((milestone) => (
                <MilestoneRow key={milestone.id} world={world} milestone={milestone} showChain={false} />
              ))}
              {!milestones.length ? (
                <p className="text-[11px] text-muted-foreground">No milestones yet.</p>
              ) : null}
            </div>
          ),
        },
        {
          id: "people",
          label: "People",
          count: project.personIds.length,
          content: <PeopleList world={world} personIds={project.personIds} />,
        },
        {
          id: "evidence",
          label: "Evidence",
          count: pendingApprovals(world).filter((approval) =>
            milestones.some((milestone) => milestone.agentIds.includes(approval.agentId)),
          ).length,
          content: (
            <div className="space-y-3">
              <ApprovalEvidence
                world={world}
                agentIds={[...new Set(milestones.flatMap((milestone) => milestone.agentIds))]}
              />
              <ActivityEvidence world={world} personIds={project.personIds} />
            </div>
          ),
        },
      ],
    };
  }

  if (target.kind === "objective") {
    const objective = objectiveById(world, target.id);
    if (!objective) return null;
    const project = projectById(world, objective.projectId);
    const milestones = world.milestones.filter((milestone) => milestone.objectiveId === objective.id);
    const personIds = [...new Set(milestones.flatMap((milestone) => milestone.personIds))];
    const rollup = rollupForObjective(world, objective.id);
    return {
      name: objective.name,
      eyebrow: `objective · ${project?.name ?? "project"}`,
      verdict: `${objective.progress}% of “${objective.targetLabel}”${rollup ? ` — ${rollup.label.toLowerCase()}` : " — on track"}.`,
      rollup,
      kpis: [
        { label: "Progress", value: `${objective.progress}%` },
        { label: "Milestones", value: `${milestones.length}` },
        { label: "Due", value: objective.dueDate ? shortDate(objective.dueDate) : "—" },
      ],
      primary: (
        <Button size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]" asChild>
          <Link to={`/objectives?focus=${objective.id}`}>
            Open objective
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      ),
      research: {
        seed: `Research the objective “${objective.name}”${project ? ` in ${project.name}` : ""}: is it on track, and what would move it?`,
        scope: { kind: "project", id: objective.projectId },
      },
      sections: [
        {
          id: "milestones",
          label: "Milestones",
          count: milestones.length,
          content: (
            <div className="space-y-1.5">
              {milestones.map((milestone) => (
                <MilestoneRow key={milestone.id} world={world} milestone={milestone} showChain={false} />
              ))}
              {!milestones.length ? (
                <p className="text-[11px] text-muted-foreground">No milestones planned yet.</p>
              ) : null}
            </div>
          ),
        },
        {
          id: "people",
          label: "People",
          count: personIds.length,
          content: <PeopleList world={world} personIds={personIds} />,
        },
        {
          id: "evidence",
          label: "Evidence",
          count: 0,
          content: <ActivityEvidence world={world} personIds={personIds} />,
        },
      ],
    };
  }

  if (target.kind === "mission") {
    const milestone = world.milestones.find((item) => item.id === target.id);
    if (!milestone) return null;
    const project = projectById(world, milestone.projectId);
    const objective = objectiveById(world, milestone.objectiveId);
    const plan = planForMilestone(world, milestone.id);
    const stall = stallFor(world, milestone);
    const rollup = rollupFor(world, [milestone], milestone.personIds);
    const meta = milestoneStatusMeta[milestone.status];
    return {
      name: milestone.name,
      eyebrow: `${project?.name ?? "project"} › ${objective?.name ?? "objective"}`,
      verdict: stall ? stall.detail : `${meta.label} · due ${shortDate(milestone.due)}.`,
      rollup,
      kpis: [
        { label: "Plan", value: plan ? `${planProgress(plan)}%` : "—" },
        { label: "Steps done", value: plan ? `${plan.steps.filter((step) => step.status === "done").length}/${plan.steps.length}` : "—" },
        { label: "Due", value: shortDate(milestone.due) },
      ],
      primary: (
        <Button size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]" asChild>
          <Link to={`/milestones/${milestone.id}`}>
            Open milestone
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      ),
      research: {
        seed: `Research the milestone “${milestone.name}”: what is the plan, what is blocking it, and what is the fastest way to land it?`,
        scope: { kind: "mission", id: milestone.id },
      },
      sections: [
        {
          id: "plan",
          label: "Plan",
          count: plan?.steps.length ?? 0,
          content: plan ? (
            <ol className="space-y-1">
              {plan.steps.map((step, index) => (
                <li key={step.id} className="flex gap-2 text-[11.5px]">
                  <span className="num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-2 text-[9px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className={cn(step.status === "done" && "text-muted-foreground line-through decoration-border")}>
                    {step.label}
                    <span className="ml-1.5 text-[10.5px] text-muted-foreground no-underline">{step.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px] text-muted-foreground">No plan drafted yet.</p>
          ),
        },
        {
          id: "people",
          label: "People",
          count: milestone.personIds.length,
          content: <PeopleList world={world} personIds={milestone.personIds} />,
        },
        {
          id: "evidence",
          label: "Evidence",
          count: pendingApprovals(world).filter((approval) =>
            milestone.agentIds.includes(approval.agentId),
          ).length,
          content: (
            <div className="space-y-3">
              <ApprovalEvidence world={world} agentIds={milestone.agentIds} />
              <ActivityEvidence world={world} personIds={milestone.personIds} />
            </div>
          ),
        },
      ],
    };
  }

  if (target.kind === "event") {
    const event = world.events.find((item) => item.id === target.id);
    if (!event) return null;
    return {
      name: event.name,
      eyebrow: `${event.type} · ${event.location}`,
      verdict: `${event.goal} · ${event.attendeeIds.length} people expected.`,
      rollup: null,
      kpis: [
        { label: "Date", value: shortDate(event.date) },
        { label: "People", value: `${event.attendeeIds.length}` },
        { label: "Status", value: event.status },
      ],
      primary: (
        <Button size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]" asChild>
          <Link to={`/events?focus=${event.id}`}>
            Open event
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      ),
      research: {
        seed: `Research ${event.name}: who is attending, what do they care about, and how should I prepare?`,
        // Events stay graph-global; the thread pins the workspace, not a copy.
        scope: { kind: "workspace", id: null },
      },
      sections: [
        {
          id: "people",
          label: "People",
          count: event.attendeeIds.length,
          content: <PeopleList world={world} personIds={event.attendeeIds} />,
        },
        {
          id: "evidence",
          label: "Evidence",
          count: event.outcome ? 1 : 0,
          content: (
            <div className="space-y-1.5 text-[11.5px] text-muted-foreground">
              <p>Goal: {event.goal}</p>
              {event.outcome ? <p>Outcome: {event.outcome}</p> : null}
            </div>
          ),
        },
      ],
    };
  }

  const approval = world.approvals.find((item) => item.id === target.id);
  if (!approval) return null;
  const agent = agentById(world, approval.agentId);
  const person = approval.personId ? personById(world, approval.personId) : undefined;
  return {
    name: approval.title,
    eyebrow: `${agent?.name ?? "agent"} · ${approval.kind}`,
    verdict: `${approval.risk} risk · waiting since ${shortDate(approval.createdAt)}${
      approval.expiresAt ? ` · expires ${shortDate(approval.expiresAt)}` : ""
    }.`,
    rollup: null,
    kpis: [
      { label: "Risk", value: approval.risk },
      { label: "Status", value: approval.status },
      { label: "Waiting", value: relativeTime(approval.createdAt) },
    ],
    primary: (
      <Button size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]" asChild>
        <Link to={`/approvals?focus=${approval.id}`}>
          Decide in inbox
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    ),
    research: {
      seed: `Research the decision “${approval.title}”: what are the options, the risks, and your recommendation?`,
      scope: person ? { kind: "person", id: person.id } : { kind: "workspace", id: null },
    },
    sections: [
      {
        id: "evidence",
        label: "Evidence",
        count: approval.evidence.length,
        content: (
          <div className="space-y-2">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">{approval.reason}</p>
            <EvidenceRow evidence={approval.evidence} />
          </div>
        ),
      },
      ...(person
        ? [
            {
              id: "people",
              label: "People",
              count: 1,
              content: <PeopleList world={world} personIds={[person.id]} />,
            },
          ]
        : []),
    ],
  };
};

export const Peek = ({
  world,
  target,
  open,
  onOpenChange,
}: {
  world: World;
  target: PeekTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { setActiveProject } = useData();
  const navigate = useNavigate();
  // Peek always opens at Brief; Deep is one click (or one section) away.
  const [altitude, setAltitude] = useState<Altitude>("brief");
  const [openSections, setOpenSections] = useState<string[]>([]);

  useEffect(() => {
    setAltitude("brief");
    setOpenSections([]);
  }, [target?.kind, target?.id]);

  const model = target
    ? buildModel(world, target, (projectId, name) => {
        setActiveProject(projectId);
        toast.success(`Scoped to ${name}`, {
          description: "Objectives, milestones, plans, and the calendar now follow this project.",
        });
        onOpenChange(false);
      })
    : null;

  const sectionIds = model?.sections.map((section) => section.id) ?? [];

  return (
    <Sheet open={open && Boolean(model)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        {model ? (
          <>
            <SheetHeader className="space-y-1.5 border-b border-border/60 px-4 py-3.5 text-left">
              <p className="eyebrow">{model.eyebrow}</p>
              <SheetTitle className="text-[16px] leading-snug">{model.name}</SheetTitle>
              <SheetDescription className="text-[12px] leading-relaxed">
                {model.verdict}
              </SheetDescription>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <AltitudeControl
                  view="peek"
                  value={altitude}
                  onChange={setAltitude}
                  options={["brief", "deep"]}
                />
                {target?.kind === "project" || target?.kind === "objective" || target?.kind === "mission" ? (
                  <RollupSignal rollup={model.rollup} />
                ) : null}
              </div>
            </SheetHeader>

            <div className="space-y-4 px-4 py-4">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
                {model.kpis.slice(0, 3).map((kpi) => (
                  <div key={kpi.label} className="bg-surface-1/70 px-2.5 py-2">
                    <p className="eyebrow">{kpi.label}</p>
                    <p className="num mt-1 truncate text-[15px] font-semibold capitalize leading-none">
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {model.primary}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-md px-3 text-[11.5px]"
                  onClick={() => {
                    // Seed + scope pin only — the thread stays a draft until
                    // the user sends, and its digest is limited to the scope.
                    navigate("/copilot", {
                      state: { seed: model.research.seed, scope: model.research.scope },
                    });
                    onOpenChange(false);
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Research this
                </Button>
              </div>

              <Accordion
                type="multiple"
                value={altitude === "deep" ? sectionIds : openSections}
                onValueChange={(value) => setOpenSections(value as string[])}
                className="rounded-lg border border-border/60 px-3"
              >
                {model.sections.map((section) => (
                  <AccordionItem key={section.id} value={section.id} className="border-border/60 last:border-b-0">
                    <AccordionTrigger className="py-2.5 text-[12px] font-medium hover:no-underline">
                      <span className="flex items-center gap-2">
                        {section.label}
                        <span className="num rounded-full border border-border/70 bg-surface-2 px-1.5 py-px text-[9.5px] text-muted-foreground">
                          {section.count}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">{section.content}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
                <Pill className="border-border/70 bg-transparent text-muted-foreground">Brief</Pill>
                Expand a section — or switch to Deep — for the full record. People stay in the graph.
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
