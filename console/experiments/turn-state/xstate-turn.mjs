/**
 * XState v5 implementation of the same turn pipeline, snapshots persisted in
 * the same Octo table. The runner drives events; every transition is saved so
 * restore/go-back are cross-process operations like the LangGraph side.
 */
import { setup, assign, createActor } from "xstate";
import { ensureTable, putRow, rows, nextSeq } from "./octo-store.mjs";

export const turnMachine = setup({
  types: {
    context: /** @type {{slots: Record<string, unknown>, log: string[], stage: string, detour: boolean, stall: boolean}} */ ({}),
    events: /** @type {{type: "NEXT"} | {type: "STALL"} | {type: "SET", detour?: boolean, stall?: boolean}} */ ({}),
  },
}).createMachine({
  id: "turn",
  initial: "scoping",
  context: { slots: {}, log: [], stage: "idle", detour: false, stall: false },
  on: {
    RESET: { target: ".scoping", actions: assign({ log: ({ context }) => [...context.log, "reset"] }) },
    SET: {
      actions: assign({
        detour: ({ context, event }) => event.detour ?? context.detour,
        stall: ({ context, event }) => event.stall ?? context.stall,
      }),
    },
  },
  states: {
    scoping: {
      entry: assign({ stage: "scoped", log: ({ context }) => [...context.log, "scope"] }),
      on: { NEXT: "retrieving" },
    },
    retrieving: {
      entry: assign({
        stage: "retrieved",
        log: ({ context }) => [...context.log, "retrieve"],
        slots: ({ context }) => ({ ...context.slots, retrieved: true }),
      }),
      on: { NEXT: "reasoning", STALL: "fallback" },
    },
    reasoning: {
      entry: assign({
        stage: ({ context }) => (context.stall ? "stalled" : "reasoned"),
        log: ({ context }) => [...context.log, context.stall ? "stall" : context.detour ? "detour" : "reason"],
        slots: ({ context }) => (context.stall ? context.slots : { ...context.slots, asked: true }),
      }),
      on: {
        NEXT: [
          { target: "fallback", guard: ({ context }) => context.stall },
          { target: "validating" },
        ],
        STALL: "fallback",
      },
    },
    validating: {
      entry: assign({ stage: "validated", log: ({ context }) => [...context.log, "validate"] }),
      on: { NEXT: "acting" },
    },
    acting: {
      entry: assign({
        stage: "acted",
        log: ({ context }) => [...context.log, "act"],
        slots: ({ context }) => ({ ...context.slots, acted: true }),
      }),
      on: { NEXT: "recording" },
    },
    recording: {
      entry: assign({
        stage: "recorded",
        log: ({ context }) => [...context.log, "record"],
        slots: ({ context }) => ({ ...context.slots, recorded: true }),
      }),
      on: { NEXT: "done" },
    },
    fallback: {
      entry: assign({ stage: "fallback", log: ({ context }) => [...context.log, "fallback"] }),
      on: { NEXT: "done" },
    },
    done: { on: { RESET: "#turn.scoping" } },
  },
});

export async function save(thread, actor) {
  const seq = await nextSeq(thread, "xs");
  await putRow(thread, "xs", seq, String(seq), null, { snapshot: actor.getSnapshot() });
  return seq;
}

export async function restore(thread, seq) {
  const all = await rows(thread, "xs");
  const row = seq ? all.find((r) => Number(r.seq) === seq) : all[all.length - 1];
  if (!row) return null;
  return createActor(turnMachine, { snapshot: row.payload.snapshot });
}

export async function history(thread) {
  return rows(thread, "xs");
}

export { ensureTable, createActor };
