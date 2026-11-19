/**
 * Telemetry for the copilot server, per AGENTS.md "Reaching Octo".
 *
 * Phoenix runs inside Octo: one project per workspace, derived server-side.
 * Spans go to POST /api/workspaces/<id>/otel/v1/traces as OTLP/HTTP protobuf
 * with the workspace key; eval scores go to the span_annotations endpoint.
 * There is no separate collector address, Phoenix login, or Phoenix secret.
 *
 * Evals here are deterministic CODE annotators (schema validity, id
 * grounding, latency budget). LLM-as-judge evals can be added later against
 * the same spans without changing this export path.
 */
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { Span } from "@opentelemetry/api";

const BASE = (process.env.OCTO_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.OCTO_API_KEY ?? "";
const WS = process.env.OCTO_WORKSPACE_ID ?? "";

export const telemetryEnabled = Boolean(BASE && KEY && WS);

const provider = telemetryEnabled
  ? new NodeTracerProvider({
      resource: resourceFromAttributes({
        "service.name": "ri-console-copilot",
        "service.version": "0.1.0",
        "octo.workspace_id": WS,
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${BASE}/api/workspaces/${WS}/otel/v1/traces`,
            headers: { Authorization: `Bearer ${KEY}` },
          }),
        ),
      ],
    })
  : null;

const tracer = provider?.getTracer("ri-console-copilot", "0.1.0");

export interface EvalScore {
  name: string;
  score: number;
  label: string;
  explanation: string;
}

export function startSpan(name: string, attributes: Record<string, string | number | boolean>): Span | null {
  if (!tracer) return null;
  const span = tracer.startSpan(name);
  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
  return span;
}

export function endSpan(span: Span | null, ok: boolean, attributes: Record<string, string | number | boolean> = {}): string | null {
  if (!span) return null;
  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
  span.setStatus({ code: ok ? 1 : 2 });
  span.end();
  return span.spanContext().spanId;
}

/** Attach CODE eval scores to a span; failures never break the request path. */
export async function recordEvals(spanId: string | null, scores: EvalScore[]): Promise<void> {
  if (!spanId || !telemetryEnabled || scores.length === 0) return;
  try {
    const response = await fetch(`${BASE}/api/workspaces/${WS}/otel/v1/span_annotations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: scores.map((score) => ({
          span_id: spanId,
          name: score.name,
          annotator_kind: "CODE",
          result: { score: score.score, label: score.label, explanation: score.explanation },
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`eval export ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
  } catch (error) {
    console.error("eval export failed:", error instanceof Error ? error.message : "unknown");
  }
}

export async function flushTelemetry(): Promise<void> {
  await provider?.forceFlush();
}
