/**
 * The Octo-backed world: reads and writes for the console's owner mode.
 *
 * Authority rules, from the project contract:
 *  - Every call here uses the signed-in principal's Octo session token, so
 *    Octo enforces that principal's memberships. The workspace key is never
 *    used in this path (it is reserved for admin bootstrap).
 *  - Canonical people/companies/claims come from the epistemic ledger via the
 *    graph projection. Operational records (agents, work, approvals, activity)
 *    live in the workspace SQL surface, schema ri_console.
 *  - Private by default: rows a principal creates carry their id and
 *    visibility 'private'; reads return shared rows plus the caller's own.
 *  - Nothing unsourced becomes canonical: ledger claims without a CITES edge
 *    surface as `unverified`, exactly as the loader wrote them.
 */
import { randomUUID } from "node:crypto";
import type { OctoClientConfig } from "./octo.js";
import { OctoError } from "./octo.js";

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
  missions: Json[];
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

/** World collection -> ri_console table. Mirrors console/scripts/bootstrap-octo.mjs. */
const TABLES: Record<string, string> = {
  projects: "project",
  objectives: "objective",
  missions: "mission",
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
  workspaceId: string,
  sql: string,
): Promise<Json[]> {
  const result = await octoPost(
    config,
    token,
    `/api/workspaces/${workspaceId}/query`,
    { sql },
  );
  return (result.rows as Json[]) ?? [];
}

async function graph(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  query: string,
): Promise<Json[]> {
  const result = await octoPost(config, token, "/api/graph/query", {
    workspaceId,
    query,
  });
  return (result.rows as Json[]) ?? [];
}

/* ------------------------------------------------------------------ */
/* Canonical graph -> console people/companies/claims                  */
/* ------------------------------------------------------------------ */

const strengthOf = (value: unknown) =>
  value === "strong" ? 8 : value === "medium" ? 5 : value === "weak" ? 2 : 0;

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

export async function readCanonical(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
): Promise<{ people: WorldPerson[]; companies: WorldCompany[] }> {
  const [entities, claims, subjects, cites, beliefs] = await Promise.all([
    graph(
      config,
      token,
      workspaceId,
      "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS kind",
    ),
    graph(
      config,
      token,
      workspaceId,
      "MATCH (c:Claim) RETURN c.id AS id, c.statement AS statement, c.validFrom AS validFrom, c.supersededAt AS supersededAt, c.provenance AS provenance",
    ),
    graph(
      config,
      token,
      workspaceId,
      "MATCH (c:Claim)-[:SUBJECT]->(e:Entity) RETURN c.id AS claimId, e.id AS entityId",
    ),
    graph(
      config,
      token,
      workspaceId,
      "MATCH (c:Claim)-[:CITES]->(v:Evidence) RETURN c.id AS claimId, v.locator AS locator",
    ),
    graph(
      config,
      token,
      workspaceId,
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

  const orgs = entities.filter((e) => String(e.kind).startsWith("org:"));
  const companies: WorldCompany[] = orgs.map((e) => ({
    id: String(e.id),
    name: String(e.name),
    domain: "",
    sector: "—",
    stage: "—",
    headcount: 0,
    location: "—",
    notes: "",
  }));
  const orgBySlug = new Map(orgs.map((e) => [String(e.kind), String(e.id)]));

  const people: WorldPerson[] = entities
    .filter((e) => e.kind === "person")
    .map((entity) => {
      const personId = String(entity.id);
      const mine = claims.filter(
        (c) => subjectOf.get(String(c.id)) === personId && !c.supersededAt,
      );
      const parsed = mine.map((c) => {
        let provenance: Json = {};
        try {
          provenance = JSON.parse(String(c.provenance ?? "{}")) as Json;
        } catch {
          provenance = {};
        }
        return { claim: c, provenance };
      });

      const employment = parsed
        .filter((p) => p.provenance.verb === "WORKS_AT")
        .sort((a, b) =>
          String(b.claim.validFrom).localeCompare(String(a.claim.validFrom)),
        )[0];
      const companyId = employment
        ? (orgBySlug.get(`org:${String(employment.provenance.org)}`) ?? "")
        : "";
      const strength = parsed
        .filter((p) => p.provenance.verb === "MET")
        .reduce(
          (max, p) => Math.max(max, strengthOf(p.provenance.strength)),
          0,
        );
      const lastContact = mine.reduce(
        (latest, c) =>
          String(c.validFrom) > latest ? String(c.validFrom) : latest,
        "",
      );
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
      return {
        id: personId,
        name: String(entity.name),
        role: employment ? String(employment.provenance.title ?? "—") : "—",
        companyId,
        location: "",
        timezone: "",
        strength,
        warmth: warmthOf(quietDays),
        // Last sourced activity, not a fabricated contact date: the ledger
        // records claims, not interactions.
        lastContact: lastContact || new Date(0).toISOString(),
        tags: [],
        summary: sourced?.text ?? mappedClaims[0]?.text ?? "",
        email: "",
        claims: mappedClaims,
      };
    });

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
): Promise<Record<string, Json[]>> {
  const out: Record<string, Json[]> = {};
  for (const [collection, table] of Object.entries(TABLES)) {
    const rows = await octoSql(
      config,
      token,
      workspaceId,
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
): Promise<void> {
  await octoSql(
    config,
    token,
    workspaceId,
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
): Promise<Json | null> {
  const rows = await octoSql(
    config,
    token,
    workspaceId,
    `SELECT doc FROM ri_console.${TABLES[collection]}
     WHERE id = ${lit(id)} AND workspace_id = ${lit(workspaceId)}
       AND (visibility = 'shared' OR principal_id = ${lit(principalId)})`,
  );
  return (rows[0]?.doc as Json) ?? null;
}

export async function readWorld(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
): Promise<WorldShape> {
  const [canonical, ops] = await Promise.all([
    readCanonical(config, token, workspaceId),
    readOps(config, token, workspaceId, principal.id),
  ]);
  const {
    projects = [],
    objectives = [],
    missions = [],
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
    missions,
    plans,
    agents,
    tasks,
    runs,
    approvals,
    activity,
    people: canonical.people,
    companies: canonical.companies,
    // Events are canonical graph entities; none exist in this ledger yet.
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

export interface DecisionInput {
  approvalId: string;
  decision: "approved" | "declined";
  note?: string | undefined;
  editedAction?: string | undefined;
}

const now = () => new Date().toISOString();

/** Mirror of the seed source's materialization, written as operational rows. */
async function applyDesign(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  design: Json,
): Promise<string> {
  const due = String(design.due ?? now());
  let projectId = typeof design.projectId === "string" ? design.projectId : "";
  if (!projectId) {
    projectId = randomUUID();
    await insertDoc(config, token, workspaceId, principalId, "projects", {
      id: projectId,
      workspaceId,
      name: design.projectName ?? design.missionName,
      kind: "initiative",
      status: "active",
      owner: principalId,
      summary: design.missionSummary,
      personIds: [],
      companyIds: [],
      eventIds: [],
      startedAt: now(),
      targetDate: due,
    });
  }
  const objectiveId = randomUUID();
  await insertDoc(config, token, workspaceId, principalId, "objectives", {
    id: objectiveId,
    projectId,
    name: design.objectiveName,
    targetLabel: design.objectiveTarget,
    progress: 0,
    status: "on_track",
    dueDate: due,
  });
  const missionId = randomUUID();
  await insertDoc(config, token, workspaceId, principalId, "missions", {
    id: missionId,
    objectiveId,
    projectId,
    name: design.missionName,
    summary: design.missionSummary,
    horizon: design.horizon ?? "this_week",
    status: "queued",
    agentIds: design.agentIds ?? [],
    personIds: [],
    due,
  });
  const steps = (design.planSteps as Json[]) ?? [];
  await insertDoc(config, token, workspaceId, principalId, "plans", {
    id: randomUUID(),
    missionId,
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
  });
  return `${String(design.missionName)} is queued with a ${steps.length}-step plan.`;
}

export async function decideApproval(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
  input: DecisionInput,
): Promise<Json> {
  const approval = await getDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "approvals",
    input.approvalId,
  );
  if (!approval) throw new Error("Unknown approval");
  if (approval.status !== "pending")
    throw new Error("That decision has already been made.");

  approval.status = input.decision;
  approval.decidedAt = now();
  approval.decisionNote = input.note;
  if (input.editedAction) approval.editedAction = input.editedAction;

  let outcome: string | null = null;
  if (approval.design && input.decision === "approved") {
    outcome = await applyDesign(
      config,
      token,
      workspaceId,
      principal.id,
      approval.design as Json,
    );
  }
  await insertDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "approvals",
    approval,
  );

  const agent = await getDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "agents",
    String(approval.agentId),
  );
  if (agent) {
    const pendingRows = await octoSql(
      config,
      token,
      workspaceId,
      `SELECT doc FROM ri_console.approval
       WHERE workspace_id = ${lit(workspaceId)}
         AND (visibility = 'shared' OR principal_id = ${lit(principal.id)})`,
    );
    const remaining = pendingRows
      .map((row) => row.doc as Json)
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
    outcome: input.decision === "approved" ? "ok" : "declined",
  };
  await insertDoc(
    config,
    token,
    workspaceId,
    principal.id,
    "activity",
    activity,
  );

  const world = await readWorld(
    config,
    token,
    workspaceId,
    principal,
    workspaces,
  );
  return {
    approval,
    activity,
    agent: agent ?? { id: approval.agentId },
    world,
  };
}

export async function addProposal(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  proposal: Json,
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
  );
  return approval;
}

export async function logActivity(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principalId: string,
  entry: Json,
): Promise<Json> {
  const activity: Json = { ...entry, id: randomUUID(), at: now() };
  await insertDoc(
    config,
    token,
    workspaceId,
    principalId,
    "activity",
    activity,
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
): Promise<Json> {
  const doc = await getDoc(
    config,
    token,
    workspaceId,
    principalId,
    collection,
    id,
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
  );
  return next;
}
