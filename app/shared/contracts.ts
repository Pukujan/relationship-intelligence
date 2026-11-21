/**
 * Runtime contracts shared by the browser, the adapter, and the tests.
 *
 * These describe what crosses a trust boundary: Octo's API, our adapter's API,
 * and persisted session state. TypeScript types alone would not validate a
 * payload that arrives at runtime, so every one of them is a Zod schema.
 */
import { z } from "zod";

export const OctoPrincipalSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isGuest: z.boolean(),
  isPlatformOwner: z.boolean(),
});

export type OctoPrincipal = z.infer<typeof OctoPrincipalSchema>;

export const OctoWorkspaceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  role: z.string(),
  isOwner: z.boolean().optional(),
});

export type OctoWorkspace = z.infer<typeof OctoWorkspaceSchema>;

export const SessionStateSchema = z.object({
  authenticated: z.literal(true),
  principal: OctoPrincipalSchema,
  workspaces: z.array(OctoWorkspaceSchema),
});

export const AnonymousSessionStateSchema = z.object({
  authenticated: z.literal(false),
});

export const SessionResponseSchema = z.discriminatedUnion("authenticated", [
  SessionStateSchema,
  AnonymousSessionStateSchema,
]);

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** What the browser shows for one connected source. Never carries credentials. */
export const SourceConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: z.literal("tinyfish"),
  profileId: z.string().regex(/^prof_[a-z0-9]+$/),
  signedInSites: z.array(z.string()),
  status: z.enum(["connected", "setup_required", "expired", "error"]),
  lastCheckedAt: z.string().datetime().nullable(),
});

export type SourceConnection = z.infer<typeof SourceConnectionSchema>;

export const CollectionPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  sources: z
    .array(z.enum(["linkedin", "luma", "x", "gmail", "calendar"]))
    .min(1),
  seedUrls: z.array(z.string().url()).min(1).max(50),
  maxPagesPerRun: z.number().int().min(1).max(500),
  maxDepth: z.number().int().min(0).max(5),
  scheduleCron: z.string().max(120).nullable(),
  createdAt: z.string().datetime(),
});

export type CollectionPlan = z.infer<typeof CollectionPlanSchema>;

/* ------------------------------------------------------------------ */
/* Octo epistemic data contracts (PROJECT.md canonical ledger)         */
/* ------------------------------------------------------------------ */

/** Controlled relationship vocabulary from docs/PLAN.md:80-102. */
export const EntityTypeSchema = z.enum([
  "person",
  "organization",
  "project",
  "event",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EpistemicEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entityType: z.string().min(1),
});
export type EpistemicEntity = z.infer<typeof EpistemicEntitySchema>;

/**
 * Relationship verbs are typed; legacy ledger rows carry ad-hoc verbs
 * (FACT, MET, NOTE, RETIRED, ...). Provenance is parsed tolerantly and a
 * non-vocabulary verb is preserved as a string rather than rejecting the row.
 */
export const RelationshipVerbSchema = z.enum([
  "WORKS_AT",
  "REGISTERED",
  "RSVPED",
  "ATTENDED",
  "SPOKE_AT",
  "ORGANIZED",
  "SPONSORED",
  "MAINTAINS",
  "CONTRIBUTED_TO",
  "COLLABORATED_ON",
  "CONNECTED_TO",
  "SAME_AS",
  "DIFFERENT_FROM",
]);
export type RelationshipVerb = z.infer<typeof RelationshipVerbSchema>;

export const LegacyVerbSchema = z.string().min(1);
export type LegacyVerb = z.infer<typeof LegacyVerbSchema>;

/** Controlled claim statuses. UNVERIFIED claims never become summaries. */
export const ClaimStatusSchema = z.enum(["SOURCED", "UNVERIFIED"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** A source record / entity mention is identified by a stable source key. */
export const SourceRecordIdSchema = z.object({
  source_system: z.string().min(1),
  source_record_id: z.string().min(1),
});
export type SourceRecordId = z.infer<typeof SourceRecordIdSchema>;

/**
 * Provenance stored on an Octo claim. All fields are optional so legacy rows
 * (which only carry {verb, seedId, ...}) keep parsing. `verb` is typed when it
 * matches the vocabulary and retained as a legacy string otherwise.
 */
export const ProvenanceSchema = z.object({
  verb: z.union([RelationshipVerbSchema, LegacyVerbSchema]).optional(),
  attribute: z.string().optional(),
  org: z.string().optional(),
  title: z.string().optional(),
  strength: z.string().optional(),
  /** How the owner knows the person, on MET claims ("met at GIS Day ..."). */
  basis: z.string().optional(),
  seedId: z.string().optional(),
  reason: z.string().optional(),
  status: ClaimStatusSchema.optional(),
  source: z.string().optional(),
  sourceRecord: SourceRecordIdSchema.optional(),
  workspaceId: z.string().optional(),
  visibility: z.enum(["shared", "private"]).optional(),
  principalId: z.string().optional(),
  ownerId: z.string().optional(),
  sharedWorkspaces: z.array(z.string()).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** One immutable source reference with an exact locator when available. */
export const EvidenceSchema = z.object({
  // Legacy graph projections did not select v.id; tolerate a missing id.
  id: z.string().min(1).optional(),
  locator: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  sourceFileId: z.string().nullable().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** One perspective's stance on a claim (bitemporal in the ledger). */
export const BeliefSchema = z.object({
  id: z.string().min(1),
  claimId: z.string().min(1),
  perspectiveId: z.string().min(1).optional(),
  stance: z.enum(["believes", "disbelieves", "uncertain"]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  perspective: z.string().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  recordedAt: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
});
export type Belief = z.infer<typeof BeliefSchema>;

/** A typed claim, with optional temporal and provenance fields for legacy rows. */
export const ClaimSchema = z.object({
  id: z.string().min(1),
  subjectEntityId: z.string().nullable().optional(),
  statement: z.string(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  recordedAt: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
  provenance: ProvenanceSchema.default({}),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** GET /api/epistemic/claims-as-of response (bitemporal query mode 2). */
export const ClaimsAsOfResponseSchema = z.object({
  asOfRecorded: z.string(),
  asOfValid: z.string().nullable(),
  claims: z.array(ClaimSchema),
});
export type ClaimsAsOfResponse = z.infer<typeof ClaimsAsOfResponseSchema>;

/** Claim-to-claim relations, including the typed corrective relation. */
export const ClaimRelationTypeSchema = z.enum([
  "SUPPORTS",
  "CONTRADICTS",
  "SUPERSEDES",
  "QUALIFIES",
  "DERIVED_FROM",
  "DUPLICATES",
  "REFINES",
]);
export type ClaimRelationType = z.infer<typeof ClaimRelationTypeSchema>;

export const ClaimRelationSchema = z.object({
  id: z.string().min(1),
  fromClaimId: z.string().min(1),
  toClaimId: z.string().min(1),
  relation: ClaimRelationTypeSchema,
  recordedAt: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
});
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>;

/** A correction that closes the claim it supersedes; never a delete. */
export const SupersedesRelationSchema = ClaimRelationSchema.extend({
  relation: z.literal("SUPERSEDES"),
});
export type SupersedesRelation = z.infer<typeof SupersedesRelationSchema>;
