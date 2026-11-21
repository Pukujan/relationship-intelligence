/**
 * Daemon-side wire contracts for the RI-0021 runner API (SDD §3/§4, §8).
 *
 * Every payload that crosses a trust boundary is Zod-validated here: the
 * claim response, heartbeat consents, session-status reports, ingest items,
 * persisted device state, Wispr exports, and Riley briefs. Field caps mirror
 * the server's R16 limits so the daemon never sends a body the server must
 * reject, and the pairing code follows the R2 Crockford normalization.
 *
 * These schemas describe the daemon's side of the contract. The shared
 * browser/server shapes live in app/shared/contracts.ts (R19); the daemon
 * does not re-declare those, only the device-route payloads it sends and
 * receives.
 */
import { z } from "zod";

/** The local_runner provider set (SDD §3 consent/ingest routes). */
export const RUNNER_PROVIDERS = ["linkedin", "luma", "wispr", "riley"] as const;
export type RunnerProvider = (typeof RUNNER_PROVIDERS)[number];
export const RunnerProviderSchema = z.enum(RUNNER_PROVIDERS);

/** Providers the daemon can attach a browser session for (SDD §4 signin). */
export const BROWSER_PROVIDERS = ["linkedin", "luma"] as const;
export type BrowserProvider = (typeof BROWSER_PROVIDERS)[number];
export const BrowserProviderSchema = z.enum(BROWSER_PROVIDERS);

/**
 * Consent scope catalog per provider, mirroring CONNECTOR_CATALOG in
 * app/server/connectors.ts. R11: item.scope must be one of these; the server
 * additionally requires the scope to be consented. rsvp:consent only stages
 * proposals for human approval — the daemon never executes RSVPs.
 */
export const SCOPES_BY_PROVIDER: Record<RunnerProvider, readonly [string, ...string[]]> = {
  linkedin: ["profile:read", "messages:read"],
  luma: ["events:read", "rsvp:consent"],
  wispr: ["dictation:ingest"],
  riley: ["voice:brief", "voice:triage"],
};

/** R16 per-field caps; 50 items must fit under the 256KB ingest body cap. */
export const CAPS = {
  externalId: 120,
  title: 200,
  detail: 2000,
  url: 500,
  matchText: 2000,
  accountHint: 120,
  deviceLabel: 80,
  itemsPerRequest: 50,
  ingestBodyBytes: 256 * 1024,
  briefBodyBytes: 8 * 1024,
} as const;

/** R2: Crockford base32 normalization — uppercase, I/L -> 1, O -> 0. */
export function normalizePairingCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export const PairingCodeSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{8}$/, "pairing code must be 8 Crockford base32 characters");

export const DeviceTokenSchema = z.string().regex(/^[0-9a-f]{48}$/, "device token must be 48 hex chars");

export const ClaimRequestSchema = z.object({
  code: PairingCodeSchema,
  deviceLabel: z.string().min(1).max(CAPS.deviceLabel),
});
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

/** R8: the only secret-bearing response the daemon ever receives. */
export const ClaimResponseSchema = z.object({
  deviceToken: DeviceTokenSchema,
  deviceId: z.string().min(1).max(120),
  principalId: z.string().min(1).max(120),
});
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const HeartbeatConsentSchema = z.object({
  provider: RunnerProviderSchema,
  scopes: z.array(z.string().min(1).max(80)).max(16),
  granted: z.boolean(),
});
export type HeartbeatConsent = z.infer<typeof HeartbeatConsentSchema>;

export const HeartbeatResponseSchema = z.object({
  consents: z.array(HeartbeatConsentSchema).max(16),
  now: z.string().min(1).max(40),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

/** R6: provider enum linkedin|luma; accountHint max 120. */
export const SessionStatusRequestSchema = z.object({
  provider: BrowserProviderSchema,
  ok: z.boolean(),
  accountHint: z.string().min(1).max(CAPS.accountHint).optional(),
});
export type SessionStatusRequest = z.infer<typeof SessionStatusRequestSchema>;

const ingestItemBase = {
  externalId: z.string().min(1).max(CAPS.externalId),
  title: z.string().min(1).max(CAPS.title),
  detail: z.string().max(CAPS.detail),
  occurredAt: z.string().datetime({ offset: true }),
  matchText: z.string().max(CAPS.matchText),
  url: z.string().url().max(CAPS.url).optional(),
};

/** R11: scope is a per-provider enum; unknown scopes never leave the daemon. */
export function ingestItemSchema(provider: RunnerProvider) {
  return z.object({
    ...ingestItemBase,
    scope: z.enum(SCOPES_BY_PROVIDER[provider]),
  });
}
export type IngestItem = z.infer<ReturnType<typeof ingestItemSchema>>;

export function ingestRequestSchema(provider: RunnerProvider) {
  return z.object({
    provider: z.literal(provider),
    items: z.array(ingestItemSchema(provider)).max(CAPS.itemsPerRequest),
  });
}

export const IngestRejectedSchema = z
  .object({
    externalId: z.string().optional(),
    reason: z.string().min(1).max(80),
  })
  .passthrough();

export const IngestAcceptedSchema = z.object({
  externalId: z.string().min(1).max(CAPS.externalId),
  id: z.string().min(1).max(300),
});
export const IngestResponseSchema = z.object({
  accepted: z.array(IngestAcceptedSchema).max(CAPS.itemsPerRequest),
  rejected: z.array(IngestRejectedSchema).max(CAPS.itemsPerRequest),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

/** R6: device-route 401 bodies are fixed enums. */
export const DeviceErrorSchema = z.object({
  error: z.enum(["INVALID_DEVICE_TOKEN", "DEVICE_REVOKED"]),
});
export type DeviceErrorCode = z.infer<typeof DeviceErrorSchema>["error"];

/** Persisted device state (SDD §4 + R5 localSecret). Never leaves the machine. */
export const DeviceStateSchema = z.object({
  deviceToken: DeviceTokenSchema,
  deviceId: z.string().min(1).max(120),
  server: z.string().url().max(500),
  localSecret: z.string().regex(/^[0-9a-f]{64}$/, "localSecret must be 64 hex chars"),
  principalId: z.string().min(1).max(120).optional(),
  deviceLabel: z.string().min(1).max(CAPS.deviceLabel).optional(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

/** Wispr Flow user-exported dictation record (SDD §4 wispr-watch). */
export const WisprExportSchema = z.object({
  id: z.string().min(1).max(CAPS.externalId),
  text: z.string().min(1).max(100_000),
  createdAt: z.string().datetime({ offset: true }),
});
export type WisprExport = z.infer<typeof WisprExportSchema>;

export const WisprExportFileSchema = z.union([
  WisprExportSchema,
  z.array(WisprExportSchema).min(1).max(500),
]);

/** Riley brief body (SDD §4 riley-serve; R5 secret/Host/Origin gates). */
export const RileyBriefSchema = z.object({
  id: z.string().min(1).max(CAPS.externalId),
  title: z.string().min(1).max(CAPS.title),
  detail: z.string().max(CAPS.detail),
  occurredAt: z.string().datetime({ offset: true }),
  kind: z.enum(["brief", "triage"]),
});
export type RileyBrief = z.infer<typeof RileyBriefSchema>;

/** Replace secret values anywhere they could leak into logs or errors (R9). */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}
