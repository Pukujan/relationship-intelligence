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
