import { assign, setup } from "xstate";
import type { DesignStep, MilestoneAutonomy, MilestoneDesign, MilestoneHorizon } from "@/data/types";

/**
 * RI-0010 fill-in machine (XState v5).
 *
 * A model-produced design is a *proposal*, never a decision. When the design is
 * missing required fields we ask for them as questions instead of guessing, and
 * nothing is applied until a human approves. This is the "propose-don't-decide"
 * rule made structural: APPLY is guarded by an explicit APPROVE, so an agent (or
 * a stray event) can never push work through on its own.
 *
 * The emitted payload (`context.proposal`, also the machine output on `done`) is
 * a full `MilestoneDesign` — exactly the input shape of `designAsProposal(world,
 * design)` in src/lib/intelligence.ts — so the inbox and the copilot share one
 * proposal contract. Defaults are conservative: autonomy "approve", and every
 * model-derived field stays flagged unverified until a human signs off.
 */

/** The required fields the copilot must collect before it can propose. */
export type FillInField = "missionName" | "objectiveTarget" | "due" | "agentIds";

export interface FillInQuestion {
  field: FillInField;
  question: string;
}

export interface FillInInput {
  /** Whatever the model produced; required fields may be absent. */
  design: Partial<MilestoneDesign>;
}

export interface FillInContext {
  draft: Partial<MilestoneDesign>;
  questions: FillInQuestion[];
  /** Human gate: only an APPROVE event sets this true. */
  approved: boolean;
  proposal: MilestoneDesign | null;
}

export type FillInEvent =
  | { type: "ANSWER"; field: FillInField; value: string | string[] }
  | { type: "APPROVE" }
  | { type: "DECLINE" }
  | { type: "EDIT" }
  | { type: "APPLY" };

const isComplete = (draft: Partial<MilestoneDesign>): boolean =>
  Boolean(draft.missionName?.trim()) &&
  Boolean(draft.objectiveTarget?.trim()) &&
  Boolean(draft.due?.trim()) &&
  Boolean(draft.agentIds?.length);

const questionsFor = (draft: Partial<MilestoneDesign>): FillInQuestion[] => {
  const questions: FillInQuestion[] = [];
  if (!draft.missionName?.trim()) questions.push({ field: "missionName", question: "What should this milestone be called?" });
  if (!draft.objectiveTarget?.trim()) questions.push({ field: "objectiveTarget", question: "What outcome tells us the objective is met?" });
  if (!draft.due?.trim()) questions.push({ field: "due", question: "When is it due? (ISO date)" });
  if (!draft.agentIds?.length) questions.push({ field: "agentIds", question: "Which agents should own it?" });
  return questions;
};

/**
 * Assemble a complete MilestoneDesign from the collected draft. Conservative
 * defaults keep the human gate intact (autonomy "approve") and keep model
 * output flagged unverified — unsourced claims never become canonical here.
 */
export const toDesign = (draft: Partial<MilestoneDesign>): MilestoneDesign => {
  const missionName = draft.missionName?.trim() ?? "";
  const planSteps: DesignStep[] = draft.planSteps ?? [];
  const horizon: MilestoneHorizon = draft.horizon ?? "this_week";
  const autonomy: MilestoneAutonomy = draft.autonomy ?? "approve";
  return {
    kind: draft.kind ?? "mission",
    missionName,
    missionSummary: draft.missionSummary ?? "",
    projectId: draft.projectId,
    projectName: draft.projectName,
    projectMission: draft.projectMission,
    objectiveName: draft.objectiveName ?? missionName,
    objectiveTarget: draft.objectiveTarget?.trim() ?? "",
    objectiveId: draft.objectiveId,
    horizon,
    due: draft.due?.trim() ?? "",
    agentIds: draft.agentIds ?? [],
    autonomy,
    planSteps,
    rationale: draft.rationale ?? "Collected the missing required fields; nothing runs without your approval.",
    unverified: draft.unverified ?? ["Model-produced design — review before approving; not canonical until approved."],
    milestoneId: draft.milestoneId,
    adjustment: draft.adjustment,
  };
};

const makeContext = (input: FillInInput): FillInContext => ({
  draft: input.design,
  questions: questionsFor(input.design),
  approved: false,
  proposal: null,
});

export const fillInMachine = setup({
  types: {} as { context: FillInContext; events: FillInEvent; input: FillInInput },
  guards: {
    complete: ({ context }) => isComplete(context.draft),
    // The human gate: APPLY is only legal after an explicit APPROVE.
    approved: ({ context }) => context.approved,
  },
  actions: {
    answer: assign(({ context, event }) => {
      const e = event as Extract<FillInEvent, { type: "ANSWER" }>;
      const draft: Partial<MilestoneDesign> = { ...context.draft };
      if (e.field === "agentIds") {
        draft.agentIds = Array.isArray(e.value) ? e.value : [e.value];
      } else {
        draft[e.field] = typeof e.value === "string" ? e.value : e.value.join(", ");
      }
      return { draft, questions: questionsFor(draft) };
    }),
    buildProposal: assign(({ context }) => ({ proposal: toDesign(context.draft) })),
    markApproved: assign({ approved: true }),
    clearApproval: assign({ approved: false }),
  },
}).createMachine({
  id: "fillIn",
  initial: "collecting",
  context: ({ input }) => makeContext(input ?? { design: {} }),
  // The payload handed to designAsProposal(world, design) once applied.
  output: ({ context }) => context.proposal,
  states: {
    collecting: {
      // As soon as every required field is present, move to a proposal.
      always: { guard: "complete", target: "proposing" },
      on: {
        ANSWER: { actions: "answer" },
        // APPLY before the fields are even collected is ignored outright.
      },
    },

    proposing: {
      entry: "buildProposal",
      on: {
        APPROVE: { target: "applying", actions: "markApproved" },
        DECLINE: { target: "collecting", actions: "clearApproval" },
        EDIT: { target: "collecting", actions: "clearApproval" },
        // Guarded: without APPROVE this transition is rejected and we stay put.
        APPLY: { guard: "approved", target: "done" },
      },
    },

    applying: {
      on: {
        APPLY: { guard: "approved", target: "done" },
        EDIT: { target: "collecting", actions: "clearApproval" },
      },
    },

    done: { type: "final" },
  },
});
