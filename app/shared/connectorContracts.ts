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
