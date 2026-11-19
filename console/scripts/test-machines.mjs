#!/usr/bin/env node
/**
 * RI-0010 machine contract tests.
 *
 * Runs the pure XState v5 machines under Node (type-stripping) and asserts the
 * trust/privacy invariants the product depends on:
 *   - a turn cannot stream before scoping completes (and scoping needs a pinned scope)
 *   - ABORT cancels an in-flight turn
 *   - fill-in cannot APPLY without a human APPROVE
 *   - a mission cannot REPLAN while healthily running
 *   - an approval cannot be DECIDED by a non-human
 *
 * Usage: node scripts/test-machines.mjs   (exit non-zero on any failure)
 */
import assert from "node:assert/strict";
import { createActor } from "xstate";
import { turnMachine } from "../src/machines/turnMachine.ts";
import { fillInMachine } from "../src/machines/fillInMachine.ts";
import { missionMachine, approvalMachine } from "../src/machines/workMachines.ts";

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error?.message ?? error}`);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const value = (actor) => actor.getSnapshot().value;
const context = (actor) => actor.getSnapshot().context;

const submit = (actor, scopePinned = true) =>
  actor.send({
    type: "SUBMIT",
    prompt: "What is moving this week?",
    scopeKind: "workspace",
    scopeId: null,
    scopePinned,
    route: "auto",
    reasoning: "off",
  });

/* ---------------------------------------------------------------- */
/* turnMachine                                                       */
/* ---------------------------------------------------------------- */

await check("turn: PART/DONE ignored before scoping", () => {
  const actor = createActor(turnMachine).start();
  assert.equal(value(actor), "idle");
  actor.send({ type: "PART", part: { kind: "text", text: "leak" } });
  actor.send({ type: "DONE", provider: "p", model: "m", reasoning: "off", parts: 1, dropped: 0 });
  assert.equal(value(actor), "idle");
  assert.equal(context(actor).parts.length, 0);
  actor.stop();
});

await check("turn: cannot stream while still scoping", () => {
  const actor = createActor(turnMachine).start();
  submit(actor);
  assert.equal(value(actor), "scoping");
  actor.send({ type: "PART", part: { kind: "text", text: "too early" } });
  actor.send({ type: "DONE", provider: "p", model: "m", reasoning: "off", parts: 1, dropped: 0 });
  assert.equal(value(actor), "scoping");
  assert.equal(context(actor).parts.length, 0);
  actor.stop();
});

await check("turn: scoping holds until scope is pinned", () => {
  const actor = createActor(turnMachine).start();
  submit(actor, false); // scope NOT pinned
  actor.send({ type: "PHASE", label: "Hybrid search: 3 matches" });
  assert.equal(value(actor), "scoping", "unpinned scope must not advance");
  actor.stop();
});

await check("turn: happy path scoping→…→done", () => {
  const actor = createActor(turnMachine).start();
  submit(actor);
  actor.send({ type: "PHASE", label: "Scoping the world digest" });
  assert.equal(value(actor), "scoping");
  actor.send({ type: "PHASE", label: "Hybrid search: 2 matches" });
  assert.equal(value(actor), "searching");
  actor.send({ type: "PHASE", label: "Routing to a provider" });
  assert.equal(value(actor), "routing");
  actor.send({ type: "PHASE", label: "Validating parts from openai" });
  assert.equal(value(actor), "streaming");
  actor.send({ type: "PART", part: { kind: "text", text: "answer" } });
  assert.equal(context(actor).parts.length, 1);
  actor.send({ type: "DONE", provider: "openai", model: "gpt-x", reasoning: "off", parts: 1, dropped: 0 });
  assert.equal(value(actor), "validating");
  assert.equal(context(actor).model, "gpt-x");
  actor.send({ type: "PHASE", label: "Persisting the thread" });
  assert.equal(value(actor), "persisting");
  actor.send({ type: "PHASE", label: "Thread persisted" });
  assert.equal(value(actor), "done");
  actor.stop();
});

await check("turn: ABORT cancels and aborts the fetch", () => {
  const actor = createActor(turnMachine).start();
  submit(actor);
  actor.send({ type: "PHASE", label: "Hybrid search: 1 match" });
  actor.send({ type: "PHASE", label: "Routing to a provider" });
  actor.send({ type: "PART", part: { kind: "text", text: "partial" } });
  assert.equal(value(actor), "streaming");
  const controller = context(actor).abortController;
  actor.send({ type: "ABORT" });
  assert.equal(value(actor), "cancelled");
  assert.equal(controller.signal.aborted, true, "ABORT must abort the fetch");
  actor.stop();
});

await check("turn: ERROR lands in fallback", () => {
  const actor = createActor(turnMachine).start();
  submit(actor);
  actor.send({ type: "ERROR", message: "provider down" });
  assert.equal(value(actor), "fallback");
  assert.equal(context(actor).error, "provider down");
  actor.stop();
});

/* ---------------------------------------------------------------- */
/* fillInMachine                                                     */
/* ---------------------------------------------------------------- */

const completeDesign = {
  missionName: "Re-engage Acme",
  objectiveTarget: "Book a follow-up call",
  due: "2026-12-01T00:00:00.000Z",
  agentIds: ["research"],
};

await check("fillIn: collects missing required fields as questions", () => {
  const actor = createActor(fillInMachine, { input: { design: { missionName: "Half" } } }).start();
  assert.equal(value(actor), "collecting");
  assert.ok(context(actor).questions.length >= 3, "should ask for the missing fields");
  actor.send({ type: "ANSWER", field: "objectiveTarget", value: "Ship it" });
  actor.send({ type: "ANSWER", field: "due", value: "2026-12-01" });
  actor.send({ type: "ANSWER", field: "agentIds", value: ["research"] });
  assert.equal(value(actor), "proposing");
  assert.equal(context(actor).questions.length, 0);
  actor.stop();
});

await check("fillIn: APPLY rejected without APPROVE", () => {
  const actor = createActor(fillInMachine, { input: { design: completeDesign } }).start();
  assert.equal(value(actor), "proposing");
  assert.ok(context(actor).proposal, "proposal payload built");
  actor.send({ type: "APPLY" });
  assert.equal(value(actor), "proposing", "APPLY must be rejected before APPROVE");
  actor.send({ type: "APPROVE" });
  assert.equal(value(actor), "applying");
  actor.send({ type: "APPLY" });
  assert.equal(value(actor), "done");
  const output = actor.getSnapshot().output;
  assert.equal(output.missionName, "Re-engage Acme");
  assert.equal(output.autonomy, "approve", "conservative human-gated default");
  assert.ok(Array.isArray(output.unverified) && output.unverified.length > 0, "model output stays flagged");
  actor.stop();
});

/* ---------------------------------------------------------------- */
/* missionMachine                                                    */
/* ---------------------------------------------------------------- */

await check("mission: REPLAN rejected from running", () => {
  const actor = createActor(missionMachine, { input: { missionId: "m1", quietWindowMs: 60_000 } }).start();
  assert.equal(value(actor), "queued");
  actor.send({ type: "START" });
  assert.equal(value(actor), "running");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "running", "a healthy running mission is never re-planned");
  actor.stop();
});

await check("mission: REPLAN allowed from blocked", () => {
  const actor = createActor(missionMachine, { input: { missionId: "m1", quietWindowMs: 60_000 } }).start();
  actor.send({ type: "START" });
  actor.send({ type: "BLOCK", reason: "waiting on a decision" });
  assert.equal(value(actor), "blocked");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "queued");
  assert.equal(context(actor).replans, 1);
  actor.stop();
});

await check("mission: quiet window stalls a running mission, then REPLAN recovers", async () => {
  const actor = createActor(missionMachine, { input: { missionId: "m1", quietWindowMs: 40 } }).start();
  actor.send({ type: "START" });
  assert.equal(value(actor), "running");
  await sleep(90);
  assert.equal(value(actor), "stalled", "running goes stalled after the quiet window");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "queued");
  actor.stop();
});

await check("mission: PROGRESS resets the quiet window", async () => {
  const actor = createActor(missionMachine, { input: { missionId: "m1", quietWindowMs: 70 } }).start();
  actor.send({ type: "START" });
  await sleep(45);
  actor.send({ type: "PROGRESS" }); // restarts the timer
  await sleep(45);
  assert.equal(value(actor), "running", "progress within the window keeps it running");
  actor.stop();
});

/* ---------------------------------------------------------------- */
/* approvalMachine                                                   */
/* ---------------------------------------------------------------- */

await check("approval: DECIDE rejected without a human actor", () => {
  const actor = createActor(approvalMachine, { input: { approvalId: "a1" } }).start();
  assert.equal(value(actor), "pending");
  actor.send({ type: "DECIDE", decision: "approved", actor: "agent" });
  assert.equal(value(actor), "pending", "an agent cannot decide");
  actor.send({ type: "DECIDE", decision: "approved", actor: "human" });
  assert.equal(value(actor), "approved");
  assert.equal(context(actor).actor, "human");
  actor.stop();
});

await check("approval: human can decline", () => {
  const actor = createActor(approvalMachine, { input: { approvalId: "a2" } }).start();
  actor.send({ type: "DECIDE", decision: "declined", actor: "human", note: "not now" });
  assert.equal(value(actor), "declined");
  assert.equal(context(actor).note, "not now");
  actor.stop();
});

if (failures > 0) {
  console.error(`\n${failures} machine contract test(s) failed.`);
  process.exit(1);
}
console.log("\nAll machine contract tests passed.");
