/**
 * The Octo-backed world: reads and writes for the console's owner mode.
 *
 * Single-Octo model (RI-0018) + Dual Ledger / Phoenix bridge (RI-0020):
 *  - Every SQL/graph call targets the single backing `octoContainerId`
 *    (defaulting to `workspaceId` for backward compatibility).
 *  - Operational rows in `ri_console.*` are scoped by `workspace_id` (the
 *    active App Workspace ID) and `visibility`/`principal_id`.
 *  - Approval decisions also append an immutable row to `ri_console.ledger_event`
 *    carrying a W3C `trace_id` exported to Phoenix when configured.
 */
import { randomUUID } from "node:crypto";
import { completeAgentDoc } from "./agentShape.js";
import type { OctoClientConfig } from "./octo.js";
import { OctoError } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

type Json = Record<string, unknown>;

export interface WorldPerson {
  id: string;
  name: string;
  role: string;
  companyId: string;
  location: string;
  timezone: string;
  strength: number;
  warmth: "hot" | "warm" | "cool" | "cold";
  lastContact: string;
  tags: string[];
  summary: string;
  email: string;
  claims: {
    id: string;
    personId: string;
    text: string;
    source: { label: string; kind: string; date: string };
    confidence: "high" | "medium" | "low";
    status: "sourced" | "unverified";
  }[];
}

export interface WorldCompany {
  id: string;
  name: string;
  domain: string;
  sector: string;
  stage: string;
  headcount: number;
  location: string;
  notes: string;
}

export interface WorldShape {
  organization: Json;
  workspaces: Json[];
  projects: Json[];
  objectives: Json[];
  milestones: Json[];
  plans: Json[];
  agents: Json[];
  tasks: Json[];
  runs: Json[];
  approvals: Json[];
  activity: Json[];
  people: WorldPerson[];
  companies: WorldCompany[];
  events: Json[];
  folders: Json[];
  files: Json[];
  notes: Json[];
  retrospectives: Json[];
  connectors: Json[];
  mcpServers: Json[];
  plugins: Json[];
  smartLists: Json[];
  generatedAt: string;
}

/**
 * World collection -> ri_console table. Mirrors console/scripts/bootstrap-octo.mjs.
 * The milestone collection lives in Octo's persisted `mission` table: canonical
 * schema, not renamed from this adopter.
 */
const TABLES: Record<string, string> = {
  projects: "project",
  objectives: "objective",
  milestones: "mission",
  plans: "plan",
  agents: "agent",
  tasks: "agent_task",
  runs: "agent_run",
  approvals: "approval",
  activity: "activity",
  folders: "folder",
  files: "file_doc",
  notes: "note",
  retrospectives: "retrospective",
  connectors: "connector",
  mcpServers: "mcp_server",
  plugins: "plugin",
  smartLists: "smart_list",
};

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

async function octoPost(
  config: OctoClientConfig,
  token: string,
  path: string,
  body: unknown,
): Promise<Json> {
  const response = await fetch(new URL(path, config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for ${path}`,
    );
  }
  return JSON.parse(text) as Json;
}

export async function octoSql(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  sql: string,
): Promise<Json[]> {
  const result = await octoPost(
    config,
    token,
    `/api/workspaces/${octoContainerId}/query`,
    { sql },
  );
  return (result.rows as Json[]) ?? [];
}

async function graph(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  query: string,
): Promise<Json[]> {
  const result = await octoPost(config, token, "/api/graph/query", {
    workspaceId: octoContainerId,
    query,
  });
  return (result.rows as Json[]) ?? [];
}

/* ------------------------------------------------------------------ */
/* Canonical graph -> console people/companies/claims                  */
/* ------------------------------------------------------------------ */

// "met-once" is one of the three strengths seed/load.py accepts. It was
// missing here, so someone met in person scored 0, below a contact known
// only by email ("weak").
export const strengthOf = (value: unknown) =>
  value === "strong"
    ? 8
    : value === "medium"
      ? 5
      : value === "met-once"
        ? 3
        : value === "weak"
          ? 2
          : 0;

const warmthOf = (quietDays: number): WorldPerson["warmth"] =>
  quietDays <= 3
    ? "hot"
    : quietDays <= 10
      ? "warm"
      : quietDays <= 21
        ? "cool"
        : "cold";

const confidenceOf = (value: unknown): "high" | "medium" | "low" =>
  typeof value === "number" && value >= 0.8
    ? "high"
    : typeof value === "number" && value < 0.5
      ? "low"
      : "medium";

const hostOf = (locator: string) => {
  try {
    return new URL(locator).hostname.replace(/^www\./, "");
  } catch {
    return locator.slice(0, 40);
  }
};

/**
 * Entities that have been retired: at least one current claim says RETIRED
 * and no other current claim remains. The ledger never deletes, so retiring a
 * record (seed/retire_samples.py) supersedes its claims and adds a RETIRED
 * one; this is what keeps a retired person or company off the screen.
 */
export function retiredEntityIds(
  claims: Record<string, unknown>[],
  subjectOf: Map<string, string>,
): Set<string> {
  const retired = new Set<string>();
  const live = new Set<string>();
  for (const claim of claims) {
    if (claim.supersededAt) continue;
    const entityId = subjectOf.get(String(claim.id));
    if (!entityId) continue;
    let verb: unknown;
    try {
      verb = (JSON.parse(String(claim.provenance ?? "{}")) as Json).verb;
    } catch {
      verb = undefined;
    }
    if (verb === "RETIRED") retired.add(entityId);
    else live.add(entityId);
  }
  for (const id of live) retired.delete(id);
  return retired;
}

export interface CanonicalScope {
  workspaceId: string;
  octoContainerId: string;
  principalId: string;
  isContainerOwner: boolean;
}

/**
 * Fail-closed visibility filter for canonical graph claims (#73).
 *
 * - Workspace scope: claims without an explicit `provenance.workspaceId` belong
 *   strictly to `octoContainerId` (never leaking into other app workspaces).
 * - Principal scope: only `provenance.visibility === "shared"` is visible to
 *   other workspace members. Private and legacy untagged claims (such as the
 *   owner's imported private notes) are visible only to their author or, when
 *   untagged, to the container workspace owner.
 */
export function isClaimVisibleToScope(
  provenance: Record<string, unknown>,
  scope: CanonicalScope,
): boolean {
  const claimWs =
    typeof provenance.workspaceId === "string" && provenance.workspaceId
      ? provenance.workspaceId
      : scope.octoContainerId;
  const sharedWs = Array.isArray(provenance.sharedWorkspaces)
    ? provenance.sharedWorkspaces.map(String)
    : [];
  if (claimWs !== scope.workspaceId && !sharedWs.includes(scope.workspaceId)) {
    return false;
  }
  if (provenance.visibility === "shared") {
    return true;
  }
  const owner =
    typeof provenance.principalId === "string" && provenance.principalId
      ? provenance.principalId
      : typeof provenance.ownerId === "string" && provenance.ownerId
        ? provenance.ownerId
        : null;
  if (owner) {
    return owner === scope.principalId;
  }
  return scope.isContainerOwner && scope.workspaceId === scope.octoContainerId;
}

export async function readCanonical(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  scope?: CanonicalScope,
): Promise<{ people: WorldPerson[]; companies: WorldCompany[] }> {
  const [entities, claims, subjects, cites, beliefs] = await Promise.all([
    graph(
      config,
      token,
      octoContainerId,
      "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS kind",
    ),
    graph(
      config,
      token,
      octoContainerId,
      "MATCH (c:Claim) RETURN c.id AS id, c.statement AS statement, c.validFrom AS validFrom, c.supersededAt AS supersededAt, c.provenance AS provenance",
    ),
    graph(
      config,
      token,
      octoContainerId,
      "MATCH (c:Claim)-[:SUBJECT]->(e:Entity) RETURN c.id AS claimId, e.id AS entityId",
    ),
    graph(
      config,
      token,
      octoContainerId,
      "MATCH (c:Claim)-[:CITES]->(v:Evidence) RETURN c.id AS claimId, v.locator AS locator",
    ),
    graph(
      config,
      token,
      octoContainerId,
      "MATCH (b:Belief)-[:ABOUT]->(c:Claim) RETURN c.id AS claimId, b.confidence AS confidence",
    ),
  ]);

  const subjectOf = new Map<string, string>();
  for (const row of subjects)
    subjectOf.set(String(row.claimId), String(row.entityId));
  const locatorOf = new Map<string, string>();
  for (const row of cites)
    locatorOf.set(String(row.claimId), String(row.locator));
  const confidenceOfClaim = new Map<string, number>();
  for (const row of beliefs) {
    const id = String(row.claimId);
    const value = Number(row.confidence);
    confidenceOfClaim.set(id, Math.max(confidenceOfClaim.get(id) ?? 0, value));
  }

  const retired = retiredEntityIds(claims, subjectOf);
  const parsedClaimsByEntity = new Map<
    string,
    { claim: Json; provenance: Json }[]
  >();
  for (const claim of claims) {
    if (claim.supersededAt) continue;
    const entityId = subjectOf.get(String(claim.id));
    if (!entityId || retired.has(entityId)) continue;
    let provenance: Json = {};
    try {
      provenance = JSON.parse(String(claim.provenance ?? "{}")) as Json;
    } catch {
      provenance = {};
    }
    if (provenance.verb === "RETIRED") continue;
    if (scope && !isClaimVisibleToScope(provenance, scope)) continue;
    const list = parsedClaimsByEntity.get(entityId) ?? [];
    list.push({ claim, provenance });
    parsedClaimsByEntity.set(entityId, list);
  }

  const orgs = entities.filter(
    (e) => String(e.kind).startsWith("org:") && !retired.has(String(e.id)),
  );
  const orgBySlug = new Map(orgs.map((e) => [String(e.kind), String(e.id)]));
  const referencedCompanyIds = new Set<string>();

  const people: WorldPerson[] = [];
  for (const entity of entities) {
    if (entity.kind !== "person") continue;
    const personId = String(entity.id);
    if (retired.has(personId)) continue;
    const parsed = parsedClaimsByEntity.get(personId) ?? [];
    if (scope && parsed.length === 0) continue;

    const employment = parsed
      .filter((p) => p.provenance.verb === "WORKS_AT")
      .sort((a, b) =>
        String(b.claim.validFrom).localeCompare(String(a.claim.validFrom)),
      )[0];
    const companyId = employment
      ? (orgBySlug.get(`org:${String(employment.provenance.org)}`) ?? "")
      : "";
    if (companyId) referencedCompanyIds.add(companyId);
    const strength = parsed
      .filter((p) => p.provenance.verb === "MET")
      .reduce((max, p) => Math.max(max, strengthOf(p.provenance.strength)), 0);
    const lastContact = parsed.reduce((latest, { claim }) => {
      const current = String(claim.validFrom ?? "");
      return current.localeCompare(latest) > 0 ? current : latest;
    }, "");
    const quietDays = lastContact
      ? Math.max(
          0,
          Math.round(
            (Date.now() - new Date(lastContact).getTime()) / 86_400_000,
          ),
        )
      : 999;
    const mappedClaims = parsed.map(({ claim }) => {
      const locator = locatorOf.get(String(claim.id));
      return {
        id: String(claim.id),
        personId,
        text: String(claim.statement),
        source: {
          label: locator ? hostOf(locator) : "Octo ledger",
          kind: locator ? "web" : "note",
          date: String(claim.validFrom ?? ""),
        },
        confidence: confidenceOf(confidenceOfClaim.get(String(claim.id))),
        status: (locator ? "sourced" : "unverified") as
          | "sourced"
          | "unverified",
      };
    });
    const sourced = mappedClaims.find((c) => c.status === "sourced");
    people.push({
      id: personId,
      name: String(entity.name),
      role: employment ? String(employment.provenance.title ?? "—") : "—",
      companyId,
      location: "",
      timezone: "",
      strength,
      warmth: warmthOf(quietDays),
      lastContact: lastContact || new Date(0).toISOString(),
      tags: [],
      summary: sourced?.text ?? mappedClaims[0]?.text ?? "",
      email: "",
      claims: mappedClaims,
    });
  }

  const visibleOrgs = scope
    ? orgs.filter((e) => {
        const id = String(e.id);
        return (
          referencedCompanyIds.has(id) ||
          (parsedClaimsByEntity.get(id)?.length ?? 0) > 0
        );
      })
    : orgs;
  const companies: WorldCompany[] = visibleOrgs.map((e) => ({
    id: String(e.id),
    name: String(e.name),
    domain: "",
    sector: "—",
    stage: "—",
    headcount: 0,
    location: "—",
    notes: "",
  }));

  return { people, companies };
}

/* ------------------------------------------------------------------ */
/* Operational rows                                                    */
/* ------------------------------------------------------------------ */

async function readOps(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  octoContainerId = workspaceId,
): Promise<Record<string, Json[]>> {
  const present = new Set(
    (
      await octoSql(
        config,
        token,
        octoContainerId,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ri_console'",
      )
    ).map((row) => String(row.table_name)),
  );
  const out: Record<string, Json[]> = {};
  for (const [collection, table] of Object.entries(TABLES)) {
    if (!present.has(table)) {
      out[collection] = [];
      continue;
    }
    const rows = await octoSql(
      config,
      token,
      octoContainerId,
      `SELECT doc FROM ri_console.${table}
       WHERE workspace_id = ${lit(workspaceId)}
         AND (visibility = 'shared' OR principal_id = ${lit(principalId)})
       ORDER BY updated_at DESC`,
    );
    out[collection] = rows.map((row) => row.doc as Json);
  }
  return out;
}

async function insertDoc(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  collection: string,
  doc: Json,
  visibility: "private" | "shared" = "private",
  octoContainerId = workspaceId,
): Promise<void> {
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.${TABLES[collection]} (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(doc.id)}, ${lit(workspaceId)}, ${lit(principalId)}, ${lit(visibility)}, ${lit(JSON.stringify(doc))}::jsonb)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
  );
}

async function getDoc(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  collection: string,
  id: string,
  octoContainerId = workspaceId,
): Promise<Json | null> {
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT doc FROM ri_console.${TABLES[collection]}
     WHERE id = ${lit(id)} AND workspace_id = ${lit(workspaceId)}
       AND (visibility = 'shared' OR principal_id = ${lit(principalId)})`,
  );
  return (rows[0]?.doc as Json) ?? null;
}

/** Map Octo's persisted `missionId` doc key onto the domain's milestoneId. */
function normalizeMilestoneRef(doc: Json): Json {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;
  const record = doc as Record<string, Json>;
  if (record.milestoneId === undefined && record.missionId !== undefined) {
    const next: Record<string, Json> = {
      ...record,
      milestoneId: record.missionId,
    };
    delete next.missionId;
    return next;
  }
  return doc;
}

export async function readWorld(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
  octoContainerId = workspaceId,
  role = "member",
): Promise<WorldShape> {
  const [canonical, ops] = await Promise.all([
    readCanonical(config, token, octoContainerId, {
      workspaceId,
      octoContainerId,
      principalId: principal.id,
      isContainerOwner: role === "owner" && workspaceId === octoContainerId,
    }),
    readOps(config, token, workspaceId, principal.id, octoContainerId),
  ]);
  const {
    projects = [],
    objectives = [],
    milestones = [],
    plans = [],
    agents = [],
    tasks = [],
    runs = [],
    approvals = [],
    activity = [],
    folders = [],
    files = [],
    notes = [],
    retrospectives = [],
    connectors = [],
    mcpServers = [],
    plugins = [],
    smartLists = [],
  } = ops;
  const organization = {
    id: `org-${workspaceId}`,
    name: workspaces.find((w) => w.id === workspaceId)?.name ?? "Workspace",
    plan: "team",
    domain: "octo",
  };
  return {
    organization,
    workspaces: workspaces.map((w) => ({
      id: w.id,
      organizationId: organization.id,
      name: w.name,
      region: "octo",
      ownerName: principal.displayName,
    })),
    projects,
    objectives,
    milestones,
    // Octo plan/task docs persist the FK as `missionId`; accept both spellings.
    plans: plans.map((doc) => normalizeMilestoneRef(doc)),
    // Fill the fields the console's agent cards read; see agentShape.ts.
    agents: agents.map((agent) =>
      agent && typeof agent === "object"
        ? completeAgentDoc(agent as Record<string, unknown>)
        : agent,
    ) as Json[],
    tasks: tasks.map((doc) => normalizeMilestoneRef(doc)),
    runs,
    approvals,
    activity,
    people: canonical.people,
    companies: canonical.companies,
    events: [],
    folders,
    files,
    notes,
    retrospectives,
    connectors,
    mcpServers,
    plugins,
    smartLists,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Writes (all private to the acting principal unless shared config)   */
/* ------------------------------------------------------------------ */

export type DeclinePath = "stop" | "re_plan" | "snooze";

export interface DecisionInput {
  approvalId: string;
  decision: "approved" | "declined";
  declinePath?: DeclinePath | undefined;
  note?: string | undefined;
  editedAction?: string | undefined;
}

const now = () => new Date().toISOString();

async function applyDesign(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  design: Json,
  octoContainerId = workspaceId,
): Promise<string> {
  const due = String(design.due ?? now());
  let projectId = typeof design.projectId === "string" ? design.projectId : "";
  if (!projectId) {
    projectId = randomUUID();
    await insertDoc(
      config,
      token,
      workspaceId,
      principalId,
      "projects",
      {
        id: projectId,
        workspaceId,
        name: design.projectName ?? design.missionName,
        kind: "initiative",
        status: "active",
        owner: principalId,
        summary: design.missionSummary,
        ...(typeof design.projectMission === "string" && design.projectMission
          ? { mission: design.projectMission }
          : {}),
        personIds: [],
        companyIds: [],
        eventIds: [],
        startedAt: now(),
        targetDate: due,
      },
      "private",
      octoContainerId,
    );
  }
  const objectiveId = randomUUID();
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "objectives",
    {
      id: objectiveId,
      projectId,
      name: design.objectiveName,
      targetLabel: design.objectiveTarget,
      progress: 0,
      status: "on_track",
      dueDate: due,
    },
    "private",
    octoContainerId,
  );
  const milestoneId = randomUUID();
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "milestones",
    {
      id: milestoneId,
      objectiveId,
      projectId,
      name: design.missionName,
      summary: design.missionSummary,
      horizon: design.horizon ?? "this_week",
      status: "queued",
      agentIds: design.agentIds ?? [],
      personIds: [],
      due,
    },
    "private",
    octoContainerId,
  );
  const steps = (design.planSteps as Json[]) ?? [];
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "plans",
    {
      id: randomUUID(),
      // Persisted Octo doc key stays `missionId` (canonical schema).
      missionId: milestoneId,
      agentId: (design.agentIds as string[])?.[0] ?? "research",
      title: `Plan — ${String(design.missionName)}`,
      summary: design.rationale,
      steps: steps.map((step, index) => ({
        id: `step-${index + 1}`,
        label: step.label,
        detail: step.detail ?? "",
        status: "todo",
        agentId: step.agentId,
      })),
      updatedAt: now(),
    },
    "private",
    octoContainerId,
  );
  return `${String(design.missionName)} is queued with a ${steps.length}-step plan.`;
}

export async function decideApproval(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
  input: DecisionInput,
  options: {
    canDecideOthers?: boolean;
    octoContainerId?: string;
    role?: string;
  } = {},
): Promise<Json> {
  const containerId = options.octoContainerId ?? workspaceId;
  const span = startSpan({
    name: "approval.decide",
    kind: "CHAIN",
    workspaceId,
    principalId: principal.id,
    cadence: "interactive",
    attributes: {
      "ri.approval_id": input.approvalId,
      "ri.decision": input.decision,
    },
  });

  const rows = await octoSql(
    config,
    token,
    containerId,
    `SELECT principal_id, doc FROM ri_console.approval
     WHERE id = ${lit(input.approvalId)} AND workspace_id = ${lit(workspaceId)}
       AND (visibility = 'shared' OR principal_id = ${lit(principal.id)})`,
  );
  const row = rows[0];
  const approval = (row?.doc as Json) ?? null;
  if (!approval) throw new Error("Unknown approval");
  if (
    options.canDecideOthers === false &&
    String(row?.principal_id ?? "") !== principal.id
  ) {
    throw new ForbiddenError("Members can only decide their own proposals.");
  }
  if (approval.status !== "pending") {
    throw new ConflictError("That decision has already been made.");
  }

  const declinePath: DeclinePath =
    input.declinePath === "re_plan" || input.declinePath === "snooze"
      ? input.declinePath
      : "stop";
  approval.status = input.decision;
  approval.decidedAt = now();
  approval.decisionNote = input.note;
  approval.traceId = span.traceId;
  if (input.decision === "declined") {
    approval.declinePath = declinePath;
    if (declinePath === "snooze") {
      approval.snoozedUntil = new Date(Date.now() + 86_400_000).toISOString();
    }
  }
  if (input.editedAction) approval.editedAction = input.editedAction;

  const updated = await octoSql(
    config,
    token,
    containerId,
    `UPDATE ri_console.approval
        SET doc = ${lit(JSON.stringify(approval))}::jsonb, updated_at = now()
      WHERE id = ${lit(input.approvalId)}
        AND workspace_id = ${lit(workspaceId)}
        AND doc->>'status' = 'pending'
     RETURNING id`,
  );
  if (updated.length === 0) {
    throw new ConflictError("That decision has already been made.");
  }

  let outcome: string | null = null;
  if (approval.design && input.decision === "approved") {
    outcome = await applyDesign(
      config,
      token,
      workspaceId,
      principal.id,
      approval.design as Json,
      containerId,
    );
  } else if (input.decision === "declined" && declinePath === "re_plan") {
    const replan: Json = {
      ...approval,
      id: randomUUID(),
      parentApprovalId: approval.id,
      title: `Re-plan: ${String(approval.title)}`,
      reason:
        input.note?.trim() ||
        "Previous proposal was declined with re-plan requested.",
      status: "pending",
      createdAt: now(),
      decidedAt: undefined,
      declinePath: undefined,
    };
    await insertDoc(
      config,
      token,
      workspaceId,
      principal.id,
      "approvals",
      replan,
      "private",
      containerId,
    );
    outcome = "Queued one re-plan proposal.";
  } else if (input.decision === "declined" && declinePath === "snooze") {
    outcome = "Snoozed for 24 hours.";
  } else if (input.decision === "declined") {
    outcome = "Stopped — no milestone or follow-up created.";
  }

  const agent = await getDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "agents",
    String(approval.agentId),
    containerId,
  );
  if (agent) {
    const pendingRows = await octoSql(
      config,
      token,
      containerId,
      `SELECT doc FROM ri_console.approval
       WHERE workspace_id = ${lit(workspaceId)}
         AND (visibility = 'shared' OR principal_id = ${lit(principal.id)})`,
    );
    const remaining = pendingRows
      .map((r) => r.doc as Json)
      .filter((a) => a.agentId === agent.id && a.status === "pending");
    if (remaining.length === 0 && agent.status === "needs_you") {
      agent.status = "running";
      agent.currentTask = {
        title: "Resuming the task queue",
        startedAt: now(),
        progress: 12,
      };
      await insertDoc(
        config,
        token,
        workspaceId,
        principal.id,
        "agents",
        agent,
        "shared",
        containerId,
      );
    }
  }

  const activity: Json = {
    id: randomUUID(),
    at: now(),
    agentId: approval.agentId,
    type: "approval",
    title: `${input.decision === "approved" ? "You approved" : "You declined"}: ${String(approval.title)}`,
    detail:
      input.note?.trim() ||
      outcome ||
      (input.decision === "approved"
        ? "The agent will execute this now and log the result."
        : "The agent will stop this thread and try a different angle."),
    personId: approval.personId,
    companyId: approval.companyId,
    eventId: approval.eventId,
    approvalId: approval.id,
    traceId: span.traceId,
    outcome: input.decision === "approved" ? "ok" : "declined",
  };
  await insertDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "activity",
    activity,
    "private",
    containerId,
  );

  await appendLedgerEvent(config, token, containerId, {
    workspaceId,
    principalId: principal.id,
    agentId: typeof approval.agentId === "string" ? approval.agentId : null,
    traceId: span.traceId,
    eventType: `approval.${input.decision}`,
    entityKind: "approval",
    entityId: input.approvalId,
    payload: {
      decision: input.decision,
      declinePath: input.decision === "declined" ? declinePath : null,
      outcome: outcome ?? "",
    },
  });
  await endSpan(span, "OK");

  const world = await readWorld(
    config,
    token,
    workspaceId,
    principal,
    workspaces,
    containerId,
    options.role,
  );
  return {
    approval,
    activity,
    agent: agent ?? { id: approval.agentId },
    traceId: span.traceId,
    world,
  };
}

export async function addProposal(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  proposal: Json,
  octoContainerId = workspaceId,
): Promise<Json> {
  const approval: Json = {
    ...proposal,
    id: randomUUID(),
    createdAt: now(),
    status: "pending",
  };
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "approvals",
    approval,
    "private",
    octoContainerId,
  );
  return approval;
}

export async function logActivity(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  entry: Json,
  octoContainerId = workspaceId,
): Promise<Json> {
  const activity: Json = { ...entry, id: randomUUID(), at: now() };
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "activity",
    activity,
    "private",
    octoContainerId,
  );
  return activity;
}

export async function patchDoc(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  collection: string,
  id: string,
  patch: Json,
  visibility: "private" | "shared" = "shared",
  octoContainerId = workspaceId,
): Promise<Json> {
  const doc = await getDoc(
    config,
    token,
    workspaceId,
    principalId,
    collection,
    id,
    octoContainerId,
  );
  if (!doc) throw new Error(`Unknown ${collection} row: ${id}`);
  const next = { ...doc, ...patch };
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    collection,
    next,
    visibility,
    octoContainerId,
  );
  return next;
}
