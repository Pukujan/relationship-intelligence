import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentStatusPatch,
  completeAgentDoc,
  isAgentPaused,
} from "../server/agentShape.js";
import {
  type AgentRunAnswer,
  applyAgentAnswer,
  buildDigest,
  enqueueAgentRuns,
  executeDueRuns,
  executeRun,
} from "../server/executor.js";
import { deliverApprovedSend, GMAIL_SEND_SCOPE } from "../server/gmailSend.js";
import {
  CTX,
  createMock,
  docOf,
  installMock,
  type MockState,
  makeWorld,
  putDoc,
} from "./executorHarness.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (partial: Partial<AgentRunAnswer> = {}): AgentRunAnswer => ({
  summary: "Did the run.",
  findings: [],
  actions: [],
  dropped: 0,
  provider: "mock",
  model: "mock-model",
  ...partial,
});

const seedAgent = (state: MockState, doc: Record<string, unknown> = {}) =>
  putDoc(state, "agent", {
    id: "a1",
    name: "Atlas",
    instructions: "Do sourced research.",
    cadence: "daily",
    autonomyZone: "suggest",
    principalId: "p1",
    ...doc,
  });

const firstRow = (state: MockState, table: string) =>
  [...(state.tables.get(table)?.values() ?? [])][0];

describe("A1 cadence enqueue is idempotent per slot", () => {
  it("enqueues one daily run, advances nextRunAt, and never duplicates the slot", async () => {
    const state = createMock();
    installMock(state);
    seedAgent(state);
    const now = new Date("2026-11-20T12:00:00Z");
    const world = makeWorld();
    const first = await enqueueAgentRuns(CTX, world, now);
    expect(first).toBe(1);
    expect(state.tables.get("agent_run")?.size).toBe(1);
    const runId = `run:a1:${now.toISOString().slice(0, 10)}`;
    expect(state.tables.get("agent_run")?.has(runId)).toBe(true);
    expect(await enqueueAgentRuns(CTX, world, now)).toBe(0);
    // force due again within the same day: deterministic slot conflicts -> no dup
    const agentDoc = docOf(state.tables.get("agent")?.get("a1"));
    agentDoc.nextRunAt = "2026-11-20T00:00:00Z";
    expect(await enqueueAgentRuns(CTX, world, now)).toBe(1);
    expect(state.tables.get("agent_run")?.size).toBe(1);
  });
});

describe("A2 zone gate is enforced server-side", () => {
  const world = makeWorld({
    people: [
      {
        id: "p-1",
        name: "Zoe",
        role: "Founder",
        companyId: "",
        location: "",
        timezone: "",
        strength: 3,
        warmth: "warm",
        lastContact: "2026-11-01T00:00:00Z",
        tags: [],
        summary: "",
        email: "zoe@example.com",
        claims: [],
      },
    ],
  });
  const proposalAnswer = answer({
    actions: [
      { kind: "note", text: "internal note" },
      {
        kind: "approval",
        approvalKind: "send",
        title: "Follow up with Zoe",
        proposedAction: "Hi Zoe, ...",
        reason: "cadence",
        risk: "low",
        personId: "p-1",
      },
      {
        kind: "draft_plan",
        title: "Plan",
        objectiveName: "Outcome",
        objectiveTarget: "3 replies",
        missionSummary: "do it",
        horizon: "this_week",
        steps: [{ label: "step", detail: "" }],
      },
    ],
  });
  it("full (prep) downgrades proposals to notes and stages nothing external", async () => {
    const state = createMock();
    installMock(state);
    const counts = await applyAgentAnswer(
      CTX,
      { id: "a1", name: "Atlas", autonomyZone: "prep" },
      proposalAnswer,
      buildDigest(world),
      "p1",
    );
    expect(counts.approvals).toBe(0);
    expect(counts.drafts).toBe(0);
    expect(counts.downgraded).toBe(2);
    expect(counts.notes).toBe(3);
    expect(state.tables.get("approval")?.size ?? 0).toBe(0);
    expect(state.gmailCalls).toHaveLength(0);
  });
  it("approve (suggest) stages approvals but downgrades draft plans", async () => {
    const state = createMock();
    installMock(state);
    const counts = await applyAgentAnswer(
      CTX,
      { id: "a1", name: "Atlas", autonomyZone: "suggest" },
      proposalAnswer,
      buildDigest(world),
      "p1",
    );
    expect(counts.approvals).toBe(1);
    expect(counts.drafts).toBe(0);
    expect(counts.downgraded).toBe(1);
    expect(docOf(firstRow(state, "approval")).status).toBe("pending");
    expect(state.gmailCalls).toHaveLength(0);
  });
  it("draft (co_design) creates mutable draft plans and approvals", async () => {
    const state = createMock();
    installMock(state);
    const counts = await applyAgentAnswer(
      CTX,
      { id: "a1", name: "Atlas", autonomyZone: "co_design" },
      proposalAnswer,
      buildDigest(world),
      "p1",
    );
    expect(counts.approvals).toBe(1);
    expect(counts.drafts).toBe(1);
    const plan = docOf(firstRow(state, "plan"));
    expect(plan.kind).toBe("draft_plan");
    expect(plan.status).toBe("draft");
  });
});

describe("A3 grounding drops unknown ids", () => {
  it("never persists a reference absent from the digest", async () => {
    const state = createMock();
    installMock(state);
    const counts = await applyAgentAnswer(
      CTX,
      { id: "a1", autonomyZone: "suggest" },
      answer({
        findings: [{ text: "ghost finding", personId: "ghost" }],
        actions: [
          { kind: "note", text: "note", personId: "ghost" },
          {
            kind: "approval",
            approvalKind: "send",
            title: "t",
            proposedAction: "a",
            reason: "",
            risk: "low",
            personId: "ghost",
            companyId: "ghost-co",
          },
        ],
      }),
      buildDigest(makeWorld()),
      "p1",
    );
    expect(counts.dropped).toBe(4);
    expect(docOf(firstRow(state, "note")).personIds).toEqual([]);
    const approval = docOf(firstRow(state, "approval"));
    expect(approval.personId).toBeUndefined();
    expect(approval.companyId).toBeUndefined();
  });
});

describe("A4 model failure produces a failed receipt with zero writes", () => {
  it("records failed outcome and leaves no operational writes", async () => {
    const state = createMock();
    state.copilotAnswer = { __status: 500 };
    installMock(state);
    seedAgent(state);
    const runDoc = {
      id: "run:a1:2026-11-20",
      agentId: "a1",
      title: "Atlas daily run",
      status: "queued",
      trigger: "daily",
      dueAt: "2026-11-20T12:00:00Z",
    };
    putDoc(state, "agent_run", runDoc);
    const outcome = await executeRun(
      CTX,
      runDoc,
      makeWorld(),
      new Date("2026-11-20T12:00:00Z"),
    );
    expect(outcome.outcome).toBe("failed");
    expect(state.tables.get("note")?.size ?? 0).toBe(0);
    expect(state.tables.get("approval")?.size ?? 0).toBe(0);
    expect(state.tables.get("activity")?.size ?? 0).toBe(0);
    expect(docOf(state.tables.get("agent_run")?.get(runDoc.id)).outcome).toBe(
      "failed",
    );
    expect(docOf(state.tables.get("agent")?.get("a1")).status).toBe("idle");
  });
});

describe("A5 receipt shape and trace identity", () => {
  it("writes a console-shaped receipt and one ledger event sharing the traceId", async () => {
    const state = createMock();
    state.copilotAnswer = answer({
      summary: "One useful note.",
      actions: [{ kind: "note", text: "a note" }],
      findings: [{ text: "finding", sourceUrl: "https://example.com" }],
    });
    installMock(state);
    seedAgent(state);
    const runDoc = {
      id: "run:a1:2026-11-20",
      agentId: "a1",
      title: "Atlas daily run",
      status: "queued",
      trigger: "daily",
      dueAt: "2026-11-20T12:00:00Z",
    };
    putDoc(state, "agent_run", runDoc);
    const outcome = await executeRun(
      CTX,
      runDoc,
      makeWorld(),
      new Date("2026-11-20T12:00:00Z"),
    );
    expect(outcome.outcome).toBe("success");
    expect(outcome.traceId).toMatch(/^[0-9a-f]{32}$/);
    const receipt = docOf(state.tables.get("agent_run")?.get(runDoc.id));
    for (const key of [
      "id",
      "agentId",
      "title",
      "startedAt",
      "durationMin",
      "outcome",
      "summary",
      "evidence",
    ]) {
      expect(receipt[key], key).toBeDefined();
    }
    expect(state.ledger.length).toBe(1);
    expect(String(state.ledger[0]?.sql)).toContain(outcome.traceId);
    expect(String(state.ledger[0]?.sql)).toContain("agent.run.finished");
  });
});

describe("A6 approved send is scope-gated and explicit", () => {
  const approval = {
    id: "apr-1",
    kind: "send",
    status: "approved",
    personId: "p-1",
    title: "Following up",
    proposedAction: "Hi Zoe, great to meet you.",
    agentId: "a1",
  };
  const seedGmail = (state: MockState, scopes: string[]) => {
    state.connectorRows = [
      {
        access_token: "tok",
        refresh_token: "refresh",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: JSON.stringify(scopes),
        status: "connected",
        account_email: "owner@example.com",
      },
    ];
    state.graphEntities = [{ id: "p-1", name: "Zoe", kind: "person" }];
    state.graphClaims = [
      {
        id: "c-1",
        statement: "Zoe, professional email: zoe@example.com",
        validFrom: "2026-01-01",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "FACT",
          attribute: "professional_email",
        }),
      },
    ];
    state.graphSubjects = [{ claimId: "c-1", entityId: "p-1" }];
  };
  it("delivers once when approved and scoped", async () => {
    const state = createMock();
    installMock(state);
    seedGmail(state, [
      "https://www.googleapis.com/auth/gmail.readonly",
      GMAIL_SEND_SCOPE,
    ]);
    const result = await deliverApprovedSend(
      CTX.config,
      CTX.token,
      CTX.octoContainerId,
      CTX.workspaceId,
      approval,
      "p1",
      { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret" },
    );
    expect(result.delivered).toBe(true);
    expect(state.gmailCalls).toHaveLength(1);
    const raw = (JSON.parse(state.gmailCalls[0] ?? "{}") as { raw: string })
      .raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: zoe@example.com");
    expect(decoded).toContain("Hi Zoe, great to meet you.");
  });
  it("never delivers a declined or pending proposal", async () => {
    const state = createMock();
    installMock(state);
    seedGmail(state, [GMAIL_SEND_SCOPE]);
    const result = await deliverApprovedSend(
      CTX.config,
      CTX.token,
      CTX.octoContainerId,
      CTX.workspaceId,
      { ...approval, status: "declined" },
      "p1",
      {},
    );
    expect(result.delivered).toBe(false);
    expect(state.gmailCalls).toHaveLength(0);
  });
  it("blocks delivery without the send scope and says so", async () => {
    const state = createMock();
    installMock(state);
    seedGmail(state, ["https://www.googleapis.com/auth/gmail.readonly"]);
    const result = await deliverApprovedSend(
      CTX.config,
      CTX.token,
      CTX.octoContainerId,
      CTX.workspaceId,
      approval,
      "p1",
      {},
    );
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("send permission");
    expect(state.gmailCalls).toHaveLength(0);
  });
});

describe("A7 a paused agent never runs and a run never unpauses it (#101)", () => {
  // The console's Pause writes the status; the runner used to read only the
  // flag. Every case runs for both, so rows paused either way stay paused.
  const PAUSE_SHAPES: [string, Record<string, unknown>][] = [
    ["the console's status", { status: "paused" }],
    ["the paused flag", { paused: true }],
  ];
  const NOW = new Date("2026-11-20T12:00:00Z");
  const zoe = makeWorld({
    people: [
      {
        id: "p-1",
        name: "Zoe",
        role: "Founder",
        companyId: "",
        location: "",
        timezone: "",
        strength: 3,
        warmth: "warm",
        lastContact: "2026-11-01T00:00:00Z",
        tags: [],
        summary: "",
        email: "zoe@example.com",
        claims: [],
      },
    ],
  });
  const busyAnswer = answer({
    actions: [
      { kind: "note", text: "should not land" },
      {
        kind: "approval",
        approvalKind: "send",
        title: "Follow up with Zoe",
        proposedAction: "Hi Zoe, ...",
        reason: "cadence",
        risk: "low",
        personId: "p-1",
      },
    ],
  });
  const queuedRun = () => ({
    id: "run:a1:2026-11-20",
    agentId: "a1",
    title: "Atlas daily run",
    status: "queued",
    trigger: "daily",
    dueAt: NOW.toISOString(),
  });
  const agentDoc = (state: MockState, id = "a1") =>
    docOf(state.tables.get("agent")?.get(id));
  const operationalWrites = (state: MockState) =>
    ["note", "approval", "activity", "plan"].reduce(
      (sum, t) => sum + (state.tables.get(t)?.size ?? 0),
      0,
    );

  it.each(PAUSE_SHAPES)(
    "is never queued when paused by %s",
    async (_, pause) => {
      const state = createMock();
      installMock(state);
      seedAgent(state, pause);
      expect(await enqueueAgentRuns(CTX, makeWorld(), NOW)).toBe(0);
      expect(state.tables.get("agent_run")?.size ?? 0).toBe(0);
      expect(agentDoc(state).nextRunAt).toBeUndefined();
    },
  );

  it.each(PAUSE_SHAPES)(
    "closes a run queued before a pause by %s without calling the model",
    async (_, pause) => {
      const state = createMock();
      state.copilotAnswer = busyAnswer;
      installMock(state);
      seedAgent(state, { ...pause, lastRunAt: "2026-11-19T12:00:00Z" });
      const runDoc = queuedRun();
      putDoc(state, "agent_run", runDoc);
      const outcome = await executeRun(CTX, runDoc, zoe, NOW);
      expect(outcome.outcome).toBe("skipped");
      expect(state.copilotCalls).toBe(0);
      expect(operationalWrites(state)).toBe(0);
      const receipt = docOf(state.tables.get("agent_run")?.get(runDoc.id));
      expect(receipt.status).toBe("done");
      expect(receipt.outcome).toBe("skipped");
      expect(String(receipt.summary)).toContain("paused");
      const agent = agentDoc(state);
      expect(isAgentPaused(agent)).toBe(true);
      expect(agent.lastRunAt).toBe("2026-11-19T12:00:00Z");
      expect(state.ledger).toHaveLength(1);
    },
  );

  it.each(PAUSE_SHAPES)(
    "saves nothing the model found when paused by %s mid-run",
    async (_, pause) => {
      const state = createMock();
      state.copilotAnswer = busyAnswer;
      state.onCopilotCall = () => {
        const row = state.tables.get("agent")?.get("a1");
        if (row) row.doc = { ...docOf(row), ...pause, currentTask: null };
      };
      installMock(state);
      seedAgent(state);
      const runDoc = queuedRun();
      putDoc(state, "agent_run", runDoc);
      const outcome = await executeRun(CTX, runDoc, zoe, NOW);
      expect(state.copilotCalls).toBe(1);
      expect(outcome.outcome).toBe("skipped");
      expect(operationalWrites(state)).toBe(0);
      const agent = agentDoc(state);
      expect(isAgentPaused(agent)).toBe(true);
      expect(completeAgentDoc(agent).status).toBe("paused");
      expect(agent.lastRunAt).toBeUndefined();
    },
  );

  it.each(PAUSE_SHAPES)(
    "keeps a pause by %s that lands as the run finishes",
    async (_, pause) => {
      const state = createMock();
      state.copilotAnswer = answer({
        actions: [{ kind: "note", text: "a note" }],
      });
      // Pause just before the run's receipt is written, after it has saved
      // its work: the final status write must not overwrite the pause.
      state.onStatement = (sql) => {
        if (
          sql.includes("INSERT INTO ri_console.agent_run") &&
          sql.includes('"status":"done"')
        ) {
          const row = state.tables.get("agent")?.get("a1");
          if (row) row.doc = { ...docOf(row), ...pause };
        }
      };
      installMock(state);
      seedAgent(state);
      const runDoc = queuedRun();
      putDoc(state, "agent_run", runDoc);
      const outcome = await executeRun(CTX, runDoc, zoe, NOW);
      expect(outcome.outcome).toBe("success");
      const agent = agentDoc(state);
      expect(isAgentPaused(agent)).toBe(true);
      expect(completeAgentDoc(agent).status).toBe("paused");
      expect(agent.lastRunAt).toBeDefined();
    },
  );

  it.each(PAUSE_SHAPES)(
    "keeps a pause by %s that lands while runs are being queued",
    async (_, pause) => {
      const state = createMock();
      // Pause right after the runner read the agent list and queued a run,
      // before it records the agent's next run time.
      state.onStatement = (sql) => {
        if (sql.includes("INSERT INTO ri_console.agent_run")) {
          const row = state.tables.get("agent")?.get("a1");
          if (row) row.doc = { ...docOf(row), ...pause };
        }
      };
      installMock(state);
      seedAgent(state);
      expect(await enqueueAgentRuns(CTX, makeWorld(), NOW)).toBe(1);
      const agent = agentDoc(state);
      expect(isAgentPaused(agent)).toBe(true);
      expect(agent.nextRunAt).toBeDefined();
      // The run it queued is then skipped when the tick reaches it.
      const runDoc = docOf(
        state.tables.get("agent_run")?.get("run:a1:2026-11-20"),
      );
      expect((await executeRun(CTX, runDoc, makeWorld(), NOW)).outcome).toBe(
        "skipped",
      );
      expect(state.copilotCalls).toBe(0);
    },
  );

  it("never rewrites a whole agent row, so fields it does not own survive", async () => {
    const state = createMock();
    installMock(state);
    seedAgent(state, { kpis: [{ label: "Replies", value: 3 }] });
    await enqueueAgentRuns(CTX, makeWorld(), NOW);
    await executeRun(CTX, queuedRun(), makeWorld(), NOW);
    expect(
      state.statements.some((sql) =>
        /INSERT INTO ri_console\.agent \(/.test(sql),
      ),
    ).toBe(false);
    expect(agentDoc(state).kpis).toEqual([{ label: "Replies", value: 3 }]);
    expect(agentDoc(state).status).toBe("idle");
  });

  it("does not create an agent row for an agent that has none", async () => {
    const state = createMock();
    installMock(state);
    await executeRun(
      CTX,
      { ...queuedRun(), agentId: "ghost", id: "run:ghost:2026-11-20" },
      makeWorld(),
      NOW,
    );
    expect(state.tables.get("agent")?.get("ghost")).toBeUndefined();
  });

  it("runs only the unpaused agent on a full tick", async () => {
    const state = createMock();
    installMock(state);
    seedAgent(state, { status: "paused" });
    seedAgent(state, { id: "a2", name: "Cove" });
    const outcomes = await executeDueRuns(CTX, NOW);
    expect(outcomes.map((o) => o.runId)).toEqual(["run:a2:2026-11-20"]);
    expect(state.copilotCalls).toBe(1);
    expect(state.tables.get("agent_run")?.has("run:a1:2026-11-20")).toBe(false);
  });

  it("skips scheduled research while Atlas is paused and says so on the schedule run", async () => {
    const state = createMock();
    state.scheduleRuns = [
      {
        run_id: "sr-1",
        schedule_id: "s-1",
        principal_id: "p1",
        prompt: "Research Zoe's company",
      },
    ];
    installMock(state);
    seedAgent(state, { id: "research", name: "Atlas", status: "paused" });
    const outcomes = await executeDueRuns(CTX, NOW);
    expect(outcomes.map((o) => o.outcome)).toEqual(["skipped"]);
    expect(state.copilotCalls).toBe(0);
    expect(state.scheduleRunStatus.get("sr-1")).toBe("skipped");
  });

  it.each(PAUSE_SHAPES)(
    "is shown as paused by the console when paused by %s",
    (_, pause) => {
      const shown = completeAgentDoc({ id: "a1", status: "idle", ...pause });
      expect(shown.status).toBe("paused");
      expect(shown.paused).toBe(true);
    },
  );

  it.each(PAUSE_SHAPES)(
    "runs again after Resume clears a pause by %s",
    async (_, pause) => {
      const state = createMock();
      installMock(state);
      seedAgent(state, pause);
      const row = state.tables.get("agent")?.get("a1");
      // What /app-api/agent-status writes when the console's Resume is pressed.
      if (row) row.doc = { ...docOf(row), ...agentStatusPatch("running") };
      expect(isAgentPaused(agentDoc(state))).toBe(false);
      expect(await enqueueAgentRuns(CTX, makeWorld(), NOW)).toBe(1);
    },
  );

  it("writes both pause fields on Pause and refuses unknown statuses", () => {
    expect(agentStatusPatch("paused")).toEqual({
      status: "paused",
      paused: true,
      currentTask: null,
    });
    expect(agentStatusPatch("idle")).toEqual({ status: "idle", paused: false });
    expect(agentStatusPatch("asleep")).toBeNull();
    expect(agentStatusPatch(undefined)).toBeNull();
  });
});
