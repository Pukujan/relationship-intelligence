import { assign, setup } from "xstate";

/**
 * RI-0010 work machines (XState v5) — canonical definitions.
 *
 * These are the pure, transport-agnostic state definitions for milestone
 * lifecycle and approval decisions. Server-side adoption lands in a later
 * slice; for now these machines + their tests (console/scripts/test-machines.mjs)
 * are the canonical contract the console renders against and the server will
 * later honour. Keeping them pure means the same rules run in the browser, in
 * Node tests, and (eventually) inside the adapter without divergence.
 *
 * Trust / privacy: an approval can only be decided by a human (DECIDE guard),
 * and a milestone may only be re-planned once it is stalled or blocked — never
 * while it is healthily running. Nothing here sends or writes on its own.
 */

/* ------------------------------------------------------------------ */
/* Milestone lifecycle                                                   */
/* ------------------------------------------------------------------ */

/** Default quiet window before a running milestone is considered stalled. */
export const MILESTONE_QUIET_WINDOW_MS = 15 * 60 * 1000;

export interface MilestoneInput {
  milestoneId: string;
  /** Override the quiet window (tests use a short one). */
  quietWindowMs?: number;
}

export interface MilestoneContext {
  milestoneId: string;
  quietWindowMs: number;
  replans: number;
  lastProgressAt: string | null;
  blockReason: string | null;
}

export type MilestoneEvent =
  | { type: "START" }
  | { type: "PROGRESS" }
  | { type: "BLOCK"; reason?: string }
  | { type: "UNBLOCK" }
  | { type: "REPLAN" }
  | { type: "COMPLETE" };

export const milestoneMachine = setup({
  types: {} as { context: MilestoneContext; events: MilestoneEvent; input: MilestoneInput },
  delays: {
    // The quiet window is data, so tests can shrink it without fake timers.
    quietWindow: ({ context }) => context.quietWindowMs,
  },
  actions: {
    touchProgress: assign({ lastProgressAt: () => new Date().toISOString() }),
    countReplan: assign(({ context }) => ({ replans: context.replans + 1, blockReason: null })),
    recordBlock: assign(({ event }) => ({
      blockReason: (event as Extract<MilestoneEvent, { type: "BLOCK" }>).reason ?? null,
    })),
    clearBlock: assign({ blockReason: null }),
  },
}).createMachine({
  id: "milestone",
  initial: "queued",
  context: ({ input }) => ({
    milestoneId: input?.milestoneId ?? "",
    quietWindowMs: input?.quietWindowMs ?? MILESTONE_QUIET_WINDOW_MS,
    replans: 0,
    lastProgressAt: null,
    blockReason: null,
  }),
  states: {
    queued: {
      on: {
        START: { target: "running", actions: "touchProgress" },
        COMPLETE: "done",
      },
    },

    running: {
      // No progress for the quiet window → stalled (a proposal, not a dead end).
      after: { quietWindow: { target: "stalled" } },
      on: {
        // Re-entering restarts the quiet-window timer.
        PROGRESS: { target: "running", reenter: true, actions: "touchProgress" },
        BLOCK: { target: "blocked", actions: "recordBlock" },
        COMPLETE: "done",
        // REPLAN is deliberately absent here: a healthy running milestone is
        // never re-planned. Only stalled/blocked milestones may be re-planned.
      },
    },

    blocked: {
      on: {
        UNBLOCK: { target: "running", actions: "clearBlock" },
        REPLAN: { target: "queued", actions: "countReplan" },
        COMPLETE: "done",
      },
    },

    stalled: {
      on: {
        REPLAN: { target: "queued", actions: "countReplan" },
        START: { target: "running", actions: "touchProgress" },
        PROGRESS: { target: "running", actions: "touchProgress" },
        COMPLETE: "done",
      },
    },

    done: { type: "final" },
  },
});

/* ------------------------------------------------------------------ */
/* Approval decision                                                   */
/* ------------------------------------------------------------------ */

export interface ApprovalInput {
  approvalId: string;
}

export interface ApprovalContext {
  approvalId: string;
  actor: "human" | "agent" | null;
  decision: "approved" | "declined" | null;
  note: string | null;
  decidedAt: string | null;
}

export type ApprovalEvent = {
  type: "DECIDE";
  decision: "approved" | "declined";
  /** Only a human may decide; an agent DECIDE is rejected. */
  actor: "human" | "agent";
  note?: string;
};

export const approvalMachine = setup({
  types: {} as { context: ApprovalContext; events: ApprovalEvent; input: ApprovalInput },
  guards: {
    // The human gate: agents propose, humans dispose.
    isHuman: ({ event }) => (event as ApprovalEvent).actor === "human",
  },
  actions: {
    recordDecision: assign(({ event }) => {
      const e = event as ApprovalEvent;
      return {
        actor: e.actor,
        decision: e.decision,
        note: e.note ?? null,
        decidedAt: new Date().toISOString(),
      };
    }),
  },
}).createMachine({
  id: "approval",
  initial: "pending",
  context: ({ input }) => ({
    approvalId: input?.approvalId ?? "",
    actor: null,
    decision: null,
    note: null,
    decidedAt: null,
  }),
  states: {
    pending: {
      on: {
        DECIDE: [
          {
            guard: ({ event }) => event.actor === "human" && event.decision === "approved",
            target: "approved",
            actions: "recordDecision",
          },
          {
            guard: ({ event }) => event.actor === "human" && event.decision === "declined",
            target: "declined",
            actions: "recordDecision",
          },
          // Non-human (or malformed) decisions fall through and are rejected:
          // the approval stays pending. Nothing sends without a human.
        ],
      },
    },

    approved: { type: "final" },
    declined: { type: "final" },
  },
});
