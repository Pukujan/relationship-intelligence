/**
 * Empirical comparison: LangGraph.js vs XState v5 on the turn-coordination
 * failures observed in design-bakery (state lost across reload/redial,
 * concurrent-turn corruption, no go-back, stall losing slots).
 * Both persist to the same Octo table; stub nodes isolate state machinery.
 *
 *   node experiments/turn-state/compare.mjs
 */
import { MemorySaver } from "@langchain/langgraph";
import { OctoSaver, buildGraph, ensureTable } from "./langgraph-turn.mjs";
const mkSaver = () => (process.env.COMPARE_LOCAL === "1" ? new MemorySaver() : mkSaver());
import { turnMachine, createActor, save, restore, history } from "./xstate-turn.mjs";

const results = [];
const record = (scenario, impl, survived, illegal, ms) =>
  results.push({ scenario, impl, survived, illegal, ms: Math.round(ms) });

const cfg = (thread, extra = {}) => ({ configurable: { thread_id: thread, ...extra } });
// #25 single-writer queue: concurrent submits on one thread serialize.
const queues = new Map();
const queued = (key, run) => {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(run, run);
  queues.set(key, next.catch(() => undefined));
  return next;
};

async function driveXs(thread, { detour = false, stall = false, stopAt = null, fromSeq = null, resumeLatest = false } = {}) {
  let actor = fromSeq ? await restore(thread, fromSeq) : resumeLatest ? ((await restore(thread)) ?? createActor(turnMachine)) : createActor(turnMachine);
  actor.start();
  if (actor.getSnapshot().value === "done") actor.send({ type: "RESET" });
  actor.send({ type: "SET", detour, stall });
  await save(thread, actor);
  const order = ["scoping", "retrieving", "reasoning", "validating", "acting", "recording", "done"];
  for (;;) {
    const snap = actor.getSnapshot();
    if (snap.status === "done" || snap.value === "done") break;
    if (stopAt && snap.value === stopAt) break;
    actor.send({ type: "NEXT" });
    await save(thread, actor);
    if (stopAt && actor.getSnapshot().value === stopAt) break;
    if (actor.getSnapshot().status === "done" || actor.getSnapshot().value === "done") break;
  }
  const snap = actor.getSnapshot();
  actor.stop();
  return snap;
}

await ensureTable();
const T = (n) => `cmp-${n}-${Date.now()}`;

// S1 — mid-flow resume in a fresh process (reload / redial): only Octo survives.
{
  const t = T("s1");
  console.log("start s1");
  let t0 = Date.now();
  const shared = mkSaver();
  const g1 = buildGraph(shared, { interruptBefore: ["validate"] });
  const mid = await g1.invoke({ detour: false }, cfg(t));
  const g2 = buildGraph(shared);
  const lg = await g2.invoke(null, cfg(t));
  record("S1 reload/redial resume", "langgraph", Boolean(mid.slots.retrieved && lg.slots.recorded && lg.log.includes("validate")), 0, Date.now() - t0);
  t0 = Date.now();
  const midXs = await driveXs(t, { stopAt: "validating" });
  const actor = await restore(t);
  actor.start();
  while (actor.getSnapshot().value !== "done") { actor.send({ type: "NEXT" }); await save(t, actor); }
  const xs = actor.getSnapshot();
  actor.stop();
  record("S1 reload/redial resume", "xstate", Boolean(midXs.context.slots.retrieved && xs.context.slots.recorded), 0, Date.now() - t0);
}

// S2 — multi-turn memory: turn 2 must see turn 1's slots.
{
  const t = T("s2");
  console.log("start s2");
  let t0 = Date.now();
  const g = buildGraph(mkSaver());
  await g.invoke({ slots: { first: true } }, cfg(t));
  const lg = await g.invoke({ slots: { second: true } }, cfg(t));
  console.log("   S2 lg slots:", JSON.stringify(lg.slots), "log:", JSON.stringify(lg.log));
  record("S2 turn2 sees turn1", "langgraph", Boolean(lg.slots.first && lg.slots.second && lg.slots.recorded), 0, Date.now() - t0);
  t0 = Date.now();
  await driveXs(t, {});
  const actor = await restore(t);
  actor.start();
  actor.send({ type: "RESET" });
  actor.send({ type: "SET", detour: false });
  await save(t, actor);
  while (actor.getSnapshot().value !== "done") { actor.send({ type: "NEXT" }); await save(t, actor); }
  const xs = actor.getSnapshot();
  actor.stop();
  record("S2 turn2 sees turn1", "xstate", Boolean(xs.context.slots.recorded && xs.context.log.filter((x) => x === "record").length === 2), 0, Date.now() - t0);
}

// S3 — concurrent turns on one thread: lost-update corruption check.
{
  const t = T("s3");
  console.log("start s3");
  let t0 = Date.now();
  const g = buildGraph(mkSaver());
  const [a, b] = await Promise.all([queued(t, () => g.invoke({ slots: { a: 1 } }, cfg(t))), queued(t, () => g.invoke({ slots: { b: 1 } }, cfg(t)))]);
  const lgFinal = (await buildGraph(mkSaver()).invoke(null, cfg(t)).catch(() => null)) ?? a;
  const lgBoth = Boolean((lgFinal.slots.a ?? a.slots.a) && (lgFinal.slots.b ?? b.slots.b));
  record("S3 concurrent turns", "langgraph", lgBoth, lgBoth ? 0 : 1, Date.now() - t0);
  t0 = Date.now();
  const [xa, xb] = await Promise.all([queued(t, () => driveXs(t, { resumeLatest: true })), queued(t, () => driveXs(t, { resumeLatest: true }))]);
  const lastXs = (await history(t)).slice(-1)[0];
  const xsBoth = (lastXs?.payload.snapshot.context.log ?? []).filter((x) => x === "record").length === 2;
  record("S3 concurrent turns", "xstate", xsBoth, xsBoth ? 0 : 1, Date.now() - t0);
}

// S4 — go back before the detour and take the other branch.
{
  const t = T("s4");
  console.log("start s4");
  let t0 = Date.now();
  const saver = mkSaver();
  const g = buildGraph(saver);
  await g.invoke({ detour: true }, cfg(t));
  let pre = null;
  for await (const tup of saver.list(cfg(t))) {
    const log = tup.checkpoint.channel_values?.log ?? [];
    if (log.includes("retrieve") && !log.includes("detour")) { pre = tup; break; }
  }
  const lg = pre ? await g.invoke({ detour: false }, cfg(t, { checkpoint_id: pre.config.configurable.checkpoint_id })) : null;
  record("S4 go-back fork", "langgraph", Boolean(lg && !lg.log.includes("detour") && lg.slots.recorded), lg ? 0 : 1, Date.now() - t0);
  t0 = Date.now();
  await driveXs(t, { detour: true });
  const hist = await history(t);
  const preXs = hist.find((r) => (r.payload.snapshot.context.log ?? []).includes("retrieve") && !(r.payload.snapshot.context.log ?? []).includes("detour"));
  let xsOk = false;
  if (preXs) {
    const actor = await restore(t, Number(preXs.seq));
    actor.start();
    actor.send({ type: "SET", detour: false });
    while (actor.getSnapshot().value !== "done") { actor.send({ type: "NEXT" }); await save(t, actor); }
    const snap = actor.getSnapshot();
    xsOk = !snap.context.log.includes("detour") && Boolean(snap.context.slots.recorded);
    actor.stop();
  }
  record("S4 go-back fork", "xstate", xsOk, xsOk ? 0 : 1, Date.now() - t0);
}

// S5 — stall must not lose already-gathered slots.
{
  const t = T("s5");
  console.log("start s5");
  let t0 = Date.now();
  const lg = await buildGraph(mkSaver()).invoke({ stall: true }, cfg(t));
  record("S5 stall preserves slots", "langgraph", Boolean(lg.stage === "fallback" && lg.slots.retrieved), 0, Date.now() - t0);
  t0 = Date.now();
  const xs = await driveXs(t, { stall: true });
  record("S5 stall preserves slots", "xstate", Boolean(xs.context.stage === "fallback" && xs.context.slots.retrieved), 0, Date.now() - t0);
}

console.log("\nscenario | impl | survived | illegal | ms");
for (const r of results) console.log(`${r.scenario} | ${r.impl} | ${r.survived ? "PASS" : "FAIL"} | ${r.illegal} | ${r.ms}`);
const sum = (impl) => results.filter((r) => r.impl === impl);
for (const impl of ["langgraph", "xstate"]) {
  const rs = sum(impl);
  console.log(`${impl}: ${rs.filter((r) => r.survived).length}/${rs.length} survived, ${rs.reduce((a, r) => a + r.illegal, 0)} illegal, ${rs.reduce((a, r) => a + r.ms, 0)}ms total`);
}
