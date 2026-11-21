/**
 * Agent Templates, Custom Agent Builder, and Draft Plan -> Lock Co-Design
 * backend (RI-0019 / #49).
 *
 * Implements:
 *  - Pre-built starter agent templates (Chief of Staff, Event Prep, Grant &
 *    Project Researcher, Relationship Outreach).
 *  - Custom workspace agent creation (trigger cadence, autonomy zone, scoped
 *    connectors, plain-language instructions) stored in `ri_console.agent`.
 *  - Zone 3 Co-Design: mutable Draft Plans (`status: "draft"`) that materialize
 *    real Objective + Milestone + Plan rows ONLY when the user explicitly clicks
 *    Lock (`POST /app-api/draft-plans/:id/lock`).
 *  - Every mutation logs an immutable `ri_console.ledger_event` with Phoenix
 *    OTLP `trace_id`.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AGENT_DOMAINS,
  type AgentDomain,
  completeAgentDoc,
} from "./agentShape.js";
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { ensureAppWorkspaceTables } from "./workspaces.js";
import { octoSql } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

export interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  /** The team section the installed agent appears under on the Agents page. */
  domain: AgentDomain;
  cadence: "daily" | "pre_event" | "signal";
  autonomyZone: "prep" | "suggest" | "co_design";
  connectors: string[];
  description: string;
  instructions: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "tpl-chief-of-staff",
    domain: "research",
    name: "Chief of Staff",
    role: "Daily Brief & Triage",
    cadence: "daily",
    autonomyZone: "prep",
    connectors: ["gmail", "gcal"],
    description:
      "Builds your morning Glance top-3 moves and evening sweep across active goals.",
    instructions:
      "Every morning, synthesize active Objectives, today's Google Calendar, and unread high-signal Gmail threads into 3 ranked moves. Never send external messages.",
  },
  {
    id: "tpl-event-prep",
    domain: "research",
    name: "Event Prep & Follow-Up",
    role: "Per-Event Lifecycle (T-7d / T-24h / T+24h)",
    cadence: "pre_event",
    autonomyZone: "suggest",
    connectors: ["gcal", "zoom", "luma", "linkedin"],
    description:
      "Enriches attendees 7 days out, prepares a 1-page brief 24h before, and queues thank-you drafts after.",
    instructions:
      "At T-7d enrich attendees and rank top 5 people to meet; at T-24h compile a 1-page prep brief with warm intro paths; at T+24h queue follow-up drafts in Approvals.",
  },
  {
    id: "tpl-project-researcher",
    domain: "research",
    name: "Project & Grant Researcher",
    role: "Deep Research & Co-Design",
    cadence: "signal",
    autonomyZone: "co_design",
    connectors: ["gdrive", "gmail"],
    description:
      "Tracks partner orgs, attaches sourced evidence to contacts, and drafts Project Plans for you to lock.",
    instructions:
      "Watch Drive docs and inbound emails for target organizations and grants. Attach only sourced claims and stage multi-step work as mutable Draft Plans.",
  },
  {
    id: "tpl-relationship-outreach",
    domain: "sales",
    name: "Relationship Outreach",
    role: "Warmth & Cadence Guard",
    cadence: "daily",
    autonomyZone: "suggest",
    connectors: ["gmail", "linkedin"],
    description:
      "Flags key contacts drifting past their touch cadence and queues editable follow-up drafts.",
    instructions:
      "Detect contacts past their cadenceDays threshold, cite the last sourced interaction, and queue a concise follow-up draft in Approvals with Do/Don't preview.",
  },
];

export const CreateCustomAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(2000),
  cadence: z.enum(["daily", "pre_event", "signal"]).default("daily"),
  autonomyZone: z.enum(["prep", "suggest", "co_design"]).default("suggest"),
  connectors: z.array(z.string().trim().min(1)).max(10).default([]),
  templateId: z.string().trim().optional(),
  domain: z.enum(AGENT_DOMAINS).optional(),
  projectId: z.string().trim().nullable().optional(),
});

export const CreateDraftPlanSchema = z.object({
  title: z.string().trim().min(1).max(140),
  objectiveName: z.string().trim().min(1).max(140),
  objectiveTarget: z
    .string()
    .trim()
    .max(140)
    .optional()
    .default("Ship milestone"),
  missionSummary: z.string().trim().max(600).optional().default(""),
  projectId: z.string().trim().nullable().optional(),
  horizon: z.enum(["today", "this_week", "this_month"]).default("this_week"),
  agentIds: z.array(z.string().trim().min(1)).max(6).default(["research"]),
  steps: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        detail: z.string().trim().max(400).optional().default(""),
        agentId: z.string().trim().optional().default("research"),
      }),
    )
    .min(1)
    .max(12),
});

export async function createCustomAgent(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = CreateCustomAgentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "BAD_REQUEST",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      },
    };
  }
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const data = parsed.data;

  // Installing the same template twice returns the agent already there, so a
  // second click cannot fill the workspace with copies.
  if (data.templateId) {
    const existing = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT doc FROM ri_console.agent
        WHERE workspace_id = ${lit(workspaceId)}
          AND doc->>'templateId' = ${lit(data.templateId)}
        ORDER BY updated_at ASC LIMIT 1`,
    );
    const found = existing[0]?.doc;
    if (found && typeof found === "object") {
      return {
        ok: true,
        status: 200,
        body: {
          agent: completeAgentDoc(found as Record<string, unknown>),
          alreadyInstalled: true,
        },
      };
    }
  }

  const template = AGENT_TEMPLATES.find((item) => item.id === data.templateId);
  const id = `agent-${randomUUID().slice(0, 8)}`;
  const span = startSpan({
    name: "agent.create",
    kind: "AGENT",
    workspaceId,
    principalId,
    agentId: id,
    cadence: data.cadence,
    attributes: {
      "ri.autonomy_zone": data.autonomyZone,
      ...(data.templateId ? { "ri.template_id": data.templateId } : {}),
    },
  });

  const createdAt = new Date().toISOString();
  const doc = completeAgentDoc({
    id,
    workspaceId,
    domain: data.domain ?? template?.domain ?? "research",
    name: data.name,
    role: data.role,
    status: "idle",
    cadence: data.cadence,
    autonomyZone: data.autonomyZone,
    connectors: data.connectors,
    instructions: data.instructions,
    templateId: data.templateId ?? null,
    projectId: data.projectId ?? null,
    createdBy: principalId,
    createdAt,
    metrics: { tasksDone: 0, approvalsPending: 0, accuracy: 100 },
  });

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.agent (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(id)}, ${lit(workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(doc))}::jsonb)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId,
    projectId: data.projectId ?? null,
    principalId,
    agentId: id,
    traceId: span.traceId,
    eventType: "agent.created",
    entityKind: "agent",
    entityId: id,
    payload: {
      name: data.name,
      cadence: data.cadence,
      autonomyZone: data.autonomyZone,
    },
  });
  await endSpan(span, "OK");

  return { ok: true, status: 200, body: { agent: doc, traceId: span.traceId } };
}

export async function listDraftPlans(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
): Promise<Record<string, unknown>[]> {
  try {
    const rows = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT doc FROM ri_console.plan
        WHERE workspace_id = ${lit(workspaceId)}
          AND (visibility = 'shared' OR principal_id = ${lit(principalId)})
          AND doc->>'kind' = 'draft_plan'
        ORDER BY updated_at DESC`,
    );
    return rows.map((r) => r.doc as Record<string, unknown>);
  } catch {
    return [];
  }
}

export async function createDraftPlan(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  rawBody: unknown,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = CreateDraftPlanSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "BAD_REQUEST",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      },
    };
  }
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const data = parsed.data;
  const id = `draft-${randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const doc = {
    id,
    kind: "draft_plan",
    status: "draft",
    workspaceId,
    projectId: data.projectId ?? null,
    title: data.title,
    objectiveName: data.objectiveName,
    objectiveTarget: data.objectiveTarget,
    missionSummary: data.missionSummary,
    horizon: data.horizon,
    agentIds: data.agentIds,
    steps: data.steps.map((s, idx) => ({
      id: `step-${idx + 1}`,
      label: s.label,
      detail: s.detail,
      agentId: s.agentId,
      status: "todo",
    })),
    createdBy: principalId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.plan (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(id)}, ${lit(workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(doc))}::jsonb)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId,
    projectId: data.projectId ?? null,
    principalId,
    eventType: "draft_plan.created",
    entityKind: "draft_plan",
    entityId: id,
    payload: { title: data.title, stepCount: data.steps.length },
  });

  return { ok: true, status: 200, body: { draftPlan: doc } };
}

/**
 * Explicitly lock a mutable Draft Plan into tracked Objective, Milestone, and
 * locked Plan rows (Zone 3 Co-Design -> Commit).
 */
export async function lockDraftPlan(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  draftPlanId: string,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  await ensureAppWorkspaceTables(config, token, octoContainerId);
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT doc FROM ri_console.plan
      WHERE id = ${lit(draftPlanId)}
        AND workspace_id = ${lit(workspaceId)}
        AND (visibility = 'shared' OR principal_id = ${lit(principalId)})
      LIMIT 1`,
  );
  const draft = (rows[0]?.doc as Record<string, unknown>) ?? null;
  if (draft?.kind !== "draft_plan") {
    return {
      ok: false,
      status: 404,
      body: { error: "DRAFT_PLAN_NOT_FOUND" },
    };
  }
  if (draft.status === "locked") {
    return {
      ok: false,
      status: 409,
      body: {
        error: "ALREADY_LOCKED",
        detail: "This draft plan is already locked.",
      },
    };
  }

  const span = startSpan({
    name: "draft_plan.lock",
    kind: "CHAIN",
    workspaceId,
    ...(typeof draft.projectId === "string"
      ? { projectId: draft.projectId }
      : {}),
    principalId,
    cadence: "interactive",
    attributes: { "ri.draft_plan_id": draftPlanId },
  });

  const nowIso = new Date().toISOString();
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  let projectId =
    typeof draft.projectId === "string" && draft.projectId
      ? draft.projectId
      : "";
  if (!projectId) {
    projectId = randomUUID();
    const projectDoc = {
      id: projectId,
      workspaceId,
      name: String(draft.title),
      kind: "initiative",
      status: "active",
      owner: principalId,
      summary: String(draft.missionSummary ?? ""),
      personIds: [],
      companyIds: [],
      eventIds: [],
      startedAt: nowIso,
      targetDate: due,
    };
    await octoSql(
      config,
      token,
      octoContainerId,
      `INSERT INTO ri_console.project (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(projectId)}, ${lit(workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(projectDoc))}::jsonb)`,
    );
  }

  const objectiveId = randomUUID();
  const objectiveDoc = {
    id: objectiveId,
    projectId,
    name: String(draft.objectiveName ?? draft.title),
    targetLabel: String(draft.objectiveTarget ?? "Ship milestone"),
    progress: 0,
    status: "on_track",
    dueDate: due,
  };
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.objective (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(objectiveId)}, ${lit(workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(objectiveDoc))}::jsonb)`,
  );

  const milestoneId = randomUUID();
  const milestoneDoc = {
    id: milestoneId,
    objectiveId,
    projectId,
    name: String(draft.title),
    summary: String(draft.missionSummary ?? ""),
    horizon: String(draft.horizon ?? "this_week"),
    status: "queued",
    agentIds: Array.isArray(draft.agentIds) ? draft.agentIds : ["research"],
    personIds: [],
    due,
  };
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.mission (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(milestoneId)}, ${lit(workspaceId)}, ${lit(principalId)}, 'shared', ${lit(JSON.stringify(milestoneDoc))}::jsonb)`,
  );

  const lockedDoc = {
    ...draft,
    status: "locked",
    projectId,
    objectiveId,
    // Persisted doc key stays `missionId` (canonical Octo schema).
    missionId: milestoneId,
    lockedAt: nowIso,
    lockedBy: principalId,
    traceId: span.traceId,
    updatedAt: nowIso,
  };
  await octoSql(
    config,
    token,
    octoContainerId,
    `UPDATE ri_console.plan
        SET doc = ${lit(JSON.stringify(lockedDoc))}::jsonb, updated_at = now()
      WHERE id = ${lit(draftPlanId)} AND workspace_id = ${lit(workspaceId)}`,
  );

  await appendLedgerEvent(config, token, octoContainerId, {
    workspaceId,
    projectId,
    principalId,
    traceId: span.traceId,
    eventType: "draft_plan.locked",
    entityKind: "draft_plan",
    entityId: draftPlanId,
    payload: {
      projectId,
      objectiveId,
      missionId: milestoneId,
      title: String(draft.title),
    },
  });
  await endSpan(span, "OK", {
    "ri.project_id": projectId,
    "ri.mission_id": milestoneId,
  });

  return {
    ok: true,
    status: 200,
    body: {
      locked: true,
      draftPlan: lockedDoc,
      projectId,
      objectiveId,
      milestoneId,
      traceId: span.traceId,
    },
  };
}
