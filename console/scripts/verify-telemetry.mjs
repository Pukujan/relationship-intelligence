/**
 * Prove the telemetry chain end to end against the live workspace:
 * export one span over OTLP/protobuf, then read it back and attach an eval
 * score through Octo MCP. Run after any change to the exporter or ingest path.
 *
 *   OCTO_API_KEY=... node scripts/verify-telemetry.mjs
 *
 * Prints the trace/span ids; read-back and eval attachment are done with
 * scripts/verify-telemetry-readback.py (MCP), which takes those ids.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";

const here = path.dirname(fileURLToPath(import.meta.url));
const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
};
const env = {
  ...readEnv(path.join(here, "../../.env")),
  ...readEnv(path.join(here, "../.env")),
  ...process.env,
};
const base = (env.OCTO_API_URL ?? "").replace(/\/$/, "");
const ws = env.OCTO_WORKSPACE_ID ?? "";
const key = env.OCTO_API_KEY ?? "";
if (!base || !ws || !key) {
  console.error("set OCTO_API_URL, OCTO_API_KEY, OCTO_WORKSPACE_ID");
  process.exit(1);
}

const exporter = new OTLPTraceExporter({
  url: `${base}/api/workspaces/${ws}/otel/v1/traces`,
  headers: { Authorization: `Bearer ${key}` },
});
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "ri-console-copilot",
    "service.version": "0.1.0",
    "octo.workspace": "social-engineering",
  }),
  spanProcessors: [new BatchSpanProcessor(exporter)],
});
const tracer = provider.getTracer("ri-console", "0.1.0");
const span = tracer.startSpan("copilot.chain-verification");
span.setAttribute("verification", true);
span.setAttribute("model", env.COPILOT_MODEL ?? "qwen3.6-flash");
span.setStatus({ code: 1 });
span.end();
await provider.forceFlush();
await provider.shutdown();
const ctx = span.spanContext();
console.log(JSON.stringify({ trace_id: ctx.traceId, span_id: ctx.spanId }));
