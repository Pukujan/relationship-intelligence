/**
 * Metamorphic relations for autonomous execution (RI-0022, docs/VALIDATION.md).
 * Properties compare canonical/operational state excluding run ids and
 * timestamps, per the validation contract.
 */
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentRunAnswer,
  applyAgentAnswer,
  buildDigest,
  enqueueAgentRuns,
  executeRun,
} from "../server/executor.js";
import {
  CTX,
  createMock,
  docOf,
  installMock,
  makeWorld,
  putDoc,
} from "./executorHarness.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const world = makeWorld({
  people: [
    {
      id: "p-1",
      name: "Zoe",
      role: "",
      companyId: "",
      location: "",
      timezone: "",
      strength: 3,
      warmth: "warm",
      lastContact: "2026-11-01T00:00:00Z",
      tags: [],
      summary: "",
      email: "",
      claims: [],
    },
  ],
});
const digest = buildDigest(world);

const noteArb = fc.record({
  kind: fc.constant("note" as const),
  text: fc.string({ minLength: 1, maxLength: 40 }),
  personId: fc.option(fc.constantFrom("p-1", "ghost"), { nil: undefined }),
});
const approvalArb = fc.record({
  kind: fc.constant("approval" as const),
  approvalKind: fc.constantFrom("send", "call", "publish"),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  proposedAction: fc.string({ minLength: 1, maxLength: 60 }),
  reason: fc.string({ maxLength: 20 }),
  risk: fc.constantFrom("low", "medium", "high"),
  personId: fc.option(fc.constantFrom("p-1", "ghost"), { nil: undefined }),
});
const answerArb: fc.Arbitrary<AgentRunAnswer> = fc.record({
  summary: fc.string({ minLength: 1, maxLength: 60 }),
  findings: fc.array(
    fc.record({
      text: fc.string({ minLength: 1, maxLength: 40 }),
      personId: fc.option(fc.constantFrom("p-1", "ghost"), { nil: undefined }),
    }),
    { maxLength: 3 },
  ),
  actions: fc.array(fc.oneof(noteArb, approvalArb), { maxLength: 6 }),
  dropped: fc.nat({ max: 5 }),
  provider: fc.constant("mock"),
  model: fc.constant("mock-model"),
});

/** Operational write set, normalized: no ids, no timestamps. */
const writeSet = (state: ReturnType<typeof createMock>, ws = "ws-a") => {
  const rows: string[] = [];
  for (const [tableName, t] of state.tables) {
    if (!["note", "approval", "activity", "plan"].includes(tableName)) continue;
    for (const row of t.values()) {
      if (row.workspace_id !== ws) continue;
      const doc = row.doc as Record<string, unknown>;
      rows.push(
        JSON.stringify({
          table: tableName,
          title: doc.title ?? "",
          body: doc.body ?? doc.proposedAction ?? "",
          personIds: doc.personIds ?? [doc.personId].filter(Boolean),
          status: doc.status ?? "",
          kind: doc.kind ?? "",
        }),
      );
    }
  }
  return rows.sort();
};

describe("MR-E1 double tick over the same due slot yields one run", () => {
  it("holds for arbitrary dates and agent names", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .date({ min: new Date("2026-01-01"), max: new Date("2030-01-01") })
          .filter((d) => !Number.isNaN(d.getTime())),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (now, name) => {
          const state = createMock();
          installMock(state);
          putDoc(state, "agent", {
            id: "a1",
            name,
            cadence: "daily",
            principalId: "p1",
          });
          await enqueueAgentRuns(CTX, makeWorld(), now);
          const agentRow = state.tables.get("agent")?.get("a1");
          docOf(agentRow).nextRunAt = new Date(
            now.getTime() - 1000,
          ).toISOString();
          await enqueueAgentRuns(CTX, makeWorld(), now);
          expect(state.tables.get("agent_run")?.size).toBe(1);
          vi.unstubAllGlobals();
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("MR-E2 action and signal order never changes the write set", () => {
  it("holds for arbitrary action lists under permutation", async () => {
    await fc.assert(
      fc.asyncProperty(answerArb, async (answer) => {
        const stateA = createMock();
        installMock(stateA);
        await applyAgentAnswer(
          CTX,
          { id: "a1", autonomyZone: "suggest" },
          answer,
          digest,
          "p1",
        );
        const setA = writeSet(stateA);
        vi.unstubAllGlobals();
        const stateB = createMock();
        installMock(stateB);
        const shuffled = {
          ...answer,
          actions: [...answer.actions].reverse(),
          findings: [...answer.findings].reverse(),
        };
        await applyAgentAnswer(
          CTX,
          { id: "a1", autonomyZone: "suggest" },
          shuffled,
          digest,
          "p1",
        );
        expect(writeSet(stateB)).toEqual(setA);
        vi.unstubAllGlobals();
      }),
      { numRuns: 25 },
    );
  });
});

describe("MR-E3 unrelated workspace interleaving leaves workspace A unchanged", () => {
  it("holds while workspace B runs its own agents", async () => {
    await fc.assert(
      fc.asyncProperty(answerArb, async (answer) => {
        const state = createMock();
        installMock(state);
        await applyAgentAnswer(
          CTX,
          { id: "a1", autonomyZone: "suggest" },
          answer,
          digest,
          "p1",
        );
        const before = writeSet(state, "ws-a");
        // Interleave workspace B: its own writes and its own agent run.
        putDoc(
          state,
          "approval",
          { id: "b-apr", title: "B proposal", status: "pending", kind: "send" },
          "ws-b",
          "p2",
        );
        await applyAgentAnswer(
          { ...CTX, workspaceId: "ws-b" },
          { id: "b1", autonomyZone: "suggest" },
          answer,
          digest,
          "p2",
        );
        expect(writeSet(state, "ws-a")).toEqual(before);
        vi.unstubAllGlobals();
      }),
      { numRuns: 15 },
    );
  });
});

describe("MR-E4 arbitrary model output never breaks the zone invariants", () => {
  it("holds for adversarial and malformed answers alike", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.anything({ maxDepth: 3 }), answerArb),
        async (raw) => {
          const state = createMock();
          state.copilotAnswer = raw;
          installMock(state);
          putDoc(state, "agent", {
            id: "a1",
            name: "Atlas",
            autonomyZone: "prep",
            principalId: "p1",
          });
          const runDoc = {
            id: "run:a1:mr-e4",
            agentId: "a1",
            title: "run",
            status: "queued",
            trigger: "daily",
            dueAt: "2026-11-20T12:00:00Z",
          };
          putDoc(state, "agent_run", runDoc);
          const outcome = await executeRun(
            CTX,
            runDoc,
            world,
            new Date("2026-11-20T12:00:00Z"),
          );
          // H1: no external execution ever, whatever the model said.
          expect(state.gmailCalls).toHaveLength(0);
          // H2: every persisted person reference is grounded in the digest.
          const allowed = new Set(digest.people.map((p) => p.id));
          for (const t of ["note", "approval", "activity"]) {
            for (const row of state.tables.get(t)?.values() ?? []) {
              const doc = row.doc as Record<string, unknown>;
              for (const id of (doc.personIds as string[]) ?? []) {
                expect(allowed.has(id)).toBe(true);
              }
              if (typeof doc.personId === "string") {
                expect(allowed.has(doc.personId)).toBe(true);
              }
            }
          }
          // Prep zone: nothing external staged.
          expect(state.tables.get("approval")?.size ?? 0).toBe(0);
          if (outcome.outcome === "failed") {
            expect(state.tables.get("note")?.size ?? 0).toBe(0);
            expect(state.tables.get("activity")?.size ?? 0).toBe(0);
          }
          vi.unstubAllGlobals();
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("MR-E5 replaying a finished run creates no duplicate effects", () => {
  it("holds for arbitrary valid answers", async () => {
    await fc.assert(
      fc.asyncProperty(answerArb, async (answer) => {
        const state = createMock();
        state.copilotAnswer = answer;
        installMock(state);
        putDoc(state, "agent", {
          id: "a1",
          name: "Atlas",
          autonomyZone: "suggest",
          principalId: "p1",
        });
        const runDoc = {
          id: "run:a1:mr-e5",
          agentId: "a1",
          title: "run",
          status: "queued",
          trigger: "daily",
          dueAt: "2026-11-20T12:00:00Z",
        };
        putDoc(state, "agent_run", runDoc);
        const first = await executeRun(CTX, runDoc, world);
        const writesAfterFirst = writeSet(state);
        const ledgerAfterFirst = state.ledger.length;
        const second = await executeRun(CTX, runDoc, world);
        expect(second.outcome).toBe(first.outcome);
        expect(second.traceId).toBe(first.traceId);
        expect(writeSet(state)).toEqual(writesAfterFirst);
        expect(state.ledger.length).toBe(ledgerAfterFirst);
        expect(state.copilotCalls).toBe(1);
        vi.unstubAllGlobals();
      }),
      { numRuns: 15 },
    );
  });
});

describe("MR-E6 pausing by status or by flag gives the same result: nothing runs (#101)", () => {
  it("holds for arbitrary agents and model answers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom("daily", "pre_event", "signal", undefined),
        fc.constantFrom("prep", "suggest", "co_design"),
        answerArb,
        async (name, cadence, zone, answer) => {
          const outcomes: string[] = [];
          for (const pause of [{ status: "paused" }, { paused: true }]) {
            const state = createMock();
            state.copilotAnswer = answer;
            installMock(state);
            putDoc(state, "agent", {
              id: "a1",
              name,
              cadence,
              autonomyZone: zone,
              principalId: "p1",
              ...pause,
            });
            expect(await enqueueAgentRuns(CTX, world, new Date())).toBe(0);
            const runDoc = {
              id: "run:a1:slot",
              agentId: "a1",
              status: "queued",
              trigger: "daily",
            };
            putDoc(state, "agent_run", runDoc);
            const result = await executeRun(CTX, runDoc, world);
            expect(state.copilotCalls).toBe(0);
            expect(writeSet(state)).toEqual([]);
            outcomes.push(result.outcome);
            vi.unstubAllGlobals();
          }
          expect(outcomes).toEqual(["skipped", "skipped"]);
        },
      ),
      { numRuns: 25 },
    );
  });
});
