import { assign, setup } from "xstate";
import type { Part } from "@/data/sessionTypes";

/**
 * RI-0010 turn coordinator (XState v5).
 *
 * Actor semantics: this machine does NOT invoke the SSE fetch itself. The
 * component owns the network call (`streamTurn`) and feeds the machine the
 * events it observes — PHASE / PART / DONE / ERROR — plus ABORT when the human
 * stops the turn. The machine is the single source of truth for *where the turn
 * is*, so the UI never reconstructs phase from a pile of independent useState
 * flags. Keeping the fetch outside the machine means the same coordinator works
 * whether the transport is SSE today or a different stream later.
 *
 * Trust / privacy: a turn may not leave `scoping` until its scope is pinned
 * (`scopePinned` guard). The component pins the scope and builds the scoped
 * digest synchronously before SUBMIT, so only the pinned scope's claims can
 * ever reach the model — cross-tab leakage is impossible by construction.
 *
 * The resting states (done / cancelled / fallback) are intentionally NOT
 * `final`: one long-lived actor serves every turn in the workspace, and SUBMIT
 * re-arms it. Nothing here sends or persists on its own — persistence is driven
 * by the component and still flows through the data source's approval seam.
 */

export type TurnScopeKind = "workspace" | "project" | "person" | "mission";

export interface TurnContext {
  prompt: string;
  scopeKind: TurnScopeKind;
  scopeId: string | null;
  /** True once the component has pinned the scope and built its scoped digest. */
  scopePinned: boolean;
  /** Requested route ("auto" or "provider/model"); distinct from the resolved model. */
  route: string;
  reasoning: string;
  /** Resolved by the server and reported on DONE. */
  provider: string | null;
  model: string | null;
  parts: Part[];
  phases: string[];
  abortController: AbortController | null;
  error: string | null;
}

export type TurnEvent =
  | {
      type: "SUBMIT";
      prompt: string;
      scopeKind: TurnScopeKind;
      scopeId: string | null;
      scopePinned: boolean;
      route: string;
      reasoning: string;
    }
  | { type: "PHASE"; label: string }
  | { type: "PART"; part: Part }
  | { type: "DONE"; provider: string; model: string; reasoning: string; parts: number; dropped: number }
  | { type: "ERROR"; message: string }
  | { type: "ABORT" };

const initialTurnContext: TurnContext = {
  prompt: "",
  scopeKind: "workspace",
  scopeId: null,
  scopePinned: false,
  route: "auto",
  reasoning: "off",
  provider: null,
  model: null,
  parts: [],
  phases: [],
  abortController: null,
  error: null,
};

/* Server phase labels (console/server/index.ts) mapped to coordinator states. */
const labelIs = (label: string, prefix: string) => label.toLowerCase().startsWith(prefix);
const isScopingLabel = (label: string) => labelIs(label, "scoping");
const isRoutingLabel = (label: string) => labelIs(label, "routing");
const isValidatingLabel = (label: string) => labelIs(label, "validating");
const isPersistingLabel = (label: string) => labelIs(label, "persisting");
const isPersistedLabel = (label: string) => labelIs(label, "persisted") || labelIs(label, "thread persisted");

/** States in which a turn is still in flight (the UI shows the live block). */
export const turnLiveStates = ["scoping", "searching", "routing", "streaming", "validating", "persisting"] as const;
export const isTurnLive = (value: unknown): boolean =>
  typeof value === "string" && (turnLiveStates as readonly string[]).includes(value);

/** ABORT / ERROR behave the same from every in-flight state. */
const interruptible = {
  // Aborting the fetch closes the request, which cancels the server run.
  ABORT: { target: "cancelled", actions: "abortFetch" },
  ERROR: { target: "fallback", actions: "recordError" },
} as const;

export const turnMachine = setup({
  types: {} as { context: TurnContext; events: TurnEvent },
  guards: {
    // Privacy gate: scoping cannot complete until the scope is pinned.
    scopePinned: ({ context }) => context.scopePinned,
  },
  actions: {
    resetTurn: assign(({ event }) => {
      const e = event as Extract<TurnEvent, { type: "SUBMIT" }>;
      return {
        prompt: e.prompt,
        scopeKind: e.scopeKind,
        scopeId: e.scopeId,
        scopePinned: e.scopePinned,
        route: e.route,
        reasoning: e.reasoning,
        provider: null,
        model: null,
        parts: [],
        phases: [],
        error: null,
        abortController: new AbortController(),
      };
    }),
    recordPhase: assign(({ context, event }) => ({
      phases: [...context.phases, (event as Extract<TurnEvent, { type: "PHASE" }>).label],
    })),
    appendPart: assign(({ context, event }) => ({
      parts: [...context.parts, (event as Extract<TurnEvent, { type: "PART" }>).part],
    })),
    recordMeta: assign(({ event }) => {
      const e = event as Extract<TurnEvent, { type: "DONE" }>;
      return { provider: e.provider, model: e.model, reasoning: e.reasoning };
    }),
    recordError: assign(({ event }) => ({
      error: (event as Extract<TurnEvent, { type: "ERROR" }>).message,
    })),
    abortFetch: ({ context }) => {
      context.abortController?.abort();
    },
  },
}).createMachine({
  id: "turn",
  initial: "idle",
  context: initialTurnContext,
  states: {
    idle: {
      on: { SUBMIT: { target: "scoping", actions: "resetTurn" } },
    },

    scoping: {
      on: {
        PHASE: [
          // The server's own "Scoping…" heartbeat: record it, stay put.
          { guard: ({ event }) => isScopingLabel(event.label), actions: "recordPhase" },
          // Only a pinned scope may advance past scoping.
          { guard: "scopePinned", target: "searching", actions: "recordPhase" },
          // Unpinned: record the phase but hold — no claims leave this tab.
          { actions: "recordPhase" },
        ],
        ...interruptible,
      },
    },

    searching: {
      on: {
        PHASE: [
          { guard: ({ event }) => isRoutingLabel(event.label), target: "routing", actions: "recordPhase" },
          { actions: "recordPhase" },
        ],
        DONE: { target: "validating", actions: "recordMeta" },
        ...interruptible,
      },
    },

    routing: {
      on: {
        // The server validates each part before emitting it, so its
        // "Validating parts…" phase marks the start of the part stream.
        PHASE: [
          { guard: ({ event }) => isValidatingLabel(event.label), target: "streaming", actions: "recordPhase" },
          { actions: "recordPhase" },
        ],
        PART: { target: "streaming", actions: "appendPart" },
        DONE: { target: "validating", actions: "recordMeta" },
        ...interruptible,
      },
    },

    streaming: {
      on: {
        PART: { actions: "appendPart" },
        PHASE: { actions: "recordPhase" },
        DONE: { target: "validating", actions: "recordMeta" },
        ...interruptible,
      },
    },

    validating: {
      // Client-side re-validation happens inside the source's appendMessage;
      // the component signals whether it will persist or settle empty.
      on: {
        PHASE: [
          { guard: ({ event }) => isPersistedLabel(event.label), target: "done" },
          { guard: ({ event }) => isPersistingLabel(event.label), target: "persisting", actions: "recordPhase" },
          { actions: "recordPhase" },
        ],
        ...interruptible,
      },
    },

    persisting: {
      on: {
        PHASE: [
          { guard: ({ event }) => isPersistedLabel(event.label), target: "done" },
          { actions: "recordPhase" },
        ],
        ...interruptible,
      },
    },

    done: {
      on: { SUBMIT: { target: "scoping", actions: "resetTurn" } },
    },
    cancelled: {
      on: { SUBMIT: { target: "scoping", actions: "resetTurn" } },
    },
    fallback: {
      on: { SUBMIT: { target: "scoping", actions: "resetTurn" } },
    },
  },
});
