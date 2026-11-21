/**
 * OpenTelemetry / OpenInference tracing exporter for Arize Phoenix (RI-0020)
 * + immutable operational ledger helper (`ri_console.ledger_event`).
 *
 * Emits standard OTLP/HTTP JSON spans to `PHOENIX_COLLECTOR_ENDPOINT` with zero
 * external runtime dependencies, gracefully no-oping when unset while always
 * minting a W3C 32-hex `traceId` for `ri_console.ledger_event`.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { OctoClientConfig } from "./octo.js";
import { octoSql } from "./world.js";

export type OpenInferenceSpanKind =
  | "AGENT"
  | "LLM"
  | "TOOL"
  | "RETRIEVER"
  | "CHAIN";

export type CadenceKind = "daily" | "pre_event" | "signal" | "interactive";

export interface SpanContext {
  traceId: string;
  spanId: string;
  name: string;
  kind: OpenInferenceSpanKind;
  startTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
}

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "credential",
]);

const CONTENT_KEYS = new Set([
  "email_body",
  "raw_body",
  "inbox_body",
  "prompt_raw",
]);

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (REDACTED_KEYS.has(lower)) return true;
  return (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("cookie") ||
    lower.includes("authorization") ||
    lower.includes("credential")
  );
}

export function scrubAttributes(
  input: Record<string, unknown>,
  captureContent = process.env.PHOENIX_CAPTURE_CONTENT === "true",
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    if (isSensitiveKey(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (!captureContent && CONTENT_KEYS.has(key.toLowerCase())) {
      out[key] = "[REDACTED_CONTENT]";
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
      continue;
    }
    const text = String(raw).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
    out[key] = text.length > 512 ? `${text.slice(0, 512)}…` : text;
  }
  return out;
}

export function phoenixTraceUrl(
  traceId: string,
  uiUrl = process.env.PHOENIX_UI_URL,
  project = process.env.PHOENIX_PROJECT_NAME ?? "ri-prod",
): string | null {
  const base = (uiUrl ?? "").trim().replace(/\/+$/, "");
  if (!base || !traceId) return null;
  return `${base}/projects/${encodeURIComponent(project)}/traces/${traceId}`;
}

export function startSpan(params: {
  name: string;
  kind?: OpenInferenceSpanKind;
  traceId?: string;
  workspaceId?: string;
  projectId?: string;
  principalId?: string;
  agentId?: string;
  runId?: string;
  cadence?: CadenceKind;
  attributes?: Record<string, unknown>;
}): SpanContext {
  const attrs = scrubAttributes({
    "openinference.span.kind": params.kind ?? "CHAIN",
    ...(params.workspaceId ? { "ri.workspace_id": params.workspaceId } : {}),
    ...(params.projectId ? { "ri.project_id": params.projectId } : {}),
    ...(params.principalId ? { "ri.principal_id": params.principalId } : {}),
    ...(params.agentId ? { "ri.agent_id": params.agentId } : {}),
    ...(params.runId ? { "ri.run_id": params.runId } : {}),
    ...(params.cadence ? { "ri.cadence": params.cadence } : {}),
    ...(params.attributes ?? {}),
  });
  return {
    traceId: params.traceId ?? newTraceId(),
    spanId: newSpanId(),
    name: params.name,
    kind: params.kind ?? "CHAIN",
    startTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
    attributes: attrs,
  };
}

function encodeVarint(value: number | bigint): Uint8Array {
  let n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) n = BigInt.asUintN(64, n);
  const bytes: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n > 0n);
  return Uint8Array.from(bytes);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function pbTag(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function pbBytes(fieldNumber: number, data: Uint8Array): Uint8Array {
  return concatBytes([pbTag(fieldNumber, 2), encodeVarint(data.length), data]);
}

function pbString(fieldNumber: number, value: string): Uint8Array {
  return pbBytes(fieldNumber, Buffer.from(value, "utf8"));
}

function pbVarint(fieldNumber: number, value: number | bigint): Uint8Array {
  return concatBytes([pbTag(fieldNumber, 0), encodeVarint(value)]);
}

function pbFixed64(fieldNumber: number, value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
  return concatBytes([pbTag(fieldNumber, 1), buf]);
}

function pbDouble(fieldNumber: number, value: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, value, true);
  return concatBytes([pbTag(fieldNumber, 1), buf]);
}

function encodeKeyValue(
  key: string,
  val: string | number | boolean,
): Uint8Array {
  const anyVal =
    typeof val === "boolean"
      ? pbVarint(2, val ? 1 : 0)
      : typeof val === "number"
        ? Number.isInteger(val)
          ? pbVarint(3, val)
          : pbDouble(4, val)
        : pbString(1, val);
  return concatBytes([pbString(1, key), pbBytes(2, anyVal)]);
}

function encodeAttributes(
  fieldNumber: number,
  attrs: Record<string, string | number | boolean>,
): Uint8Array[] {
  return Object.entries(attrs).map(([k, v]) =>
    pbBytes(fieldNumber, encodeKeyValue(k, v)),
  );
}

export function encodeOtlpTraceProtobuf(params: {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  status: "OK" | "ERROR";
  project: string;
}): Uint8Array {
  const resource = concatBytes(
    encodeAttributes(1, {
      "service.name": "relationship-intelligence-adapter",
      "openinference.project.name": params.project,
    }),
  );
  const scope = concatBytes([
    pbString(1, "ri.telemetry"),
    pbString(2, "1.0.0"),
  ]);
  const statusMsg = pbVarint(3, params.status === "OK" ? 1 : 2);
  const spanMsg = concatBytes([
    pbBytes(1, Buffer.from(params.traceId, "hex")),
    pbBytes(2, Buffer.from(params.spanId, "hex")),
    pbString(5, params.name),
    pbVarint(6, 1),
    pbFixed64(7, BigInt(params.startTimeUnixNano)),
    pbFixed64(8, BigInt(params.endTimeUnixNano)),
    ...encodeAttributes(9, params.attributes),
    pbBytes(15, statusMsg),
  ]);
  const scopeSpans = concatBytes([pbBytes(1, scope), pbBytes(2, spanMsg)]);
  const resourceSpans = concatBytes([
    pbBytes(1, resource),
    pbBytes(2, scopeSpans),
  ]);
  return pbBytes(1, resourceSpans);
}

export async function endSpan(
  span: SpanContext,
  status: "OK" | "ERROR" = "OK",
  extraAttributes?: Record<string, unknown>,
  collectorEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT,
): Promise<{ exported: boolean; traceId: string }> {
  const endpoint = (collectorEndpoint ?? "").trim();
  if (!endpoint) {
    return { exported: false, traceId: span.traceId };
  }
  const merged = {
    ...span.attributes,
    ...(extraAttributes ? scrubAttributes(extraAttributes) : {}),
  };
  const project = process.env.PHOENIX_PROJECT_NAME ?? "ri-prod";
  const body = encodeOtlpTraceProtobuf({
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
    attributes: merged,
    status,
    project,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-protobuf",
    "User-Agent": "relationship-intelligence-adapter/1.0",
  };
  const bearer =
    process.env.PHOENIX_API_KEY?.trim() ||
    (process.env.OCTO_API_URL &&
    endpoint.startsWith(process.env.OCTO_API_URL.replace(/\/+$/, ""))
      ? process.env.OCTO_API_KEY?.trim()
      : undefined);
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: Buffer.from(body),
      signal: AbortSignal.timeout(3_000),
    });
    return { exported: res.ok, traceId: span.traceId };
  } catch {
    return { exported: false, traceId: span.traceId };
  }
}

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

export interface LedgerEventInput {
  workspaceId: string;
  projectId?: string | null;
  principalId: string;
  agentId?: string | null;
  runId?: string | null;
  traceId?: string | null;
  eventType: string;
  entityKind: string;
  entityId: string;
  payload: Record<string, unknown>;
}

/**
 * Append an immutable decision/audit record to `ri_console.ledger_event`.
 * Best-effort so writes never break if the table isn't provisioned yet.
 */
export async function appendLedgerEvent(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  event: LedgerEventInput,
  eventId?: string,
): Promise<{ id: string; traceId: string }> {
  const id = eventId ?? randomUUID();
  const traceId = event.traceId ?? newTraceId();
  const safePayload = scrubAttributes(event.payload);
  try {
    await octoSql(
      config,
      token,
      octoContainerId,
      `INSERT INTO ri_console.ledger_event
        (id, workspace_id, project_id, principal_id, agent_id, run_id, trace_id, event_type, entity_kind, entity_id, payload)
       VALUES (
        ${lit(id)},
        ${lit(event.workspaceId)},
        ${event.projectId ? lit(event.projectId) : "NULL"},
        ${lit(event.principalId)},
        ${event.agentId ? lit(event.agentId) : "NULL"},
        ${event.runId ? lit(event.runId) : "NULL"},
        ${lit(traceId)},
        ${lit(event.eventType)},
        ${lit(event.entityKind)},
        ${lit(event.entityId)},
        ${lit(JSON.stringify(safePayload))}::jsonb
       )
       ON CONFLICT (id) DO NOTHING`,
    );
  } catch {
    // Best-effort when running against minimal mocks or unprovisioned containers.
  }
  return { id, traceId };
}
