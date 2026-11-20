/**
 * LangGraph.js implementation of the copilot turn pipeline, checkpointed in
 * Octo so reload/redial/go-back are real cross-process operations.
 * Deterministic stub nodes: this experiment measures state machinery, not models.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ensureTable, putRow, rows, nextSeq, sql } from "./octo-store.mjs";

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

export class OctoSaver extends BaseCheckpointSaver {
  async getTuple(config) {
    const thread = config.configurable?.thread_id;
    const cid = config.configurable?.checkpoint_id;
    const all = await rows(thread, "lg");
    if (!all.length) return undefined;
    const row = cid ? all.find((r) => r.checkpoint_id === cid) : all[all.length - 1];
    if (!row) return undefined;
    return {
      config: { configurable: { thread_id: thread, checkpoint_ns: "", checkpoint_id: row.checkpoint_id } },
      checkpoint: row.payload.checkpoint,
      metadata: row.payload.metadata ?? {},
      parentConfig: row.parent_id
        ? { configurable: { thread_id: thread, checkpoint_ns: "", checkpoint_id: row.parent_id } }
        : undefined,
      pendingWrites: row.payload.writes ?? [],
    };
  }

  async *list(config, options) {
    const thread = config.configurable?.thread_id;
    const all = (await rows(thread, "lg")).reverse();
    let n = 0;
    for (const row of all) {
      if (options?.limit && n >= options.limit) return;
      n++;
      yield {
        config: { configurable: { thread_id: thread, checkpoint_ns: "", checkpoint_id: row.checkpoint_id } },
        checkpoint: row.payload.checkpoint,
        metadata: row.payload.metadata ?? {},
        parentConfig: row.parent_id
          ? { configurable: { thread_id: thread, checkpoint_ns: "", checkpoint_id: row.parent_id } }
          : undefined,
        pendingWrites: row.payload.writes ?? [],
      };
    }
  }

  async put(config, checkpoint, metadata) {
    const thread = config.configurable.thread_id;
    const seq = await nextSeq(thread, "lg");
    await putRow(thread, "lg", seq, checkpoint.id, config.configurable.checkpoint_id ?? null, {
      checkpoint, metadata, writes: [],
    });
    return { configurable: { thread_id: thread, checkpoint_ns: "", checkpoint_id: checkpoint.id } };
  }

  async putWrites(config, writes, taskId) {
    const thread = config.configurable.thread_id;
    const all = await rows(thread, "lg");
    const last = all[all.length - 1];
    if (!last) return;
    const payload = { ...last.payload, writes: [...(last.payload.writes ?? []), [taskId, writes]] };
    await sql(`UPDATE ri_console.turn_checkpoint SET payload = ${lit(JSON.stringify(payload))}::jsonb
      WHERE thread_id = ${lit(thread)} AND kind = 'lg' AND seq = ${last.seq}`);
  }
}

const State = Annotation.Root({
  slots: Annotation({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  log: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  stage: Annotation({ reducer: (_a, b) => b, default: () => "idle" }),
  detour: Annotation({ reducer: (_a, b) => b, default: () => false }),
  stall: Annotation({ reducer: (_a, b) => b, default: () => false }),
});

export function buildGraph(saver, { interruptBefore = [] } = {}) {
  const g = new StateGraph(State)
    .addNode("scope", (s) => ({ stage: "scoped", log: ["scope"] }))
    .addNode("retrieve", (s) => ({ stage: "retrieved", log: ["retrieve"], slots: { retrieved: true } }))
    .addNode("reason", (s) =>
      s.stall
        ? { stage: "stalled", log: ["stall"] }
        : { stage: "reasoned", log: [s.detour ? "detour" : "reason"], slots: { asked: true } })
    .addNode("validate", (s) => ({ stage: "validated", log: ["validate"] }))
    .addNode("act", (s) => ({ stage: "acted", log: ["act"], slots: { acted: true } }))
    .addNode("record", (s) => ({ stage: "recorded", log: ["record"], slots: { recorded: true } }))
    .addNode("fallback", (s) => ({ stage: "fallback", log: ["fallback"] }))
    .addEdge(START, "scope")
    .addEdge("scope", "retrieve")
    .addEdge("retrieve", "reason")
    .addConditionalEdges("reason", (s) => (s.stage === "stalled" ? "fallback" : "validate"))
    .addEdge("validate", "act")
    .addEdge("act", "record")
    .addEdge("record", END)
    .addEdge("fallback", END);
  return g.compile({ checkpointer: saver, interruptBefore });
}

export { ensureTable };
