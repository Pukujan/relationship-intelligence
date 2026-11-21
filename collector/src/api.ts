/**
 * Daemon HTTP client for the RI-0021 runner contract. Validates every
 * response at the boundary; 401 bodies map to fixed device-error enums (R6);
 * secrets are redacted from any error text (R9).
 */
import {
  ClaimResponseSchema,
  DeviceErrorSchema,
  HeartbeatResponseSchema,
  IngestResponseSchema,
  ingestRequestSchema,
  redactSecrets,
  type ClaimResponse,
  type HeartbeatResponse,
  type IngestItem,
  type IngestResponse,
  type RunnerProvider,
} from "./contracts.js";

export class DeviceAuthError extends Error {
  constructor(public code: "INVALID_DEVICE_TOKEN" | "DEVICE_REVOKED") {
    super(code);
    this.name = "DeviceAuthError";
  }
}

export class RunnerApi {
  constructor(
    private server: string,
    private token?: string,
  ) {}

  private async post(path: string, body: unknown, auth: boolean): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.server}/app-api/connectors/runner/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      const parsed = DeviceErrorSchema.safeParse(await res.json().catch(() => null));
      throw new DeviceAuthError(parsed.success ? parsed.data.error : "INVALID_DEVICE_TOKEN");
    }
    if (!res.ok) {
      throw new Error(redactSecrets(`runner ${path} HTTP ${res.status}`, this.token ? [this.token] : []));
    }
    return res.json();
  }

  async claim(code: string, deviceLabel: string): Promise<ClaimResponse> {
    return ClaimResponseSchema.parse(await this.post("claim", { code, deviceLabel }, false));
  }

  async heartbeat(): Promise<HeartbeatResponse> {
    return HeartbeatResponseSchema.parse(await this.post("heartbeat", {}, true));
  }

  async sessionStatus(provider: "linkedin" | "luma", ok: boolean, accountHint?: string): Promise<void> {
    await this.post("session-status", { provider, ok, ...(accountHint ? { accountHint } : {}) }, true);
  }

  async ingest(provider: RunnerProvider, items: IngestItem[]): Promise<IngestResponse> {
    const body = ingestRequestSchema(provider).parse({ provider, items });
    return IngestResponseSchema.parse(await this.post("ingest", body, true));
  }
}
