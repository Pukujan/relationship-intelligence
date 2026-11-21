#!/usr/bin/env node
/**
 * RI-0010 machine contract tests.
 *
 * Runs the pure XState v5 machines under Node (type-stripping) and asserts the
 * trust/privacy invariants the product depends on:
 *   - a turn cannot stream before scoping completes (and scoping needs a pinned scope)
 *   - ABORT cancels an in-flight turn
 *   - fill-in cannot APPLY without a human APPROVE
 *   - a milestone cannot REPLAN while healthily running
 *   - an approval cannot be DECIDED by a non-human
 *
 * Usage: node scripts/test-machines.mjs   (exit non-zero on any failure)
 */
import assert from "node:assert/strict";
import { createActor } from "xstate";
import { turnMachine } from "../src/machines/turnMachine.ts";
import { fillInMachine } from "../src/machines/fillInMachine.ts";
import { milestoneMachine, approvalMachine } from "../src/machines/workMachines.ts";
import { isConversationOver, parseVoiceCommand, resolveConfirmation } from "../src/lib/voiceCommands.ts";
import { resolveThreadEntry } from "../src/lib/threadEntry.ts";
import { buildProfile, parseNote, POST_SNIPPET_MAX, snippet, tidy } from "../src/lib/profileSections.ts";
import { allowed, askWithFailover, authHeaders, parseChain, parseModelJson } from "../server/providers.ts";

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
/* milestoneMachine                                                    */
/* ---------------------------------------------------------------- */

await check("milestone: REPLAN rejected from running", () => {
  const actor = createActor(milestoneMachine, { input: { milestoneId: "m1", quietWindowMs: 60_000 } }).start();
  assert.equal(value(actor), "queued");
  actor.send({ type: "START" });
  assert.equal(value(actor), "running");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "running", "a healthy running milestone is never re-planned");
  actor.stop();
});

await check("milestone: REPLAN allowed from blocked", () => {
  const actor = createActor(milestoneMachine, { input: { milestoneId: "m1", quietWindowMs: 60_000 } }).start();
  actor.send({ type: "START" });
  actor.send({ type: "BLOCK", reason: "waiting on a decision" });
  assert.equal(value(actor), "blocked");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "queued");
  assert.equal(context(actor).replans, 1);
  actor.stop();
});

await check("milestone: quiet window stalls a running milestone, then REPLAN recovers", async () => {
  const actor = createActor(milestoneMachine, { input: { milestoneId: "m1", quietWindowMs: 40 } }).start();
  actor.send({ type: "START" });
  assert.equal(value(actor), "running");
  await sleep(90);
  assert.equal(value(actor), "stalled", "running goes stalled after the quiet window");
  actor.send({ type: "REPLAN" });
  assert.equal(value(actor), "queued");
  actor.stop();
});

await check("milestone: PROGRESS resets the quiet window", async () => {
  const actor = createActor(milestoneMachine, { input: { milestoneId: "m1", quietWindowMs: 70 } }).start();
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

// --- Voice commands (#59): a spoken word writes to the real approval inbox ---

await check("voice: plain commands map to one action", () => {
  assert.equal(parseVoiceCommand("approve"), "approve");
  assert.equal(parseVoiceCommand("Yes, go ahead."), "approve");
  assert.equal(parseVoiceCommand("decline"), "decline");
  assert.equal(parseVoiceCommand("no"), "decline");
  assert.equal(parseVoiceCommand("skip that one"), "skip");
  assert.equal(parseVoiceCommand("end call"), "end");
});

await check("voice: negated, mixed or long speech decides nothing", () => {
  for (const heard of [
    "don't approve",
    "do not approve that",
    "never approve",
    "approve, no wait",
    "yes skip",
    "maybe approve",
    "",
    "disapprove",
    "I think we should approve this one after the dinner next week",
  ]) {
    assert.equal(parseVoiceCommand(heard), null, heard);
  }
});

// Metamorphic: changing how a phrase is written must not change what it means,
// and adding a negation must never turn anything into an approval.
await check("voice (metamorphic): case, punctuation and spacing do not change the action", () => {
  const phrases = ["approve", "yes", "do it", "decline", "nope", "skip", "next", "hang up", "don't approve", "hello there"];
  const rewrites = [
    (t) => t.toUpperCase(),
    (t) => `  ${t}  `,
    (t) => `${t}!!!`,
    (t) => t.replace(/ /g, "   "),
    (t) => `${t}.`,
    (t) => t.replace(/'/g, "\u2019"),
  ];
  for (const phrase of phrases) {
    const expected = parseVoiceCommand(phrase);
    for (const rewrite of rewrites) {
      assert.equal(parseVoiceCommand(rewrite(phrase)), expected, rewrite(phrase));
    }
  }
});

await check("voice (metamorphic): adding a negation never produces an approval", () => {
  const approvals = ["approve", "approved", "yes", "yep", "yeah", "do it", "go ahead", "send it"];
  const negations = ["don't", "do not", "not", "never", "wait", "cancel", "maybe", "no"];
  for (const phrase of approvals) {
    assert.equal(parseVoiceCommand(phrase), "approve", phrase);
    for (const negation of negations) {
      for (const heard of [`${negation} ${phrase}`, `${phrase} ${negation}`]) {
        assert.notEqual(parseVoiceCommand(heard), "approve", heard);
      }
    }
  }
});

// --- Provider chain (#62): which model answers, and in what order ---

await check("providers: a chain spec parses to provider and model pairs", () => {
  assert.deepEqual(parseChain("workbuddy/hy4flash-free, anthropic/claude-haiku-5-5"), [
    ["workbuddy", "hy4flash-free"],
    ["anthropic", "claude-haiku-5-5"],
  ]);
  // Model ids keep their own slashes and colons; a bare provider means its default.
  assert.deepEqual(parseChain("inferhub/alitp/qwen4-max-preview,openrouter"), [
    ["inferhub", "alitp/qwen4-max-preview"],
    ["openrouter", ""],
  ]);
  assert.deepEqual(parseChain(undefined), []);
  assert.deepEqual(parseChain(" , ,"), []);
});

await check("providers (metamorphic): spacing and empty entries do not change a chain", () => {
  const spec = "qwen/qwen4-max-preview,anthropic/claude-sonnet-5-5,workbuddy";
  const expected = parseChain(spec);
  for (const rewrite of [
    (t) => t.replace(/,/g, " , "),
    (t) => `  ${t}  `,
    (t) => `${t},`,
    (t) => t.replace(/,/g, ",,"),
  ]) {
    assert.deepEqual(parseChain(rewrite(spec)), expected, rewrite(spec));
  }
});

await check("providers: an allow-list keeps Opus out and a key style picks the header", () => {
  const claude = { id: "anthropic", key: "k", auth: "x-api-key", allow: /haiku|sonnet/ };
  assert.equal(allowed(claude, "claude-sonnet-5-5"), true);
  assert.equal(allowed(claude, "claude-haiku-5-5"), true);
  assert.equal(allowed(claude, "claude-opus-5-5"), false);
  assert.equal(allowed({ id: "qwen", key: "k" }, "anything"), true);
  assert.deepEqual(authHeaders(claude), { "x-api-key": "k" });
  assert.deepEqual(authHeaders({ id: "qwen", key: "k" }), { Authorization: "Bearer k" });
});

await check("providers: a model answer wrapped in a one-item array is unwrapped", () => {
  assert.deepEqual(parseModelJson('[{"missionName":"x"}]'), { missionName: "x" });
  assert.deepEqual(parseModelJson('{"missionName":"x"}'), { missionName: "x" });
  // Anything else is left for the schema check to reject.
  assert.deepEqual(parseModelJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseModelJson("[]"), []);
  assert.deepEqual(parseModelJson("[[1]]"), [[1]]);
});

await check("providers: a wrong-shaped answer fails over to the next model", async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    asked.push(model);
    const content = model === "bad" ? '{"oops":true}' : '{"ok":true}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const provider = { id: "p", displayName: "P", baseUrl: "https://example.test", key: "k", reasoning: "none", seedModels: [] };
    const result = await askWithFailover(
      [{ provider, model: "bad" }, { provider, model: "good" }],
      "system", "user", "off", 5_000, undefined,
      (content) => { if (!JSON.parse(content).ok) throw new Error("wrong shape"); },
    );
    assert.equal(result.model, "good");
    assert.equal(result.failovers, 1);
    assert.deepEqual(asked, ["bad", "good"]);
    // With no second route, the wrong shape is an error, never a silent pass.
    await assert.rejects(
      askWithFailover([{ provider, model: "bad" }], "system", "user", "off", 5_000, undefined,
        (content) => { if (!JSON.parse(content).ok) throw new Error("wrong shape"); }),
      /wrong shape/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- Voice conversation (#69): the model suggests, only the person's word records ---

await check("voice: a read-back decision needs a clear yes", () => {
  for (const heard of ["yes", "Yes.", "yep", "go ahead", "approve", "do it"]) {
    assert.equal(resolveConfirmation(heard), "confirm", heard);
  }
  for (const heard of ["no", "nope", "decline", "skip", "end call"]) {
    assert.equal(resolveConfirmation(heard), "cancel", heard);
  }
  for (const heard of ["", "hmm", "what does that mean", "not yet", "don't", "yes no", "maybe yes",
    "yes but change the subject line before you send it out"]) {
    assert.equal(resolveConfirmation(heard), "unclear", heard);
  }
});

await check("voice (metamorphic): adding doubt or negation never confirms", () => {
  const yeses = ["yes", "yep", "yeah", "go ahead", "approve", "do it", "send it"];
  const doubts = ["don't", "do not", "not", "never", "wait", "cancel", "maybe", "no"];
  for (const yes of yeses) {
    assert.equal(resolveConfirmation(yes), "confirm", yes);
    for (const doubt of doubts) {
      for (const heard of [`${doubt} ${yes}`, `${yes} ${doubt}`]) {
        assert.notEqual(resolveConfirmation(heard), "confirm", heard);
      }
    }
  }
});

await check("voice: a short sign-off ends a conversation, a question does not", () => {
  for (const heard of ["thanks", "Thank you!", "that's all", "stop", "bye", "never mind"]) {
    assert.equal(isConversationOver(heard), true, heard);
  }
  for (const heard of ["", "who should I thank this week", "stopwatch", "what stops the Aster renewal from closing this month"]) {
    assert.equal(isConversationOver(heard), false, heard);
  }
});

/* ---------------------------------------------------------------- */
/* threadEntry                                                       */
/* ---------------------------------------------------------------- */

await check("thread: a seeded arrival opens a fresh draft, never the active thread", () => {
  const entry = resolveThreadEntry({ seed: "Draft a note to Ronald Rosales" }, ["t-old", "t-older"]);
  assert.equal(entry.draft, true);
  assert.equal(entry.activeId, null);
  assert.equal(entry.seed, "Draft a note to Ronald Rosales");
});

await check("thread: a seeded scope pins the new thread", () => {
  const entry = resolveThreadEntry({ seed: "Research X", scope: { kind: "person", id: "p-1" } }, ["t-old"]);
  assert.deepEqual(entry.scope, { kind: "person", id: "p-1" });
  assert.equal(entry.draft, true);
});

await check("thread: an unseeded arrival resumes the newest open thread", () => {
  const entry = resolveThreadEntry(null, ["t-new", "t-old"]);
  assert.equal(entry.draft, false);
  assert.equal(entry.activeId, "t-new");
  assert.deepEqual(entry.scope, { kind: "workspace", id: null });
});

await check("thread: an unseeded arrival with no threads stays blank", () => {
  const entry = resolveThreadEntry(null, []);
  assert.equal(entry.activeId, null);
  assert.equal(entry.draft, false);
  assert.equal(entry.seed, "");
});

/* ---------------------------------------------------------------- */
/* profile sections (#93)                                            */
/* ---------------------------------------------------------------- */

const claimOf = (id, text, extra = {}) => ({
  id,
  personId: "p-1",
  text,
  source: { label: "Octo ledger", kind: "note", date: "2026-11-10T00:00:00.000Z" },
  confidence: "medium",
  status: "unverified",
  ...extra,
});
const sourcedOf = (id, text, locator, extra = {}) =>
  claimOf(id, text, {
    status: "sourced",
    source: { label: "linkedin.com", kind: "web", date: "2026-11-12T00:00:00.000Z", locator },
    ...extra,
  });

const profileClaims = [
  sourcedOf("c-url", "Jane Doe's LinkedIn profile is https://www.linkedin.com/in/jane-doe", "https://www.linkedin.com/in/jane-doe", { verb: "FACT", attribute: "linkedin_url" }),
  sourcedOf("c-role", "Jane Doe, public role summary: Product designer at Aster", "https://www.linkedin.com/in/jane-doe", { verb: "FACT", attribute: "public_role_summary" }),
  sourcedOf("c-edu", "Jane Doe, public education: NYU, MS Integrated Design & Media", "https://www.linkedin.com/in/jane-doe", { verb: "FACT", attribute: "public_education" }),
  sourcedOf("c-post", `Jane Doe, linkedin post: ${"We shipped the wayfinding pilot today. ".repeat(12)}`, "https://www.linkedin.com/posts/jane-doe-1", { verb: "FACT", attribute: "linkedin_post" }),
  claimOf("c-met", "Jane Doe knows Pujan (met-once)", { verb: "MET", basis: "Met at GIS Day after the panel" }),
  claimOf("c-stage", "[UNVERIFIED] Jane Doe: (relationship stage) met in person", { verb: "UNVERIFIED" }),
  claimOf("c-self", "[UNVERIFIED] Jane Doe: (self reported) Founder at Stealth Co", { verb: "UNVERIFIED" }),
  claimOf("c-metat", "[UNVERIFIED] Jane Doe: (self reported) met at NYU GIS Day 2026", { verb: "UNVERIFIED" }),
  claimOf("c-metat2", "[UNVERIFIED] Jane Doe: (self reported) met at A rooftop mixer", { verb: "UNVERIFIED", source: { label: "Octo ledger", kind: "note", date: "2026-10-01T00:00:00.000Z" } }),
  claimOf("c-log", "[UNVERIFIED] Jane Doe: (private interaction log; email, follow_up, done) Sent the deck. At NYU GIS Day 2026. Next step: intro to MTA.", { verb: "UNVERIFIED", source: { label: "Octo ledger", kind: "note", date: "2026-11-19T00:00:00.000Z" } }),
  claimOf("c-unv-edu", "Jane Doe, public education: Unverified School", { verb: "FACT", attribute: "public_education" }),
];
const profileEvents = [
  { id: "e-gis", name: "NYU GIS Day 2026", date: "2026-11-18T00:00:00.000Z", location: "", type: "community", attendeeIds: ["p-1"], goal: "", agentId: "", status: "past" },
];
const profileInput = (claims = profileClaims) => ({
  name: "Jane Doe",
  role: "Product designer at Aster",
  companyName: "",
  claims,
  events: profileEvents,
});

await check("profile: headline, experience and education read only sourced claims", () => {
  const view = buildProfile(profileInput());
  assert.equal(view.headline, "Product designer at Aster");
  assert.deepEqual(view.experience.map((e) => e.title), ["Product designer at Aster"]);
  assert.deepEqual(view.education.map((e) => e.title), ["NYU, MS Integrated Design & Media"]);
  const profileText = JSON.stringify([view.headline, view.about, view.experience, view.education, view.projects, view.credentials, view.posts]);
  assert.ok(!profileText.includes("Stealth Co"), "an unverified role leaked into the profile");
  assert.ok(!profileText.includes("Unverified School"), "an unverified education fact leaked into the profile");
  assert.ok(view.notes.some((n) => n.text.includes("Stealth Co")), "the unverified role is kept as a note");
});

await check("profile: a post shows a capped snippet, never the whole post", () => {
  const view = buildProfile(profileInput());
  assert.equal(view.posts.length, 1);
  const [post] = view.posts;
  assert.ok(post.snippet.length <= POST_SNIPPET_MAX, `snippet is ${post.snippet.length} chars`);
  assert.ok(post.snippet.endsWith("…"));
  assert.equal(post.url, "https://www.linkedin.com/posts/jane-doe-1");
  assert.equal(snippet("short text"), "short text");
});

await check("profile: a met-at note folds into its event; an unmatched one stays a note", () => {
  const view = buildProfile(profileInput());
  const gis = view.eventLog.filter((e) => e.title.includes("GIS Day") && e.kind !== "log");
  assert.equal(gis.length, 1, "the event appears once");
  assert.equal(gis[0].kind, "event");
  assert.equal(gis[0].unverified, true, "attendance known only from a note stays unverified");
  assert.ok(view.eventLog.some((e) => e.kind === "note" && e.title === "Met at A rooftop mixer"));
});

await check("profile: event log is newest first and parses interaction logs", () => {
  const view = buildProfile(profileInput());
  const dated = view.eventLog.filter((e) => e.date).map((e) => e.date);
  assert.deepEqual(dated, [...dated].sort().reverse());
  const log = view.eventLog.find((e) => e.kind === "log");
  assert.equal(log.title, "Sent the deck");
  assert.equal(log.meta, "email · follow up · done");
  assert.equal(log.unverified, true);
  const met = view.eventLog.find((e) => e.kind === "met");
  assert.equal(met.detail, "Met at GIS Day after the panel");
  assert.equal(met.meta, "Met in person");
});

await check("profile: stage and LinkedIn link are lifted out, not listed as notes", () => {
  const view = buildProfile(profileInput());
  assert.equal(view.stage, "met in person");
  assert.equal(view.linkedinUrl, "https://www.linkedin.com/in/jane-doe");
  assert.ok(!view.notes.some((n) => n.text.includes("relationship stage")));
  assert.deepEqual(parseNote("[UNVERIFIED] Jane Doe: (documented) Speaks at meetups"), { tag: "documented", body: "Speaks at meetups" });
  assert.equal(tidy("held self reported"), "held (self-reported)");
  assert.equal(tidy("(self reported) Founder at X"), "(self-reported) Founder at X");
  assert.equal(tidy("not a conclusion.. Next topic"), "not a conclusion. Next topic");
});

await check("profile: claim order never changes the profile (metamorphic)", () => {
  const base = buildProfile(profileInput());
  for (let seed = 1; seed <= 6; seed += 1) {
    const shuffled = [...profileClaims]
      .map((claim, index) => ({ claim, key: (index * 7 + seed * 13) % profileClaims.length }))
      .sort((a, b) => a.key - b.key)
      .map(({ claim }) => claim);
    assert.deepEqual(buildProfile(profileInput(shuffled)), base);
  }
  assert.deepEqual(buildProfile(profileInput([...profileClaims].reverse())), base);
});

await check("profile: a person with no claims gets empty sections, never sample data", () => {
  const view = buildProfile({ name: "New Person", role: "—", companyName: "", claims: [], events: [] });
  assert.equal(view.headline, "");
  assert.equal(view.about, "");
  for (const key of ["experience", "education", "projects", "credentials", "posts", "eventLog", "notes", "sources"]) {
    assert.equal(view[key].length, 0, `${key} should be empty`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} machine contract test(s) failed.`);
  process.exit(1);
}
console.log("\nAll machine contract tests passed.");
