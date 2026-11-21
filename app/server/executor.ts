/**
 * Autonomous agent execution (RI-0022 / #92).
 *
 * The scheduler tick enqueues due agent cadences and queued schedule runs,
 * then executes at most two per tick through the copilot server's
 * `POST /api/agent-run`. The model proposes; this module decides what
 * persists, enforcing the autonomy zone server-side:
 *
 *   full   (prep)      -> notes + activity only; proposals downgrade to notes
 *   approve (suggest)  -> notes + approval proposals
 *   draft  (co_design) -> notes + approval proposals + mutable draft plans
 *
 * No zone ever executes an external action. A "send" proposal becomes a
 * pending approval; delivery happens only when a human approves it (see
 * gmailSend.ts). Every run writes an `agent_run` receipt the console already
 * renders, derives the agent's live status, and appends one ledger event and
 * one OTLP span sharing a single traceId.
 *
 * Run ids are deterministic (`run:<agentId>:<slot>`), so a double tick or a
 * replayed receipt creates no duplicate work (MR-E1 / MR-E5).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { completeAgentDoc, isAgentPaused } from "./agentShape.js";
import { createDraftPlan } from "./agents.js";
import { copilotTarget } from "./copilotProxy.js";
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { octoSql, readWorld, type WorldShape } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

export interface ExecutorCtx {
  config: OctoClientConfig;
  token: string;
  workspaceId: string;
  octoContainerId: string;
}

type Json = Record<string, unknown>;

const RUNS_PER_TICK = 2;
const MODEL_TIMEOUT_MS = 90_000;
const DAY_MS = 86_400_000;

/** One retry after a short pause: container->Octo round trips intermittently
 * time out (observed in production logs); a tick must not die on one blip. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      return await fn();
    } catch {
      throw first;
    }
  }
}

const sql = (ctx: ExecutorCtx, statement: string) =>
  withRetry(() =>
    octoSql(ctx.config, ctx.token, ctx.octoContainerId, statement),
  );

const writeDoc = (
  ctx: ExecutorCtx,
  table: string,
  doc: Json,
  principalId: string,
  visibility: "private" | "shared" = "shared",
) =>
  sql(
    ctx,
    `INSERT INTO ri_console.${table} (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(doc.id)}, ${lit(ctx.workspaceId)}, ${lit(principalId)}, ${lit(visibility)}, ${lit(JSON.stringify(doc))}::jsonb)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
  );

/**
 * `isAgentPaused` written in SQL, over the stored row's `doc` (#101). Kept
 * next to `mergeAgent`, its only user, so the two tests cannot drift apart.
 */
export const PAUSED_SQL = `(doc->'paused' = 'true'::jsonb OR doc->>'status' = 'paused')`;

/**
 * Merge the fields the runner owns into one agent row (#101).
 *
 * The runner used to write back the whole row it had read earlier, which
 * erased a pause the owner made in between. This merges in only `bookkeeping`
 * (when it last ran, when it runs next) and, unless the stored row is paused
 * at the moment of the write, `live` (its status and current task). It never
 * creates a row: the runner must not invent an agent nobody hired.
 */
const mergeAgent = (
  ctx: ExecutorCtx,
  agentId: string,
  bookkeeping: Json,
  live: Json = {},
) =>
  sql(
    ctx,
    `UPDATE ri_console.agent
     SET doc = doc || ${lit(JSON.stringify(bookkeeping))}::jsonb || CASE WHEN ${PAUSED_SQL} THEN '{}'::jsonb ELSE ${lit(JSON.stringify(live))}::jsonb END,
         updated_at = now()
     WHERE id = ${lit(agentId)} AND workspace_id = ${lit(ctx.workspaceId)}`,
  );

/* ------------------------------------------------------------------ */
/* Cadence enqueue                                                     */
/* ------------------------------------------------------------------ */

export interface DueSlot {
  slot: string;
  cadence: "daily" | "pre_event" | "signal";
  nextRunAt: string;
  lastSignalId?: string;
}

/** The deterministic slot an agent is due for, or null when not due. */
export function dueSlot(
  agent: Json,
  world: Pick<WorldShape, "events" | "activity">,
  now: Date,
): DueSlot | null {
  if (isAgentPaused(agent)) return null;
  const cadence =
    agent.cadence === "pre_event" || agent.cadence === "signal"
      ? agent.cadence
      : "daily";
  const nextRunAt = String(agent.nextRunAt ?? "");
  if (nextRunAt && new Date(nextRunAt).getTime() > now.getTime()) return null;
  const nowIso = now.toISOString();
  if (cadence === "daily") {
    return {
      slot: nowIso.slice(0, 10),
      cadence,
      nextRunAt: new Date(now.getTime() + DAY_MS).toISOString(),
    };
  }
  if (cadence === "pre_event") {
    const horizon = new Date(now.getTime() + 7 * DAY_MS).toISOString();
    const target = world.events
      .filter(
        (e) =>
          e.status === "upcoming" &&
          String(e.date) >= nowIso &&
          String(e.date) <= horizon,
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    if (!target) return null;
    return {
      slot: `event:${String(target.id)}`,
      cadence,
      nextRunAt: new Date(now.getTime() + DAY_MS).toISOString(),
    };
  }
  const latest = (world.activity as Json[])
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if (!latest || String(latest.id) === String(agent.lastSignalId ?? "")) {
    return null;
  }
  return {
    slot: `signal:${String(latest.id)}`,
    cadence,
    nextRunAt: new Date(now.getTime() + DAY_MS).toISOString(),
    lastSignalId: String(latest.id),
  };
}

export async function enqueueAgentRuns(
  ctx: ExecutorCtx,
  world: WorldShape,
  now = new Date(),
): Promise<number> {
  const rows = await sql(
    ctx,
    `SELECT doc FROM ri_console.agent WHERE workspace_id = ${lit(ctx.workspaceId)}`,
  );
  let enqueued = 0;
  for (const row of rows) {
    const agent = (row.doc ?? {}) as Json;
    const due = dueSlot(agent, world, now);
    if (!due) continue;
    const agentId = String(agent.id);
    const principalId = String(agent.principalId ?? "scheduler");
    const runId = `run:${agentId}:${due.slot}`;
    const doc: Json = {
      id: runId,
      agentId,
      title: `${String(agent.name ?? agentId)} ${due.cadence} run`,
      status: "queued",
      trigger: due.cadence,
      slot: due.slot,
      dueAt: now.toISOString(),
      startedAt: now.toISOString(),
      durationMin: 0,
      outcome: "success",
      summary: "",
    };
    await sql(
      ctx,
      `INSERT INTO ri_console.agent_run (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(runId)}, ${lit(ctx.workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(doc))}::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    await mergeAgent(ctx, agentId, {
      nextRunAt: due.nextRunAt,
      ...(due.lastSignalId ? { lastSignalId: due.lastSignalId } : {}),
    });
    enqueued++;
  }
  return enqueued;
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

const clipText = (value: unknown, max: number) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Compact server digest: ids the model may reference, nothing it can invent. */
export function buildDigest(world: WorldShape) {
  const pending = (world.approvals as Json[]).filter(
    (a) => a.status === "pending",
  );
  return {
    graphStale: Boolean(world.graphStale),
    people: world.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      companyId: p.companyId,
      warmth: p.warmth,
      lastContact: p.lastContact,
      summary: clipText(p.summary, 160),
    })),
    companies: world.companies.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    events: world.events.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date,
      status: e.status,
      attendeeIds: e.attendeeIds,
    })),
    projects: (world.projects as Json[]).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    milestones: (world.milestones as Json[]).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      due: m.due,
      projectId: m.projectId,
    })),
    approvals: pending.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      agentId: a.agentId,
    })),
    agents: (world.agents as Json[]).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
    })),
  };
}

export function buildSignals(world: WorldShape): string[] {
  return (world.activity as Json[])
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 20)
    .map(
      (a) =>
        `[${String(a.at).slice(0, 10)}] ${String(a.type ?? "activity")}: ${clipText(a.title, 120)}${a.detail ? ` — ${clipText(a.detail, 160)}` : ""}`,
    );
}

/* ------------------------------------------------------------------ */
/* Model answer contract (trust boundary)                              */
/* ------------------------------------------------------------------ */

const AnswerActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    text: z.string().min(1).max(2_400),
    personId: z.string().max(80).nullish(),
  }),
  z.object({
    kind: z.literal("approval"),
    approvalKind: z.enum(["send", "call", "publish", "invite", "commit"]),
    title: z.string().min(1).max(400),
    proposedAction: z.string().min(1).max(4_000),
    reason: z.string().max(1_200).default(""),
    risk: z.enum(["low", "medium", "high"]).default("medium"),
    personId: z.string().max(80).nullish(),
    companyId: z.string().max(80).nullish(),
    eventId: z.string().max(80).nullish(),
  }),
  z.object({
    kind: z.literal("draft_plan"),
    title: z.string().min(1).max(280),
    objectiveName: z.string().min(1).max(280),
    objectiveTarget: z.string().max(280).default("Ship milestone"),
    missionSummary: z.string().max(1_200).default(""),
    horizon: z.enum(["today", "this_week", "this_month"]).default("this_week"),
    steps: z
      .array(
        z.object({
          label: z.string().min(1).max(400),
          detail: z.string().max(800).default(""),
        }),
      )
      .min(1)
      .max(24),
  }),
]);

export const AgentRunAnswerSchema = z.object({
  summary: z.string().min(1).max(4_000),
  findings: z
    .array(
      z.object({
        text: z.string().min(1).max(1_200),
        personId: z.string().max(80).nullish(),
        sourceUrl: z.string().max(600).nullish(),
      }),
    )
    .max(16)
    .default([]),
  actions: z.array(AnswerActionSchema).max(24).default([]),
  dropped: z.number().int().min(0).default(0),
  provider: z.string().max(80).default(""),
  model: z.string().max(120).default(""),
});

export type AgentRunAnswer = z.infer<typeof AgentRunAnswerSchema>;
type AnswerAction = z.infer<typeof AnswerActionSchema>;

/* ------------------------------------------------------------------ */
/* Zone gate + grounded persistence                                    */
/* ------------------------------------------------------------------ */

export interface ApplyCounts {
  notes: number;
  approvals: number;
  drafts: number;
  findings: number;
  downgraded: number;
  dropped: number;
  failed: number;
}

/**
 * Persist a validated answer under the agent's autonomy zone. Every person /
 * company / event reference is re-checked against the digest here — the
 * adapter never trusts the copilot's grounding alone (holdout H2). External
 * actions are never executed: "approval" rows are proposals, full stop.
 */
export async function applyAgentAnswer(
  ctx: ExecutorCtx,
  agent: Json,
  answer: AgentRunAnswer,
  digest: ReturnType<typeof buildDigest>,
  principalId: string,
  now = new Date(),
): Promise<ApplyCounts> {
  const autonomy = completeAgentDoc(agent as Record<string, unknown>).autonomy;
  const counts: ApplyCounts = {
    notes: 0,
    approvals: 0,
    drafts: 0,
    findings: 0,
    downgraded: 0,
    dropped: 0,
    failed: 0,
  };
  const personIds = new Set(digest.people.map((p) => String(p.id)));
  const companyIds = new Set(digest.companies.map((c) => String(c.id)));
  const eventIds = new Set(digest.events.map((e) => String(e.id)));
  const ground = (
    id: string | null | undefined,
    set: Set<string>,
  ): string | undefined => {
    if (!id) return undefined;
    if (set.has(id)) return id;
    counts.dropped++;
    return undefined;
  };
  const agentId = String(agent.id);
  const nowIso = now.toISOString();

  const writeNote = async (text: string, personId?: string) => {
    try {
      await writeDoc(
        ctx,
        "note",
        {
          id: `note-${randomUUID().slice(0, 12)}`,
          title: clipText(text, 60),
          kind: "note",
          at: nowIso,
          body: clipText(text, 1_200),
          personIds: personId ? [personId] : [],
          agentId,
        },
        principalId,
      );
      counts.notes++;
    } catch {
      counts.failed++;
    }
  };

  // Findings become activity rows (research), never canonical claims.
  for (const finding of answer.findings.slice(0, 8)) {
    const personId = ground(finding.personId, personIds);
    try {
      await writeDoc(
        ctx,
        "activity",
        {
          id: `act-${randomUUID().slice(0, 12)}`,
          at: nowIso,
          agentId,
          type: "research",
          title: clipText(finding.text, 120),
          detail: finding.sourceUrl ? clipText(finding.sourceUrl, 300) : "",
          ...(personId ? { personId } : {}),
          outcome: "info",
          evidence: finding.sourceUrl
            ? [{ label: "source", detail: clipText(finding.sourceUrl, 300) }]
            : [],
        },
        principalId,
      );
      counts.findings++;
    } catch {
      counts.failed++;
    }
  }

  const stageApproval = async (
    action: Extract<AnswerAction, { kind: "approval" }>,
  ) => {
    const personId = ground(action.personId, personIds);
    const companyId = ground(action.companyId, companyIds);
    const eventId = ground(action.eventId, eventIds);
    try {
      await writeDoc(
        ctx,
        "approval",
        {
          id: `apr-${randomUUID().slice(0, 12)}`,
          agentId,
          kind: action.approvalKind,
          title: clipText(action.title, 200),
          proposedAction: clipText(action.proposedAction, 2_000),
          reason: clipText(action.reason, 600),
          evidence: [],
          risk: action.risk,
          ...(personId ? { personId } : {}),
          ...(companyId ? { companyId } : {}),
          ...(eventId ? { eventId } : {}),
          createdAt: nowIso,
          status: "pending",
        },
        principalId,
      );
      counts.approvals++;
    } catch {
      counts.failed++;
    }
  };

  for (const action of answer.actions.slice(0, 12)) {
    if (action.kind === "note") {
      await writeNote(action.text, ground(action.personId, personIds));
      continue;
    }
    if (action.kind === "approval") {
      if (autonomy === "full") {
        // Prep zone: internal only. Keep the draft as a note, never a proposal.
        counts.downgraded++;
        await writeNote(
          `[prep] ${action.title}: ${action.proposedAction}`,
          ground(action.personId, personIds),
        );
      } else {
        await stageApproval(action);
      }
      continue;
    }
    // draft_plan
    if (autonomy === "draft") {
      try {
        const created = await createDraftPlan(
          ctx.config,
          ctx.token,
          ctx.octoContainerId,
          ctx.workspaceId,
          principalId,
          {
            title: action.title,
            objectiveName: action.objectiveName,
            objectiveTarget: action.objectiveTarget,
            missionSummary: action.missionSummary,
            horizon: action.horizon,
            agentIds: [agentId],
            steps: action.steps.slice(0, 12),
          },
        );
        if (created.ok) counts.drafts++;
        else counts.failed++;
      } catch {
        counts.failed++;
      }
    } else {
      counts.downgraded++;
      await writeNote(
        `[plan idea] ${action.title}: ${action.objectiveName} — ${action.missionSummary}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Run execution                                                       */
/* ------------------------------------------------------------------ */

const callCopilot = async (body: Json): Promise<AgentRunAnswer> => {
  const response = await fetch(`${copilotTarget()}/api/agent-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`copilot agent-run ${response.status}`);
  }
  return AgentRunAnswerSchema.parse(await response.json());
};

const agentStatusAfter = (
  agentId: string,
  world: WorldShape,
  stagedApprovals: number,
): "idle" | "needs_you" => {
  if (stagedApprovals > 0) return "needs_you";
  const pending = (world.approvals as Json[]).some(
    (a) => a.status === "pending" && String(a.agentId) === agentId,
  );
  return pending ? "needs_you" : "idle";
};

export interface RunOutcome {
  runId: string;
  /** `skipped`: the agent was paused, so the run saved nothing (#101). */
  outcome: "success" | "partial" | "escalated" | "failed" | "skipped";
  traceId: string;
  counts: ApplyCounts;
}

/** Execute one claimed run doc. Never throws: failures become receipts. */
export async function executeRun(
  ctx: ExecutorCtx,
  runDoc: Json,
  world: WorldShape,
  now = new Date(),
): Promise<RunOutcome> {
  const runId = String(runDoc.id);
  const agentId = String(runDoc.agentId);
  const startedAt = now.toISOString();
  // Replay guard (MR-E5): a finished run is never re-executed. The tick only
  // claims queued rows, but a replayed or raced receipt must stay idempotent.
  const existingRows = await sql(
    ctx,
    `SELECT doc FROM ri_console.agent_run WHERE id = ${lit(runId)} AND workspace_id = ${lit(ctx.workspaceId)}`,
  ).catch(() => [] as Json[]);
  const existingDoc = existingRows[0]?.doc as Json | undefined;
  if (existingDoc && existingDoc.status === "done") {
    return {
      runId,
      outcome: (existingDoc.outcome as RunOutcome["outcome"]) ?? "success",
      traceId: String(existingDoc.traceId ?? ""),
      counts: (existingDoc.counts as ApplyCounts) ?? {
        notes: 0,
        approvals: 0,
        drafts: 0,
        findings: 0,
        downgraded: 0,
        dropped: 0,
        failed: 0,
      },
    };
  }
  const agentRows = await sql(
    ctx,
    `SELECT doc FROM ri_console.agent WHERE id = ${lit(agentId)} AND workspace_id = ${lit(ctx.workspaceId)}`,
  ).catch(() => [] as Json[]);
  const baseAgent = ((agentRows[0]?.doc as Json) ?? {
    id: agentId,
    name: agentId,
  }) as Json;
  const agent = completeAgentDoc({
    ...baseAgent,
    ...((runDoc.agentOverride as Json) ?? {}),
  } as Record<string, unknown>);
  /** Read the agent row again: a pause can land at any time (#101). */
  const pausedNow = async () => {
    const rows = await sql(
      ctx,
      `SELECT doc FROM ri_console.agent WHERE id = ${lit(agentId)} AND workspace_id = ${lit(ctx.workspaceId)}`,
    );
    return isAgentPaused(rows[0]?.doc as Json | undefined);
  };
  const principalId = String(
    runDoc.principalId ?? agent.principalId ?? "scheduler",
  );
  const cadence = (
    runDoc.trigger === "pre_event" || runDoc.trigger === "signal"
      ? runDoc.trigger
      : "daily"
  ) as "daily" | "pre_event" | "signal";
  const span = startSpan({
    name: "agent.run",
    kind: "AGENT",
    workspaceId: ctx.workspaceId,
    principalId,
    agentId,
    runId,
    cadence,
    attributes: { "ri.trigger": String(runDoc.trigger ?? "cadence") },
  });
  const emptyCounts: ApplyCounts = {
    notes: 0,
    approvals: 0,
    drafts: 0,
    findings: 0,
    downgraded: 0,
    dropped: 0,
    failed: 0,
  };

  const finish = async (
    outcome: RunOutcome["outcome"],
    summary: string,
    counts: ApplyCounts,
    extra: Json = {},
  ): Promise<RunOutcome> => {
    const finishedAt = new Date().toISOString();
    const durationMin = Math.max(
      1,
      Math.round((Date.now() - now.getTime()) / 60_000),
    );
    const receipt: Json = {
      ...runDoc,
      status: "done",
      outcome,
      title: String(runDoc.title ?? `${agent.name} run`),
      startedAt,
      finishedAt,
      durationMin,
      summary: clipText(summary, 1_200),
      evidence: (extra.evidence as Json[]) ?? [],
      traceId: span.traceId,
      provider: extra.provider ?? "",
      model: extra.model ?? "",
      counts,
    };
    try {
      await writeDoc(ctx, "agent_run", receipt, principalId);
      // A skipped run did no work, so the agent row keeps its last run time
      // and the status the owner gave it.
      if (outcome !== "skipped") {
        const status =
          outcome === "failed"
            ? "idle"
            : agentStatusAfter(agentId, world, counts.approvals);
        await mergeAgent(
          ctx,
          agentId,
          { lastRunAt: finishedAt },
          { status, currentTask: null },
        );
      }
      if (String(runDoc.trigger) === "schedule" && runDoc.scheduleRunId) {
        const scheduleStatus =
          outcome === "failed"
            ? "failed"
            : outcome === "skipped"
              ? "skipped"
              : "done";
        await sql(
          ctx,
          `UPDATE ri_console.schedule_run SET status = ${lit(scheduleStatus)} WHERE id = ${lit(runDoc.scheduleRunId)}`,
        );
      }
    } catch {
      // Receipt write failed (Octo blip): the span + ledger still record it.
    }
    await appendLedgerEvent(ctx.config, ctx.token, ctx.octoContainerId, {
      workspaceId: ctx.workspaceId,
      principalId,
      agentId,
      runId,
      traceId: span.traceId,
      eventType: "agent.run.finished",
      entityKind: "agent_run",
      entityId: runId,
      payload: { outcome, counts, summary: clipText(summary, 300) },
    });
    await endSpan(span, outcome === "failed" ? "ERROR" : "OK", {
      outcome,
      duration_ms: Date.now() - now.getTime(),
      ...counts,
    });
    return { runId, outcome, traceId: span.traceId, counts };
  };

  const agentName = String(agent.name ?? agentId);
  // A paused agent never runs (#101). The tick claims queued runs that may
  // predate the pause, so check here, before any work, and close the run.
  if (isAgentPaused(baseAgent) || isAgentPaused(agent)) {
    return await finish(
      "skipped",
      `Skipped: ${agentName} is paused, so this run did nothing.`,
      emptyCounts,
    );
  }

  try {
    await writeDoc(
      ctx,
      "agent_run",
      { ...runDoc, status: "running", startedAt },
      principalId,
    );
    await mergeAgent(
      ctx,
      agentId,
      {},
      {
        status: "running",
        currentTask: {
          title: String(runDoc.title ?? "Scheduled run"),
          startedAt,
          progress: 0,
        },
      },
    );
    const digest = buildDigest(world);
    const answer = await callCopilot({
      agentId,
      agentName,
      instructions: clipText(
        agent.instructions ?? agent.mission ?? "Do useful, sourced work.",
        4_000,
      ),
      autonomy: agent.autonomy,
      cadence: String(runDoc.trigger ?? "daily"),
      digest,
      signals: buildSignals(world),
      graphStale: digest.graphStale,
      runId,
      principalId,
    });
    // The model call can take up to 90 seconds. If the owner paused the
    // agent meanwhile, nothing the run found is saved.
    if (await pausedNow()) {
      return await finish(
        "skipped",
        `Skipped: ${agentName} was paused while this run worked, so nothing it found was saved.`,
        emptyCounts,
        { provider: answer.provider, model: answer.model },
      );
    }
    const counts = await applyAgentAnswer(
      ctx,
      agent,
      answer,
      digest,
      principalId,
      now,
    );
    const outcome: RunOutcome["outcome"] =
      counts.failed > 0
        ? "partial"
        : counts.approvals > 0
          ? "escalated"
          : "success";
    return await finish(outcome, answer.summary, counts, {
      provider: answer.provider,
      model: answer.model,
      evidence: answer.findings.slice(0, 6).map((f) => ({
        label: f.sourceUrl ? "source" : "finding",
        detail: clipText(f.sourceUrl ?? f.text, 300),
      })),
    });
  } catch (error) {
    return await finish(
      "failed",
      `Run failed: ${error instanceof Error ? error.message : "unknown"}`,
      emptyCounts,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Tick entry point                                                    */
/* ------------------------------------------------------------------ */

/** Enqueue due cadences + queued schedule runs, then execute ≤2 runs. */
export async function executeDueRuns(
  ctx: ExecutorCtx,
  now = new Date(),
): Promise<RunOutcome[]> {
  const world = await withRetry(() =>
    readWorld(
      ctx.config,
      ctx.token,
      ctx.workspaceId,
      { id: "scheduler", displayName: "Scheduler" },
      [{ id: ctx.workspaceId, name: "Workspace" }],
      ctx.octoContainerId,
      "owner",
    ),
  );
  await enqueueAgentRuns(ctx, world, now);

  // Queued schedule runs become executor runs attributed to the schedule's
  // principal, executed as the research agent with the schedule's prompt.
  const scheduleRuns = await sql(
    ctx,
    `SELECT r.id AS run_id, r.schedule_id, s.principal_id, s.prompt
     FROM ri_console.schedule_run r JOIN ri_console.schedule s ON s.id = r.schedule_id
     WHERE r.status = 'queued' AND s.workspace_id = ${lit(ctx.workspaceId)}
     ORDER BY r.created_at ASC LIMIT ${RUNS_PER_TICK}`,
  ).catch(() => [] as Json[]);
  for (const row of scheduleRuns) {
    const runId = `run:schedule:${String(row.run_id)}`;
    await sql(
      ctx,
      `INSERT INTO ri_console.agent_run (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(runId)}, ${lit(ctx.workspaceId)}, ${lit(row.principal_id)}, 'shared', ${lit(
         JSON.stringify({
           id: runId,
           agentId: "research",
           principalId: String(row.principal_id),
           title: `Scheduled research: ${clipText(row.prompt, 60)}`,
           status: "queued",
           trigger: "schedule",
           scheduleRunId: String(row.run_id),
           instructions: String(row.prompt ?? ""),
           dueAt: now.toISOString(),
           startedAt: now.toISOString(),
           durationMin: 0,
           outcome: "success",
           summary: "",
         }),
       )}::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    await sql(
      ctx,
      `UPDATE ri_console.schedule_run SET status = 'claimed' WHERE id = ${lit(row.run_id)} AND status = 'queued'`,
    );
  }

  const queued = await sql(
    ctx,
    `SELECT doc FROM ri_console.agent_run
     WHERE workspace_id = ${lit(ctx.workspaceId)} AND doc->>'status' = 'queued'
     ORDER BY doc->>'dueAt' ASC LIMIT ${RUNS_PER_TICK}`,
  );
  const outcomes: RunOutcome[] = [];
  for (const row of queued) {
    const runDoc = (row.doc ?? {}) as Json;
    // Schedule runs carry their own prompt as instructions.
    if (runDoc.trigger === "schedule" && runDoc.instructions) {
      const research = await sql(
        ctx,
        `SELECT doc FROM ri_console.agent WHERE id = 'research' AND workspace_id = ${lit(ctx.workspaceId)}`,
      ).catch(() => [] as Json[]);
      const base = (research[0]?.doc as Json) ?? {
        id: "research",
        name: "Atlas",
      };
      runDoc.agentOverride = { ...base, instructions: runDoc.instructions };
    }
    outcomes.push(await executeRun(ctx, runDoc, world, now));
    if (outcomes.length >= RUNS_PER_TICK) break;
  }
  if (outcomes.length) {
    console.log(
      `executor: ${outcomes.length} run(s) — ${outcomes.map((o) => `${o.runId}:${o.outcome}`).join(", ")}`,
    );
  }
  return outcomes;
}
