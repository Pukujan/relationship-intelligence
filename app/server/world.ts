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
import type { Provenance } from "../shared/contracts.js";
import {
  BeliefSchema,
  ClaimRelationSchema,
  ClaimsAsOfResponseSchema,
  EvidenceSchema,
  ProvenanceSchema,
} from "../shared/contracts.js";
import { completeAgentDoc } from "./agentShape.js";
import { completeFileDoc, completeNoteDoc } from "./knowledgeShape.js";
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
  /** Profile image URL collected from the LinkedIn profile, when visible. */
  avatarUrl?: string | undefined;
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
    source: {
      label: string;
      kind: string;
      date: string;
      locator?: string;
      excerpt?: string;
    };
    confidence: "high" | "medium" | "low";
    status: "sourced" | "unverified";
    /** Perspective stances from Octo beliefs; never an approval workflow. */
    beliefs: {
      stance: string;
      perspective?: string;
      confidence: number | null;
    }[];
    /** Content hash of the chosen evidence, when projected by Octo. */
    contentHash?: string;
    /** Typed claim status from provenance, when present. */
    claimStatus?: "SOURCED" | "UNVERIFIED";
    /** Ledger verb (FACT, WORKS_AT, MET, UNVERIFIED, ...), for profile sections. */
    verb?: string;
    /** FACT attribute (public_education, linkedin_url, ...), when present. */
    attribute?: string;
    /** How the owner knows the person, on MET claims. */
    basis?: string;
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

/** Mirrors the console's RelationshipEvent (console/src/data/types.ts). */
export interface WorldEvent {
  id: string;
  name: string;
  date: string;
  location: string;
  type: "conference" | "dinner" | "community" | "demo" | "mixer";
  attendeeIds: string[];
  goal: string;
  agentId: string;
  status: "upcoming" | "past";
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
  events: WorldEvent[];
  folders: Json[];
  files: Json[];
  notes: Json[];
  retrospectives: Json[];
  connectors: Json[];
  mcpServers: Json[];
  plugins: Json[];
  smartLists: Json[];
  /** True when Octo reports the graph projection stale or unavailable. */
  graphStale: boolean;
  generatedAt: string;
}

/**
 * Evidence returned from Octo's graph projection. Validated against the shared
 * Evidence contract; `excerpt` covers legacy projections that aliased quote.
 */
interface EvidenceRow {
  claimId: string;
  locator: string;
  excerpt: string;
  quote: string | undefined;
  contentHash: string | undefined;
  sourceFileId: string | undefined;
}

/** Belief row as projected from Octo's beliefs table. */
interface BeliefRow {
  claimId: string;
  stance: string;
  confidence: number | null;
  perspective: string | undefined;
  validFrom: string | null | undefined;
  validTo: string | null | undefined;
  recordedAt: string | null | undefined;
  supersededAt: string | null | undefined;
}

/** Claim relation row as projected by the Octo graph projector (RELATES edge). */
interface RelationRow {
  id?: string;
  fromClaimId: string;
  toClaimId: string;
  relation: string;
  supersededAt?: string | null;
}

/** Tolerant parse of a graph provenance value (JSON string or already an object). */
export function parseProvenance(value: unknown): Provenance {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const parsed = ProvenanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** True when a claim is a retirement marker (typed status or legacy verb). */
function isRetirement(provenance: Provenance): boolean {
  return (
    provenance.verb === "RETIRED" ||
    (typeof provenance.verb === "string" &&
      provenance.verb.toUpperCase() === "RETIRED") ||
    (typeof provenance.status === "string" &&
      provenance.status.toUpperCase() === "RETIRED")
  );
}

/** True when a claim is a typed corrective/superseding marker. */
function isSuperseding(
  provenance: Provenance,
  relation: string | undefined,
): boolean {
  return (
    relation === "SUPERSEDES" ||
    (typeof provenance.verb === "string" &&
      provenance.verb.toUpperCase() === "SUPERSEDES")
  );
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
 * Entities that have been retired: at least one visible current claim is a
 * retirement marker (legacy RETIRED verb or typed SUPERSEDES/status) and no
 * other current claim for that entity remains. The ledger never deletes, so
 * retiring a record supersedes its claims and adds a retirement marker; this
 * is what keeps a retired person or company off the screen.
 *
 * Scope is applied BEFORE this computation: a private retirement claim from
 * one principal must never hide a shared entity for another principal.
 */
export function retiredEntityIds(
  claims: Record<string, unknown>[],
  subjectOf: Map<string, string>,
  relations: RelationRow[] = [],
  scope?: CanonicalScope,
): Set<string> {
  const supersedesFrom = new Set(
    relations
      .filter((r) => r.relation === "SUPERSEDES" && !r.supersededAt)
      .map((r) => r.fromClaimId),
  );
  const retired = new Set<string>();
  const live = new Set<string>();
  for (const claim of claims) {
    if (claim.supersededAt) continue;
    const entityId = subjectOf.get(String(claim.id));
    if (!entityId) continue;
    const provenance = parseProvenance(claim.provenance);
    if (scope && !isClaimVisibleToScope(provenance, scope)) continue;
    if (
      isRetirement(provenance) ||
      isSuperseding(provenance, undefined) ||
      supersedesFrom.has(String(claim.id))
    ) {
      retired.add(entityId);
    } else {
      live.add(entityId);
    }
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

/**
 * Bitemporal read: GET /api/epistemic/claims-as-of with the caller's session
 * token. The response is Zod-validated; malformed upstream data never reaches
 * the people projection.
 */
export async function readClaimsAsOf(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  asOfRecorded: string,
  asOfValid?: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL("/api/epistemic/claims-as-of", config.baseUrl);
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("asOfRecorded", asOfRecorded);
  if (asOfValid) url.searchParams.set("asOfValid", asOfValid);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for claims-as-of`,
    );
  }
  const parsed = ClaimsAsOfResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Octo claims-as-of response failed contract validation");
  }
  // Map onto the same row shape the graph claim query produces.
  return parsed.data.claims.map((claim) => ({
    id: claim.id,
    statement: claim.statement,
    validFrom: claim.validFrom,
    validTo: claim.validTo ?? null,
    recordedAt: claim.recordedAt,
    supersededAt: null,
    // Provenance is already validated by ClaimSchema; pass the object through
    // parseProvenance in readCanonical (it accepts objects as well as strings).
    provenance: claim.provenance,
  }));
}

export async function readCanonical(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  scope?: CanonicalScope,
  /** Optional bitemporal claims from readClaimsAsOf; replaces graph claim rows. */
  claimsOverride?: Record<string, unknown>[],
): Promise<{
  people: WorldPerson[];
  companies: WorldCompany[];
  events: WorldEvent[];
}> {
  const [entities, claims, subjects, cites, beliefs, relations] =
    await Promise.all([
      graph(
        config,
        token,
        octoContainerId,
        "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS kind",
      ),
      claimsOverride
        ? Promise.resolve(claimsOverride)
        : graph(
            config,
            token,
            octoContainerId,
            "MATCH (c:Claim) RETURN c.id AS id, c.statement AS statement, c.validFrom AS validFrom, c.validTo AS validTo, c.recordedAt AS recordedAt, c.supersededAt AS supersededAt, c.provenance AS provenance",
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
        "MATCH (c:Claim)-[:CITES]->(v:Evidence) RETURN c.id AS claimId, v.id AS evidenceId, v.locator AS locator, v.quote AS quote, v.contentHash AS contentHash, v.sourceFileId AS sourceFileId",
      ),
      graph(
        config,
        token,
        octoContainerId,
        "MATCH (b:Belief)-[:ABOUT]->(c:Claim) RETURN c.id AS claimId, b.id AS beliefId, b.stance AS stance, b.confidence AS confidence, b.validFrom AS validFrom, b.validTo AS validTo, b.recordedAt AS recordedAt, b.supersededAt AS supersededAt",
      ),
      graph(
        config,
        token,
        octoContainerId,
        "MATCH (a:Claim)-[r:RELATES]->(b:Claim) RETURN r.id AS id, a.id AS fromClaimId, b.id AS toClaimId, r.relation AS relation, r.supersededAt AS supersededAt",
      ),
    ]);

  const subjectOf = new Map<string, string>();
  for (const row of subjects)
    subjectOf.set(String(row.claimId), String(row.entityId));

  const evidenceOf = new Map<string, EvidenceRow>();
  for (const row of cites) {
    const parsed = EvidenceSchema.safeParse({
      ...(row.evidenceId ? { id: String(row.evidenceId) } : {}),
      locator: row.locator ?? null,
      quote: row.quote ?? row.excerpt ?? null,
      contentHash: row.contentHash ?? null,
      sourceFileId: row.sourceFileId ?? null,
    });
    if (!parsed.success) continue;
    const evidence = parsed.data;
    const id = String(row.claimId);
    const previous = evidenceOf.get(id);
    const candidate: EvidenceRow = {
      claimId: id,
      locator: evidence.locator ?? "",
      excerpt: evidence.quote ?? "",
      quote: evidence.quote ?? undefined,
      contentHash: evidence.contentHash ?? undefined,
      sourceFileId: evidence.sourceFileId ?? undefined,
    };
    // Prefer the most informative evidence row: a locator, then a hash.
    const rank = (v: EvidenceRow) =>
      v.locator.length * 2 + (v.excerpt.length > 0 ? 1 : 0);
    if (!previous || rank(candidate) > rank(previous))
      evidenceOf.set(id, candidate);
  }

  const beliefsOfClaim = new Map<string, BeliefRow[]>();
  for (const row of beliefs) {
    const parsed = BeliefSchema.safeParse({
      id: String(row.beliefId ?? row.claimId ?? ""),
      claimId: String(row.claimId),
      stance: row.stance,
      confidence: row.confidence ?? null,
      perspective: row.perspective,
      validFrom: row.validFrom ?? null,
      validTo: row.validTo ?? null,
      recordedAt: row.recordedAt ?? null,
      supersededAt: row.supersededAt ?? null,
    });
    if (!parsed.success) continue;
    const id = String(row.claimId);
    const list = beliefsOfClaim.get(id) ?? [];
    list.push({
      claimId: id,
      stance: parsed.data.stance,
      confidence: parsed.data.confidence ?? null,
      perspective: parsed.data.perspective,
      validFrom: parsed.data.validFrom ?? undefined,
      validTo: parsed.data.validTo ?? undefined,
      recordedAt: parsed.data.recordedAt ?? undefined,
      supersededAt: parsed.data.supersededAt ?? undefined,
    });
    beliefsOfClaim.set(id, list);
  }

  const relationsOfClaim = new Map<string, string>();
  const validRelations: RelationRow[] = [];
  for (const row of relations) {
    const parsed = ClaimRelationSchema.safeParse({
      id: String(row.id ?? ""),
      fromClaimId: String(row.fromClaimId),
      toClaimId: String(row.toClaimId),
      relation: row.relation,
      supersededAt: row.supersededAt ?? null,
    });
    if (!parsed.success) continue;
    const relation: RelationRow = {
      id: parsed.data.id,
      fromClaimId: parsed.data.fromClaimId,
      toClaimId: parsed.data.toClaimId,
      relation: parsed.data.relation,
      supersededAt: parsed.data.supersededAt ?? null,
    };
    validRelations.push(relation);
    if (!relation.supersededAt)
      relationsOfClaim.set(relation.fromClaimId, relation.relation);
  }

  const parsedClaims = (claimsOverride ?? claims).map((claim) => ({
    claim,
    provenance: parseProvenance(claim.provenance),
  }));

  // Scope is applied first: retirement/supersession derived from a private
  // claim must not hide a shared entity from another principal.
  const scopedClaims = parsedClaims.filter(
    ({ provenance }) => !scope || isClaimVisibleToScope(provenance, scope),
  );
  const retired = retiredEntityIds(
    scopedClaims.map(({ claim }) => claim),
    subjectOf,
    validRelations,
    scope,
  );

  const parsedClaimsByEntity = new Map<string, typeof scopedClaims>();
  const relationByClaim = new Map(relationsOfClaim);
  for (const entry of scopedClaims) {
    const { claim, provenance } = entry;
    if (claim.supersededAt) continue;
    const entityId = subjectOf.get(String(claim.id));
    if (!entityId || retired.has(entityId)) continue;
    if (isRetirement(provenance)) continue;
    const supersededByRelation =
      relationByClaim.get(String(claim.id)) === "SUPERSEDES";
    if (supersededByRelation) continue;
    const list = parsedClaimsByEntity.get(entityId) ?? [];
    list.push(entry);
    parsedClaimsByEntity.set(entityId, list);
  }

  const orgs = entities.filter(
    (e) => String(e.kind).startsWith("org:") && !retired.has(String(e.id)),
  );
  const orgBySlug = new Map(orgs.map((e) => [String(e.kind), String(e.id)]));
  const referencedCompanyIds = new Set<string>();

  // Derive person fields from sourced FACT attributes in the ledger. The
  // owner's imported people carry attribute-tagged facts, not WORKS_AT claims.
  const factValue = (
    parsed: typeof scopedClaims,
    attribute: string,
  ): string => {
    const match = parsed.find(
      ({ provenance }) =>
        provenance.verb === "FACT" &&
        provenance.attribute === attribute &&
        provenance.status !== "UNVERIFIED",
    );
    return match ? String(match.claim.statement ?? "") : "";
  };
  const suffixAfter = (statement: string, marker: string): string => {
    const at = statement.toLowerCase().indexOf(marker.toLowerCase());
    return at < 0 ? "" : statement.slice(at + marker.length).trim();
  };

  // A claim is sourced only when its typed status is SOURCED and it has real
  // evidence (a locator or content hash), or when it is a legacy sourced claim
  // (no typed status) carrying evidence. UNVERIFIED is never sourced, and a
  // bare locator without a SOURCED status is not enough.
  const claimStatus = (entry: (typeof scopedClaims)[number]) => {
    const { claim, provenance } = entry;
    const evidence = evidenceOf.get(String(claim.id));
    const hasEvidence = Boolean(
      evidence?.locator || evidence?.contentHash || evidence?.quote,
    );
    const belief = beliefsOfClaim.get(String(claim.id)) ?? [];
    const disbelieved = belief.some((b) => b.stance === "disbelieves");
    const unverified =
      provenance.status === "UNVERIFIED" ||
      provenance.verb === "UNVERIFIED" ||
      disbelieved;
    const sourced =
      !unverified &&
      (provenance.status === "SOURCED"
        ? hasEvidence
        : provenance.status === undefined && hasEvidence);
    return {
      status: (sourced ? "sourced" : "unverified") as "sourced" | "unverified",
      evidence,
      belief,
    };
  };

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
    const mappedClaims = parsed.map((entry) => {
      const { claim } = entry;
      const { status, evidence, belief } = claimStatus(entry);
      const locator = evidence?.locator ?? "";
      const confidenceSource = belief.length
        ? Math.max(...belief.map((b) => b.confidence ?? 0))
        : undefined;
      return {
        id: String(claim.id),
        personId,
        text: String(claim.statement),
        source: {
          label: locator ? hostOf(locator) : "Octo ledger",
          kind: locator ? "web" : "note",
          date: String(claim.validFrom ?? ""),
          ...(locator ? { locator } : {}),
          ...(evidence?.excerpt ? { excerpt: evidence.excerpt } : {}),
        },
        confidence: confidenceOf(confidenceSource),
        status,
        beliefs: belief.map((b) => ({
          stance: b.stance,
          ...(b.perspective ? { perspective: b.perspective } : {}),
          confidence: b.confidence,
        })),
        ...(evidence?.contentHash ? { contentHash: evidence.contentHash } : {}),
        ...(entry.provenance.status
          ? { claimStatus: entry.provenance.status }
          : {}),
        ...(entry.provenance.verb
          ? { verb: String(entry.provenance.verb) }
          : {}),
        ...(entry.provenance.attribute
          ? { attribute: String(entry.provenance.attribute) }
          : {}),
        ...(entry.provenance.basis
          ? { basis: String(entry.provenance.basis) }
          : {}),
      };
    });
    const sourced = mappedClaims.find((c) => c.status === "sourced");
    const roleSummary = factValue(parsed, "public_role_summary");
    const education = factValue(parsed, "public_education");
    const credential = factValue(parsed, "public_profile_credential");
    const role = employment
      ? String(employment.provenance.title ?? "—")
      : suffixAfter(roleSummary, ":") || "—";
    const email =
      factValue(parsed, "professional_email").match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      )?.[0] ?? "";
    // Profile image collected by the slow crawler (RI-0024). A sourced FACT,
    // never inferred. Empty until a visit actually saw the photo.
    const avatarUrl = (() => {
      const value = factValue(parsed, "profile_image");
      const url = value.match(/https?:\/\/[^\s"']+/i)?.[0] ?? "";
      return url.startsWith("http") ? url.slice(0, 600) : undefined;
    })();
    const tags = [credential, education]
      .map((value) => suffixAfter(value, ":"))
      .filter(Boolean);
    // Never let an UNVERIFIED claim become the person's summary.
    const summarySource = sourced?.text ?? roleSummary ?? "";
    people.push({
      id: personId,
      name: String(entity.name),
      avatarUrl,
      role,
      companyId,
      location: suffixAfter(factValue(parsed, "location"), ":"),
      timezone: "",
      strength,
      warmth: warmthOf(quietDays),
      lastContact: lastContact || new Date(0).toISOString(),
      tags,
      summary: summarySource,
      email,
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

  // Events live in the ledger as `event:<slug>` entities. The loader stored
  // no date property, but the slug carries the event day for most sources
  // (…-2026-11-18, …-20261008, 2026-11-13-…). Only emit events whose day can
  // be read without guessing: the console formats `date` unguarded, and an
  // invented day would be a fabricated fact. "Where we met" comes from the
  // owner's self-reported `met at <title>` notes, which are claims on the
  // person and already pass the visibility filter above.
  const eventDateFromSlug = (kind: string): string => {
    const slug = kind.slice("event:".length);
    const iso = slug.match(/(\d{4})-(\d{2})-(\d{2})/);
    const compact = slug.match(/(\d{4})(\d{2})(\d{2})/);
    const parts = iso ?? compact;
    if (!parts) return "";
    const [, y, m, d] = parts;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCMonth() + 1 !== Number(m) ||
      date.getUTCDate() !== Number(d)
    ) {
      return "";
    }
    return date.toISOString();
  };

  const eventEntities = entities.filter(
    (e) => String(e.kind).startsWith("event:") && !retired.has(String(e.id)),
  );
  const eventByTitle = new Map<string, string>();
  for (const e of eventEntities) {
    if (eventDateFromSlug(String(e.kind))) {
      eventByTitle.set(String(e.name), String(e.id));
    }
  }
  const attendeesOf = new Map<string, Set<string>>();
  for (const [personId, parsed] of parsedClaimsByEntity) {
    for (const { claim, provenance } of parsed) {
      if (provenance.verb !== "UNVERIFIED") continue;
      const metAt = String(claim.statement ?? "").match(
        /\(self reported\) met at\s+(.+)$/i,
      );
      if (!metAt) continue;
      const title = metAt[1];
      if (!title) continue;
      const eventId = eventByTitle.get(title.trim());
      if (!eventId) continue;
      const set = attendeesOf.get(eventId) ?? new Set<string>();
      set.add(personId);
      attendeesOf.set(eventId, set);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const events: WorldEvent[] = [];
  for (const e of eventEntities) {
    const id = String(e.id);
    const date = eventDateFromSlug(String(e.kind));
    if (!date) continue;
    const attendeeIds = [...(attendeesOf.get(id) ?? [])];
    // Members only see events tied to people whose claims they can read;
    // the container owner sees the whole calendar, including upcoming
    // events nobody has met at yet.
    if (scope && !scope.isContainerOwner && attendeeIds.length === 0) continue;
    events.push({
      id,
      name: String(e.name),
      date,
      location: "",
      type: "community",
      attendeeIds,
      goal: "",
      agentId: "",
      status: date.slice(0, 10) < today ? "past" : "upcoming",
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  return { people, companies, events };
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

/** Ask Octo whether the graph projection is current (PROJECT.md rule 10). */
async function isGraphStale(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      new URL(
        `/api/graph/health?workspaceId=${encodeURIComponent(octoContainerId)}`,
        config.baseUrl,
      ),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    );
    if (!response.ok) return true;
    const body = (await response.json()) as Record<string, unknown>;
    return body.stale === true || body.healthy === false;
  } catch {
    return true;
  }
}

export async function readWorld(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
  octoContainerId = workspaceId,
  role = "member",
  asOf?: { recorded: string; valid: string | undefined },
): Promise<WorldShape> {
  const asOfClaims = asOf
    ? await readClaimsAsOf(
        config,
        token,
        workspaceId,
        asOf.recorded,
        asOf.valid,
      )
    : undefined;
  const [canonical, ops, graphStale] = await Promise.all([
    readCanonical(
      config,
      token,
      octoContainerId,
      {
        workspaceId,
        octoContainerId,
        principalId: principal.id,
        isContainerOwner: role === "owner" && workspaceId === octoContainerId,
      },
      asOfClaims,
    ),
    readOps(config, token, workspaceId, principal.id, octoContainerId),
    isGraphStale(config, token, octoContainerId),
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
    events: canonical.events,
    folders,
    // Fill the fields the console's knowledge views read; see knowledgeShape.ts.
    files: files.map((doc) =>
      doc && typeof doc === "object"
        ? completeFileDoc(doc as Record<string, unknown>, principal.displayName)
        : doc,
    ) as Json[],
    notes: notes.map((doc) =>
      doc && typeof doc === "object"
        ? completeNoteDoc(doc as Record<string, unknown>)
        : doc,
    ) as Json[],
    retrospectives,
    connectors,
    mcpServers,
    plugins,
    smartLists,
    graphStale,
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

/** Bitemporal world projection: people reflect claims as of the given instants. */
export async function readWorldAsOf(
  config: OctoClientConfig,
  token: string,
  workspaceId: string,
  principal: { id: string; displayName: string },
  workspaces: { id: string; name: string }[],
  asOfRecorded: string,
  asOfValid?: string,
  octoContainerId = workspaceId,
  role = "member",
): Promise<WorldShape> {
  return readWorld(
    config,
    token,
    workspaceId,
    principal,
    workspaces,
    octoContainerId,
    role,
    { recorded: asOfRecorded, valid: asOfValid },
  );
}
