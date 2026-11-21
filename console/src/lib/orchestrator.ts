import { isToday } from "date-fns";
import {
  activityForAgent,
  agentById,
  agentStats,
  companyById,
  milestonesDueToday,
  objectiveById,
  pendingApprovals,
  pendingApprovalsForAgent,
  personById,
  planForMilestone,
  planProgress,
  projectById,
  relativeTime,
  tasksForMilestone,
  upcomingEvents,
} from "@/data/derive";
import type {
  Agent,
  Approval,
  Milestone,
  Person,
  Project,
  World,
} from "@/data/types";

export type CopilotLinkKind =
  | "person"
  | "company"
  | "approval"
  | "event"
  | "agent"
  | "project"
  | "mission"
  | "objective"
  | "timeline"
  | "inbox";

export interface CopilotLink {
  label: string;
  href: string;
  kind: CopilotLinkKind;
  meta?: string;
}

export interface CopilotStep {
  label: string;
  agentId?: string;
  detail?: string;
}

export interface CopilotAnswer {
  intentId: string;
  intentLabel: string;
  summary: string;
  draft?: string;
  agents: string[];
  steps: CopilotStep[];
  links: CopilotLink[];
  approvalIds: string[];
}

const hasAny = (text: string, needles: string[]) =>
  needles.some((needle) => text.includes(needle));

const daysSince = (value: string) =>
  Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000));

const agentName = (world: World, id: string) =>
  agentById(world, id)?.name ?? "the team";

const personLink = (person: Person): CopilotLink => ({
  label: person.name,
  href: `/people/${person.id}`,
  kind: "person",
  meta: `${person.role}`,
});

const approvalLink = (approval: Approval, world: World): CopilotLink => ({
  label: approval.title,
  href: `/approvals?focus=${approval.id}`,
  kind: "approval",
  meta: `${agentName(world, approval.agentId)} · waiting on you`,
});

const findPersonMentioned = (prompt: string, world: World) => {
  const text = prompt.toLowerCase();
  return (
    world.people.find((person) => text.includes(person.name.toLowerCase())) ??
    world.people.find((person) => {
      const [first, last] = person.name.toLowerCase().split(" ");
      return (
        (first && first.length > 3 && text.includes(first)) ||
        (last && last.length > 3 && text.includes(last))
      );
    })
  );
};

const findCompanyMentioned = (prompt: string, world: World) => {
  const text = prompt.toLowerCase();
  return world.companies.find((company) =>
    text.includes(company.name.toLowerCase().split(" ")[0]),
  );
};

const findProjectMentioned = (prompt: string, world: World) => {
  const text = prompt.toLowerCase();
  return world.projects.find((project) =>
    text.includes(project.name.toLowerCase()),
  );
};

const findMilestoneMentioned = (prompt: string, world: World) => {
  const text = prompt.toLowerCase();
  return world.milestones.find((milestone) =>
    text.includes(milestone.name.toLowerCase()),
  );
};

const milestoneLink = (milestone: Milestone, world: World): CopilotLink => {
  const project = projectById(world, milestone.projectId);
  return {
    label: milestone.name,
    href: `/milestones/${milestone.id}`,
    kind: "mission",
    meta: `${project?.name ?? "Milestone"} · ${milestone.status.replace("_", " ")}`,
  };
};

const projectLink = (project: Project, world: World): CopilotLink => {
  const objectives = world.objectives.filter(
    (objective) => objective.projectId === project.id,
  );
  return {
    label: project.name,
    href: `/projects/${project.id}`,
    kind: "project",
    meta: `${objectives.length} objectives`,
  };
};

const projectAnswer = (world: World, project: Project): CopilotAnswer => {
  const objectives = world.objectives.filter(
    (objective) => objective.projectId === project.id,
  );
  const milestones = world.milestones
    .filter((milestone) => milestone.projectId === project.id)
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
  const today = milestones.filter((milestone) => isToday(new Date(milestone.due)));
  const blocked = milestones.filter((milestone) => milestone.status === "blocked");
  const people = project.personIds
    .map((id) => personById(world, id))
    .filter((person): person is Person => Boolean(person));
  const company = companyById(world, project.companyIds[0]);
  const progress = objectives.length
    ? Math.round(
        objectives.reduce((sum, objective) => sum + objective.progress, 0) /
          objectives.length,
      )
    : 0;
  const agents = Array.from(
    new Set(milestones.flatMap((milestone) => milestone.agentIds)),
  );

  return {
    intentId: "project-status",
    intentLabel: `Project · ${project.name}`,
    agents,
    steps: [
      {
        label: `Reading ${project.name} and its objectives`,
        detail: `${objectives.length} objectives · ${progress}% overall`,
      },
      {
        label: "Checking which milestones land today",
        detail: `${today.length} due today · ${milestones.length} in flight`,
      },
      {
        label: "Listing anything waiting on you",
        detail: `${blocked.length} blocked on a decision`,
      },
    ],
    summary: `${project.name} is ${
      project.status === "at_risk" ? "at risk" : project.status
    } at ${progress}% across ${objectives.length} objective${
      objectives.length === 1 ? "" : "s"
    }. ${today.length} milestone${today.length === 1 ? "" : "s"} land today${
      blocked.length
        ? `, and ${blocked.length} ${blocked.length === 1 ? "is" : "are"} waiting on your approval`
        : " and nothing is blocked"
    }. ${company ? `${company.name} — ${company.notes}` : project.summary}`,
    links: [
      projectLink(project, world),
      ...objectives.slice(0, 2).map((objective) => ({
        label: objective.name,
        href: `/objectives?focus=${objective.id}`,
        kind: "objective" as const,
        meta: `${objective.progress}% · ${objective.status.replace("_", " ")}`,
      })),
      ...today.slice(0, 2).map((milestone) => milestoneLink(milestone, world)),
      ...people.slice(0, 2).map(personLink),
    ],
    approvalIds: pendingApprovals(world)
      .filter((approval) =>
        approval.personId ? project.personIds.includes(approval.personId) : false,
      )
      .map((approval) => approval.id),
  };
};

const milestoneAnswer = (world: World, milestone: Milestone): CopilotAnswer => {
  const project = projectById(world, milestone.projectId);
  const objective = objectiveById(world, milestone.objectiveId);
  const plan = planForMilestone(world, milestone.id);
  const tasks = tasksForMilestone(world, milestone.id);
  const people = milestone.personIds
    .map((id) => personById(world, id))
    .filter((person): person is Person => Boolean(person));
  const approvals = pendingApprovals(world).filter((approval) =>
    milestone.agentIds.includes(approval.agentId),
  );

  return {
    intentId: "milestone-status",
    intentLabel: `Milestone · ${milestone.name}`,
    agents: milestone.agentIds,
    steps: plan
      ? plan.steps.map((step) => ({
          label: step.label,
          agentId: step.agentId,
          detail: step.status === "done" ? "done" : step.status === "doing" ? "in progress" : "queued",
        }))
      : [
          { label: "Reading the milestone brief", detail: milestone.summary },
          { label: "Checking for a plan", detail: "No plan drafted yet" },
        ],
    summary: `${milestone.name} is ${milestone.status.replace("_", " ")} under ${
      project?.name ?? "its project"
    }${objective ? ` › ${objective.name}` : ""}, due ${relativeTime(milestone.due)}. ${
      plan
        ? `The plan is ${planProgress(plan)}% through ${plan.steps.length} steps and ${
            tasks.length
          } task${tasks.length === 1 ? "" : "s"} are attached.`
        : "No plan has been drafted yet, so the milestone is still queued."
    }${
      approvals.length
        ? ` ${approvals.length} approval${approvals.length === 1 ? "" : "s"} from this milestone ${
            approvals.length === 1 ? "is" : "are"
          } waiting on you.`
        : ""
    }`,
    links: [
      milestoneLink(milestone, world),
      ...(project ? [projectLink(project, world)] : []),
      ...(objective
        ? [
            {
              label: objective.name,
              href: `/objectives?focus=${objective.id}`,
              kind: "objective" as const,
              meta: `${objective.progress}% · ${objective.targetLabel}`,
            },
          ]
        : []),
      ...people.slice(0, 2).map(personLink),
    ],
    approvalIds: approvals.map((approval) => approval.id),
  };
};

const todayWorkAnswer = (world: World): CopilotAnswer => {
  const today = milestonesDueToday(world);
  const pending = pendingApprovals(world);
  const blocked = today.filter((milestone) => milestone.status === "blocked");
  return {
    intentId: "today-work",
    intentLabel: "Today's milestones",
    agents: Array.from(new Set(today.flatMap((milestone) => milestone.agentIds))),
    steps: [
      {
        label: "Reading the milestone board for today",
        detail: `${today.length} milestones land today`,
      },
      {
        label: "Cross-checking the approval queue",
        detail: `${pending.length} decisions waiting`,
      },
      {
        label: "Grouping by project and agent",
        detail: `${world.projects.length} projects in scope`,
      },
    ],
    summary: today.length
      ? `${today.length} milestone${today.length === 1 ? "" : "s"} land today: ${today
          .slice(0, 3)
          .map(
            (milestone) =>
              `${milestone.name} (${milestone.status.replace("_", " ")}, ${relativeTime(
                milestone.due,
              )})`,
          )
          .join("; ")}. ${blocked.length} of them cannot move until you decide.`
      : "Nothing is due today. The next milestones are already queued for this week.",
    links: [
      ...today.slice(0, 4).map((milestone) => milestoneLink(milestone, world)),
      { label: "Open the milestone board", href: "/milestones", kind: "mission" },
    ],
    approvalIds: pending.slice(0, 2).map((approval) => approval.id),
  };
};

const followUpAnswer = (world: World): CopilotAnswer => {
  const stalled = world.people
    .filter((person) => daysSince(person.lastContact) >= 10)
    .sort((a, b) => daysSince(b.lastContact) - daysSince(a.lastContact))
    .slice(0, 3);
  const waiting = pendingApprovals(world);

  const sentences = stalled.map((person) => {
    const company = companyById(world, person.companyId);
    return `${person.name} (${company?.name ?? "—"}, ${daysSince(
      person.lastContact,
    )} days quiet, strength ${person.strength})`;
  });

  return {
    intentId: "follow-ups",
    intentLabel: "Weekly follow-up sweep",
    agents: ["sales", "research"],
    steps: [
      {
        label: "Scanning 7 days of email, calls, and event notes",
        agentId: "sales",
        detail: "412 threads · 6 events · 3 agents",
      },
      {
        label: "Ranking threads by reply gap and relationship strength",
        agentId: "sales",
        detail: "Strength, renewal dates, and last reply",
      },
      {
        label: "Checking each claim against its source",
        agentId: "research",
        detail: "Sourced facts only",
      },
      {
        label: "Drafting follow-ups in your voice",
        agentId: "sales",
        detail: `${waiting.length} will need your approval`,
      },
    ],
    summary: stalled.length
      ? `Three relationships are worth your attention this week: ${sentences.join(
          "; ",
        )}. Mira has already drafted the Halcyon follow-up and is holding it for you. Atlas is re-checking two unverified claims before anything goes out.`
      : "Every relationship is inside its reply window. Mira will keep watching and flag the first thread that goes quiet.",
    links: [
      ...stalled.map(personLink),
      ...waiting.slice(0, 2).map((approval) => approvalLink(approval, world)),
      { label: "Open the activity timeline", href: "/activity", kind: "timeline" },
    ],
    approvalIds: waiting.slice(0, 2).map((approval) => approval.id),
  };
};

const draftAnswer = (world: World, prompt: string): CopilotAnswer => {
  const mentionedCompany = findCompanyMentioned(prompt, world);
  const companyPerson = mentionedCompany
    ? world.people
        .filter((person) => person.companyId === mentionedCompany.id)
        .sort((a, b) => b.strength - a.strength)[0]
    : undefined;
  const person =
    findPersonMentioned(prompt, world) ??
    companyPerson ??
    world.people
      .slice()
      .sort((a, b) => daysSince(b.lastContact) - daysSince(a.lastContact))[0];
  const company = companyById(world, person.companyId);
  const approval = pendingApprovals(world).find(
    (item) => item.personId === person.id,
  );
  const source = person.claims.find((claim) => claim.status === "sourced");
  const draft = `Hi ${person.name.split(" ")[0]} — it's been a few weeks since we last traded notes. ${
    source ? source.text.replace(/\.$/, "") : "Your team has grown"
  } and I'd like to bring a short plan for ${
    company?.name ?? "your team"
  } rather than another general update. Worth 20 minutes this week?`;

  return {
    intentId: "draft-outreach",
    intentLabel: `Draft outreach · ${person.name}`,
    agents: ["sales", "research"],
    steps: [
      {
        label: `Loading the last 90 days with ${person.name}`,
        agentId: "sales",
        detail: `${daysSince(person.lastContact)} days since last contact`,
      },
      {
        label: "Pulling current facts and their sources",
        agentId: "research",
        detail: `${person.claims.length} claims on file`,
      },
      {
        label: "Drafting a short note in your voice",
        agentId: "sales",
        detail: "Warm, specific, no pricing",
      },
      {
        label: "Holding for your approval before anything sends",
        agentId: "sales",
        detail: "Nothing sends without you",
      },
    ],
    summary: `Drafted for ${person.name} at ${company?.name ?? "—"}. ${
      approval
        ? `Mira already has a related approval waiting — ${approval.title.toLowerCase()}.`
        : "This is a new thread; Mira will hold it for approval before sending."
    }`,
    draft,
    links: [
      personLink(person),
      ...(company
        ? [
            {
              label: company.name,
              href: `/people?tab=companies&focus=${company.id}`,
              kind: "company" as const,
              meta: company.sector,
            },
          ]
        : []),
      ...(approval ? [approvalLink(approval, world)] : []),
    ],
    approvalIds: approval ? [approval.id] : [],
  };
};

const publishAnswer = (world: World): CopilotAnswer => {
  const pending = pendingApprovals(world).filter(
    (approval) => approval.kind === "publish",
  );
  const strongest = pending[0];
  return {
    intentId: "publish",
    intentLabel: "Publishing review",
    agents: ["marketing", "research"],
    steps: [
      {
        label: "Collecting drafts from the publishing queue",
        agentId: "marketing",
        detail: `${pending.length} drafts ready`,
      },
      {
        label: "Checking every claim against its source",
        agentId: "research",
        detail: "One unverified market-size claim",
      },
      {
        label: "Preparing the publish approvals",
        agentId: "marketing",
        detail: "Waiting on you",
      },
    ],
    summary: pending.length
      ? `Cove has ${pending.length} drafts waiting. ${
          strongest ? `“${strongest.title.replace(/^Publish: /, "")}”` : "The lead draft"
        } is the strongest, but it carries one claim Atlas could not verify — a $14B category number. Nothing publishes until you decide.`
      : "The publishing queue is clear. Cove will draft the next post from this week's activity.",
    links: pending.map((approval) => approvalLink(approval, world)),
    approvalIds: pending.map((approval) => approval.id),
  };
};

const researchAnswer = (world: World): CopilotAnswer => {
  const company =
    findCompanyMentioned("halcyon", world) ??
    companyById(world, "c2") ??
    world.companies[0];
  const people = world.people.filter((person) => person.companyId === company.id);
  const claims = people.flatMap((person) => person.claims);
  const unverified = claims.filter((claim) => claim.status === "unverified");
  return {
    intentId: "research",
    intentLabel: `Research · ${company.name}`,
    agents: ["research"],
    steps: [
      {
        label: `Reading the ${company.name} account history`,
        agentId: "research",
        detail: `${people.length} people · ${claims.length} claims`,
      },
      {
        label: "Cross-checking people against the relationship graph",
        agentId: "research",
        detail: "Warm paths and shared edges",
      },
      {
        label: "Attaching a source to every fact",
        agentId: "research",
        detail: `${unverified.length} flagged, not canonical`,
      },
    ],
    summary: `${company.name} (${company.sector}, ${company.stage}) has ${people.length} people in your graph and ${claims.length} claims on file, ${unverified.length} of which are unverified and flagged. ${company.notes}`,
    links: [
      {
        label: company.name,
        href: `/people?tab=companies&focus=${company.id}`,
        kind: "company",
        meta: company.sector,
      },
      ...people.slice(0, 3).map(personLink),
    ],
    approvalIds: [],
  };
};

const approvalsAnswer = (world: World): CopilotAnswer => {
  const pending = pendingApprovals(world);
  const byAgent = world.agents
    .map((agent) => ({
      agent,
      count: pendingApprovalsForAgent(world, agent.id).length,
    }))
    .filter((row) => row.count > 0);
  return {
    intentId: "approvals",
    intentLabel: "Approval inbox",
    agents: byAgent.map((row) => row.agent.id),
    steps: [
      { label: "Reading the approval queue", agentId: "sales", detail: `${pending.length} pending` },
      { label: "Grouping by agent and risk", agentId: "research" },
      { label: "Opening the inbox, newest first", agentId: "sales" },
    ],
    summary: pending.length
      ? `${pending.length} decisions are waiting: ${byAgent
          .map((row) => `${row.count} from ${row.agent.name}`)
          .join(", ")}. The highest-risk item is “${
          pending.find((approval) => approval.risk === "high")?.title ??
          pending[0].title
        }”.`
      : "Your approval inbox is clear. Every agent is running inside its autonomy.",
    links: [
      { label: "Open the approval inbox", href: "/approvals", kind: "inbox" },
      ...pending.slice(0, 3).map((approval) => approvalLink(approval, world)),
    ],
    approvalIds: pending.map((approval) => approval.id),
  };
};

const eventAnswer = (world: World, prompt: string): CopilotAnswer => {
  const events = upcomingEvents(world);
  const text = prompt.toLowerCase();
  const mentioned = events.find((item) =>
    item.name
      .toLowerCase()
      .split(" ")
      .filter((word) => word.length > 4)
      .some((word) => text.includes(word)),
  );
  const event = mentioned ?? events[0];
  if (!event) {
    return {
      intentId: "event-prep",
      intentLabel: "Event prep",
      agents: ["marketing"],
      steps: [{ label: "Checking the calendar", agentId: "marketing" }],
      summary: "No upcoming events are on the calendar yet.",
      links: [{ label: "Open events", href: "/events", kind: "event" }],
      approvalIds: [],
    };
  }
  const attendees = event.attendeeIds
    .map((id) => personById(world, id))
    .filter((person): person is Person => Boolean(person));
  const daysAway = Math.max(
    0,
    Math.ceil((new Date(event.date).getTime() - Date.now()) / 86_400_000),
  );
  return {
    intentId: "event-prep",
    intentLabel: `Event prep · ${event.name}`,
    agents: [event.agentId, "research"],
    steps: [
      {
        label: `Pulling the ${event.name} brief`,
        agentId: event.agentId,
        detail: `${attendees.length} attendees · ${event.location}`,
      },
      {
        label: "Refreshing facts on every attendee",
        agentId: "research",
        detail: "Sourced, with last-contact dates",
      },
      {
        label: "Drafting the pre-event plan",
        agentId: event.agentId,
        detail: "One goal per conversation",
      },
    ],
    summary: `${event.name} is ${
      daysAway === 0 ? "today" : `in ${daysAway} days`
    } in ${event.location}. Goal: ${event.goal} ${
      attendees.length
    } people are on the list, including ${attendees
      .slice(0, 3)
      .map((person) => person.name)
      .join(", ")}.`,
    links: [
      {
        label: event.name,
        href: `/events?focus=${event.id}`,
        kind: "event",
        meta: event.location,
      },
      ...attendees.slice(0, 3).map(personLink),
    ],
    approvalIds: [],
  };
};

const peopleAnswer = (world: World): CopilotAnswer => {
  const strongest = world.people
    .slice()
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
  return {
    intentId: "people",
    intentLabel: "Relationship search",
    agents: ["research", "sales"],
    steps: [
      { label: "Searching people and companies", agentId: "research" },
      { label: "Ranking by strength and last contact", agentId: "sales" },
      { label: "Opening the strongest matches", agentId: "research" },
    ],
    summary: `Your strongest relationships right now are ${strongest
      .map((person) => `${person.name} (${person.strength})`)
      .join(", ")}. Atlas can widen any of them with sourced facts.`,
    links: strongest.map(personLink),
    approvalIds: [],
  };
};

const phoneAnswer = (world: World): CopilotAnswer => {
  const pending = pendingApprovals(world);
  return {
    intentId: "phone",
    intentLabel: "Voice call",
    agents: ["sales", "marketing", "research"],
    steps: [
      { label: "Dialing your number", detail: "Same orchestrator, voice channel" },
      {
        label: "Reading the approval queue",
        detail: `${pending.length} decisions pending`,
      },
      { label: "Logging your decisions to the timeline", detail: "Voice counts as consent" },
    ],
    summary: `I'll call you now and read the ${pending.length} pending approvals. Approve, decline, or skip each one by voice — every decision lands in the inbox and the timeline exactly as if you tapped it.`,
    links: [
      { label: "Open the voice surface", href: "/voice", kind: "agent" },
      ...pending.slice(0, 3).map((approval) => approvalLink(approval, world)),
    ],
    approvalIds: pending.map((approval) => approval.id),
  };
};

const statusAnswer = (world: World): CopilotAnswer => {
  const agents = world.agents;
  return {
    intentId: "status",
    intentLabel: "Team status",
    agents: agents.map((agent) => agent.id),
    steps: [
      { label: "Checking every agent's queue", detail: `${world.tasks.length} tasks` },
      { label: "Reading the last 24 hours of activity", detail: `${activityForAgent(world, "sales").length} sales events` },
      { label: "Summarising what needs you", detail: `${pendingApprovals(world).length} approvals` },
    ],
    summary: `In the last day the team logged ${
      world.activity.filter((entry) => isToday(new Date(entry.at))).length
    } actions and completed ${
      world.runs.filter((run) => isToday(new Date(run.startedAt))).length
    } runs. ${agents
      .map(
        (agent) =>
          `${agent.name} is ${
            agent.status === "needs_you"
              ? "waiting on you"
              : agent.status
          }${agent.currentTask ? ` — ${agent.currentTask.title.toLowerCase()}` : ""}.`,
      )
      .join(" ")}`,
    links: agents.map((agent) => ({
      label: agent.name,
      href: `/agents/${agent.id}`,
      kind: "agent" as const,
      meta: agent.role,
    })),
    approvalIds: [],
  };
};

const addAgentAnswer = (world: World): CopilotAnswer => ({
  intentId: "add-agent",
  intentLabel: "New agent · milestone brief",
  agents: [],
  steps: [
    { label: "Reading the request", detail: "Role, scope, autonomy" },
    {
      label: "Checking overlap with Mira, Cove, and Atlas",
      detail: "No duplicate queues",
    },
    {
      label: "Drafting the milestone brief and approval rules",
      detail: "Held for your review",
    },
  ],
  summary:
    "A new agent starts from a milestone, not a toggle. Here is the brief I would propose for an ops agent. Nothing runs until you accept it, and Mira, Cove, and Atlas keep their current queues in the meantime.",
  draft:
    "Milestone — Keep vendor, candidate, and recruiter relationships warm.\nScope — Ops relationships only. No customer outreach, no pricing.\nKPIs — Reply gap under 7 days · 3 check-ins a week · 0 unapproved sends.\nAutonomy — Draft only. Every outbound message waits for your approval.\nFirst run — Map the vendors with no contact in 30 days and draft two check-ins.",
  links: world.agents.map((agent) => ({
    label: `${agent.name} · ${agent.role}`,
    href: `/agents/${agent.id}`,
    kind: "agent" as const,
    meta: agent.autonomy === "approve" ? "approval required" : agent.autonomy,
  })),
  approvalIds: [],
});

const agentAnswer = (world: World, agent: Agent): CopilotAnswer => {
  const stats = agentStats(world, agent.id);
  const pending = pendingApprovalsForAgent(world, agent.id);
  const latest = activityForAgent(world, agent.id)[0];
  return {
    intentId: "agent-status",
    intentLabel: `${agent.name} · live status`,
    agents: [agent.id],
    steps: [
      {
        label: `Reading ${agent.name}'s queue`,
        agentId: agent.id,
        detail: `${stats.running} running · ${stats.queued} queued`,
      },
      {
        label: "Checking the last 24 hours of activity",
        agentId: agent.id,
        detail: latest ? relativeTime(latest.at) : "no recent activity",
      },
      {
        label: "Listing anything waiting on you",
        agentId: agent.id,
        detail: `${pending.length} approvals`,
      },
    ],
    summary: `${agent.name} is ${
      agent.status === "needs_you" ? "waiting on you" : agent.status
    }. ${
      agent.currentTask
        ? `Right now: “${agent.currentTask.title}” (${agent.currentTask.progress}%).`
        : "No task is running."
    } ${pending.length} approval${pending.length === 1 ? "" : "s"} of its work ${
      pending.length === 1 ? "is" : "are"
    } waiting on you. ${
      latest ? `Last action: ${latest.title.toLowerCase()} — ${relativeTime(latest.at)}.` : ""
    }`.trim(),
    links: [
      {
        label: agent.name,
        href: `/agents/${agent.id}`,
        kind: "agent",
        meta: agent.role,
      },
      ...pending.map((approval) => approvalLink(approval, world)),
    ],
    approvalIds: pending.map((approval) => approval.id),
  };
};

/** Scheduled research is planned, never preset: the offline router asks for
 * the three decisions (brief, cadence, scope) instead of creating anything. */
const scheduleAnswer = (world: World, prompt: string): CopilotAnswer => {
  const text = prompt.toLowerCase();
  const cadence = hasAny(text, ["daily", "every day", "each morning"])
    ? "daily"
    : hasAny(text, ["weekly", "every week"])
      ? "weekly"
      : hasAny(text, ["once", "one-off", "one time"])
        ? "once"
        : null;
  const project = findProjectMentioned(prompt, world);
  const person = findPersonMentioned(prompt, world);
  const scope = project ? `the ${project.name} project` : person ? person.name : null;
  const decided = [
    cadence ? `cadence: ${cadence}` : null,
    scope ? `scope: ${scope}` : null,
  ].filter(Boolean);
  return {
    intentId: "plan-schedule",
    intentLabel: "Scheduled research · plan together",
    agents: [],
    steps: [
      { label: "Agree the research brief", detail: "what each run should produce, and for whom" },
      { label: "Settle the cadence", detail: cadence ? `you said ${cadence} — confirm or change it` : "daily, weekly, or once — your call, not a default" },
      { label: "Pick the scope", detail: scope ? `you pointed at ${scope} — confirm or widen it` : "whole workspace, one project, or one person" },
      { label: "Propose the schedule for your confirmation", detail: "nothing is created until you confirm it" },
    ],
    summary: `Let's plan this before anything is scheduled. ${
      decided.length ? `So far you've decided ${decided.join(" and ")}.` : "Nothing is decided yet — we'll settle it together."
    } Tell me what a good run should produce${scope ? "" : ", who or what it should cover"}, and how often you want it. I'll ask about anything missing, then propose the exact schedule for you to confirm — I won't create it on my own.`,
    links: [
      ...(project ? [projectLink(project, world)] : []),
      ...(person ? [personLink(person)] : []),
    ],
    approvalIds: [],
  };
};

export const planRequest = (prompt: string, world: World): CopilotAnswer => {
  const text = prompt.toLowerCase().trim();

  if (
    hasAny(text, [
      "add agent",
      "add an agent",
      "new agent",
      "hire an agent",
      "another agent",
      "ops agent",
      "recruiting agent",
      "how do i add",
    ])
  ) {
    return addAgentAnswer(world);
  }
  if (hasAny(text, ["call me", "phone me", "ring me", "dial", "give me a call", "call my"])) {
    return phoneAnswer(world);
  }
  if (
    hasAny(text, [
      "scheduled research",
      "schedule a",
      "schedule research",
      "plan a schedule",
      "new schedule",
      "recurring",
      "every week",
      "every day",
      "weekly brief",
      "daily brief",
      "on a cadence",
      "schedule this",
      "set up a schedule",
    ])
  ) {
    return scheduleAnswer(world, prompt);
  }
  if (
    hasAny(text, [
      "due today",
      "today's milestones",
      "todays milestones",
      "what's due",
      "whats due",
      "my milestones",
      "milestone board",
      "this week's milestones",
    ])
  ) {
    return todayWorkAnswer(world);
  }
  const mentionedMilestone = findMilestoneMentioned(prompt, world);
  if (mentionedMilestone) {
    return milestoneAnswer(world, mentionedMilestone);
  }
  const mentionedProject = findProjectMentioned(prompt, world);
  if (mentionedProject) {
    return projectAnswer(world, mentionedProject);
  }
  const mentionedObjective = world.objectives.find((objective) =>
    text.includes(objective.name.toLowerCase()),
  );
  const objectiveProject = mentionedObjective
    ? projectById(world, mentionedObjective.projectId)
    : undefined;
  if (objectiveProject) {
    return projectAnswer(world, objectiveProject);
  }
  if (hasAny(text, ["publish", "post ", "blog", "newsletter", "announce", "tweet", "recap"])) {
    return publishAnswer(world);
  }
  if (hasAny(text, ["draft", "write", "note to", "email to", "compose", "intro", "message to"])) {
    return draftAnswer(world, prompt);
  }
  if (hasAny(text, ["follow up", "follow-up", "followup", "who should", "reach out", "catch up", "quiet"])) {
    return followUpAnswer(world);
  }
  if (hasAny(text, ["approv", "pending", "inbox", "decision", "waiting on me"])) {
    return approvalsAnswer(world);
  }
  if (hasAny(text, ["research", "look up", "who is", "background", "verify", "map ", "org chart", "company"])) {
    return researchAnswer(world);
  }
  if (hasAny(text, ["event", "dinner", "summit", "calendar", "prep", "meeting", "conference"])) {
    return eventAnswer(world, prompt);
  }
  const mentionedAgent = world.agents.find((agent) =>
    text.includes(agent.name.toLowerCase()),
  );
  if (mentionedAgent) {
    return agentAnswer(world, mentionedAgent);
  }
  if (hasAny(text, ["people", "directory", "contacts", "find ", "search", "strongest relationship"])) {
    return peopleAnswer(world);
  }
  if (hasAny(text, ["status", "how are", "what's running", "whats running", "doing", "team"])) {
    return statusAnswer(world);
  }
  return followUpAnswer(world);
};
