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

/**
 * Shared connector contract (RI-0021). Server returns this shape; console
 * imports it. Do not re-declare connector types locally (SDD R19).
 */

export type ConnectorProviderId =
  | "gmail"
  | "gcal"
  | "gdrive"
  | "zoom"
  | "calendly"
  | "linkedin"
  | "luma"
  | "slack"
  | "discord"
  | "wispr"
  | "riley";

export type ConnectorAuthKind =
  | "google_oauth"
  | "zoom_oauth"
  | "provider_oauth"
  | "local_runner";

export type ConnectorCategory =
  | "google"
  | "meetings"
  | "messaging"
  | "network"
  | "voice";

export type RunnerStatus = "unpaired" | "online" | "offline";

export interface UserConnectorView {
  provider: ConnectorProviderId;
  name: string;
  category: ConnectorCategory;
  authKind: ConnectorAuthKind;
  oauthConfigured: boolean;
  connectUrl: string | null;
  status: "connected" | "needs_setup" | "expired";
  accountEmail: string | null;
  scopes: string[];
  description: string;
  lastSync: string | null;
  /** local_runner only; null for OAuth kinds. */
  runnerStatus: RunnerStatus | null;
  /** local_runner only; null for OAuth kinds. */
  consentedScopes: string[] | null;
}

/** Prefix for the unconfigured-OAuth label "Add <PREFIX>_CLIENT_ID/SECRET". */
export const CONNECTOR_CRED_PREFIX: Partial<
  Record<ConnectorProviderId, string>
> = {
  slack: "SLACK",
  calendly: "CALENDLY",
  discord: "DISCORD",
  zoom: "ZOOM",
};

export interface ConnectorChip {
  label: string;
  tone: "ok" | "warn" | "error" | "muted";
}

/** Chip precedence: expired > device offline > needs setup/unpaired > connected. */
export function deriveConnectorChip(c: UserConnectorView): ConnectorChip {
  if (c.status === "expired") return { label: "Re-auth needed", tone: "error" };
  if (c.authKind === "local_runner") {
    if (c.runnerStatus === "offline")
      return { label: "Device offline", tone: "warn" };
    if (c.runnerStatus === "unpaired" || c.status === "needs_setup")
      return { label: "Needs setup", tone: "warn" };
    return { label: "Connected", tone: "ok" };
  }
  if (c.status === "connected") return { label: "Connected", tone: "ok" };
  return { label: "Needs setup", tone: "muted" };
}
