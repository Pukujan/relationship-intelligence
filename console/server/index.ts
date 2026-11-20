/**
 * The copilot brain — a thin server-side orchestrator.
 *
 * The browser never holds the model key. It posts a compact world digest with
 * the user's prompt; this server asks the model for a structured answer and
 * validates it before anything reaches the UI. Links and ids are checked
 * against the digest, so a hallucinated person or mission cannot appear in the
 * console. If the model is unreachable, the client falls back to the local
 * keyword router and labels the answer as an offline simulation.
 *
 * Run: node --env-file-if-exists=.env server/index.ts
 */

import { createServer } from "node:http";
import { z } from "zod";
import { endSpan, recordEvals, startSpan } from "./telemetry.ts";
import { queryRag, ragPromptBlock } from "./rag.ts";
import { webSearch, webPromptBlock } from "./web.ts";
import { PartSchema, sanitizeArtifactHtml } from "../src/data/sessionTypes.ts";
import {
  askWithFailover,
  chains,
  cooldowns,
  listModels,
  parseModelJson,
  providers,
  resolveRoute,
  type Reasoning,
} from "./providers.ts";

const PORT = Number(process.env.COPILOT_PORT ?? 8799);
const BASE_URL = (process.env.TOKEN_PLAN_BASE_URL ?? "").replace(/\/$/, "");
const API_KEY = process.env.TOKEN_PLAN_API_KEY ?? "";
const MODEL = process.env.COPILOT_MODEL ?? "qwen3.6-flash";
const REQUEST_TIMEOUT_MS = 75_000;

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

const digestRef = z.enum([
  "person",
  "company",
  "approval",
  "event",
  "agent",
  "project",
  "mission",
  "objective",
]);

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const CopilotRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  digest: z.unknown(),
  principalId: z.string().max(64).optional(),
  model: z.string().max(80).optional(),
  reasoning: z.enum(["off", "low", "medium", "high"]).optional(),
  sessionId: z.string().max(60).optional(),
  history: z.array(z.string().max(1200)).max(6).optional(),
});

// The schema accepts generously and the handler clips to display limits: a
// long sentence from the model is a trim, never a 502.
const ModelAnswerSchema = z.object({
  intentLabel: z.string().min(1).max(240),
  summary: z.string().min(1).max(4_000),
  agents: z.array(z.string()).max(12).default([]),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(400),
        agentId: z.string().nullish(),
        detail: z.string().max(600).nullish(),
      }),
    )
    .min(1)
    .max(12),
  links: z
    .array(z.object({ kind: digestRef, id: z.string().max(40) }))
    .max(12)
    .default([]),
  approvalIds: z.array(z.string().max(40)).max(12).default([]),
});

const DesignRequestSchema = z.object({
  goal: z.string().min(3).max(2_000),
  digest: z.unknown(),
  principalId: z.string().max(64).optional(),
  model: z.string().max(80).optional(),
  reasoning: z.enum(["off", "low", "medium", "high"]).optional(),
  sessionId: z.string().max(60).optional(),
  history: z.array(z.string().max(1200)).max(6).optional(),
});

const ModelDesignSchema = z.object({
  missionName: z.string().min(1).max(240),
  missionSummary: z.string().min(1).max(2_000),
  projectId: z.string().max(40).nullish(),
  projectName: z.string().max(240).nullish(),
  objectiveName: z.string().min(1).max(400),
  objectiveTarget: z.string().min(1).max(400),
  horizon: z.enum(["today", "this_week"]).default("this_week"),
  dueInDays: z.number().int().min(1).max(30).default(7),
  agentIds: z.array(z.string().max(40)).min(1).max(8),
  autonomy: z.enum(["draft", "approve", "full"]).default("approve"),
  planSteps: z
    .array(
      z.object({
        label: z.string().min(1).max(400),
        detail: z.string().max(800).nullish().default(""),
        agentId: z.string().max(40).nullish(),
      }),
    )
    .min(2)
    .max(12),
  rationale: z.string().min(1).max(3_000),
  unverified: z.array(z.string().max(600)).max(10).default([]),
});

/* ------------------------------------------------------------------ */
/* Digest helpers                                                      */
/* ------------------------------------------------------------------ */

interface Digest {
  agents: { id: string }[];
  projects: { id: string; name: string }[];
  objectives: { id: string }[];
  missions: { id: string }[];
  approvals: { id: string }[];
  people: { id: string }[];
  companies: { id: string }[];
  events: { id: string }[];
}

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

const readDigest = (raw: unknown): Digest => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const ids = (key: string) =>
    asArray(source[key])
      .map((item) => (typeof item.id === "string" ? item.id : ""))
      .filter(Boolean);
  return {
    agents: ids("agents").map((id) => ({ id })),
    projects: asArray(source.projects)
      .filter((item) => typeof item.id === "string")
      .map((item) => ({ id: item.id as string, name: String(item.name ?? "") })),
    objectives: ids("objectives").map((id) => ({ id })),
    missions: ids("missions").map((id) => ({ id })),
    approvals: ids("approvals").map((id) => ({ id })),
    people: ids("people").map((id) => ({ id })),
    companies: ids("companies").map((id) => ({ id })),
    events: ids("events").map((id) => ({ id })),
  };
};

const digestList = (digest: Digest, kind: z.infer<typeof digestRef>) => {
  switch (kind) {
    case "person":
      return digest.people;
    case "company":
      return digest.companies;
    case "approval":
      return digest.approvals;
    case "event":
      return digest.events;
    case "agent":
      return digest.agents;
    case "project":
      return digest.projects;
    case "mission":
      return digest.missions;
    case "objective":
      return digest.objectives;
  }
};

const knownId = (digest: Digest, kind: z.infer<typeof digestRef>, id: string) =>
  digestList(digest, kind).some((item) => item.id === id);

const hrefFor = (kind: z.infer<typeof digestRef>, id: string): string => {
  switch (kind) {
    case "person":
      return `/people/${id}`;
    case "company":
      return `/people?tab=companies&focus=${id}`;
    case "approval":
      return `/approvals?focus=${id}`;
    case "event":
      return `/events?focus=${id}`;
    case "agent":
      return `/agents/${id}`;
    case "project":
      return `/projects/${id}`;
    case "mission":
      return `/missions/${id}`;
    case "objective":
      return `/objectives?focus=${id}`;
  }
};

const labelIn = (digest: unknown, kind: string, id: string): string | undefined => {
  const source = (digest ?? {}) as Record<string, unknown[]>;
  const list = asArray(source[kind + "s"]);
  const item = list.find((entry) => entry.id === id);
  const name = item?.name ?? item?.title;
  return typeof name === "string" ? name : undefined;
};

/* ------------------------------------------------------------------ */
/* Model call                                                          */
/* ------------------------------------------------------------------ */

const COPILOT_SYSTEM = `You are the orchestrator of "Mission Control", a relationship-intelligence console.
The user directs a small team of agents (sales, marketing, research) that work a professional
relationship graph. Answer from the WORLD DIGEST only — never invent people, companies,
missions, or ids. Trust rules: agents propose, humans decide; nothing sends or publishes without
approval; unsourced facts must be called out as unverified.
Return ONLY a JSON object shaped like:
{
  "intentLabel": "short label of what you are doing",
  "summary": "2-4 sentences of plain-language answer grounded in the digest",
  "agents": ["agent ids from the digest, max 4"],
  "steps": [{"label": "what this step does", "agentId": "optional agent id", "detail": "optional short support"}],
  "links": [{"kind": "person|company|approval|event|agent|project|mission|objective", "id": "an id that exists in the digest"}],
  "approvalIds": ["pending approval ids from the digest that relate to the answer"]
}
Keep steps between 2 and 5. Write like a calm chief of staff, not a marketing page.`;

const DESIGN_SYSTEM = `You are the research/design mode of "Mission Control", a relationship-intelligence console.
Given a vague human goal, draft work the team can approve: a mission name, a measurable objective,
and a plan. Use ONLY the WORLD DIGEST for people, companies, projects, events and agents; never
invent ids. The human stays in control: everything you produce is a proposal held for approval.
Return ONLY a JSON object shaped like:
{
  "missionName": "time-boxed unit of work, verb-first",
  "missionSummary": "1-2 sentences on what the agents will do",
  "projectId": "existing project id if this fits an existing project, otherwise omit",
  "projectName": "new project name only when projectId is omitted",
  "objectiveName": "the outcome, phrased as a change in the world",
  "objectiveTarget": "the measurable target, e.g. 3 replies this week",
  "horizon": "today|this_week",
  "dueInDays": 1-30,
  "agentIds": ["1-3 agent ids from the digest"],
  "autonomy": "draft|approve|full — recommend approve unless the work is read-only",
  "planSteps": [{"label": "step", "detail": "why/how", "agentId": "optional"}],
  "rationale": "2-3 sentences: why this mission, why this objective, what is thin",
  "unverified": ["anything the digest cannot support — facts the human should check"]
}`;

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function handleCopilot(body: unknown) {
  const request = CopilotRequestSchema.parse(body);
  const digest = readDigest(request.digest);
  const started = Date.now();
  const span = startSpan("copilot.answer", {
    model: MODEL,
    prompt_chars: request.prompt.length,
    principal_id: request.principalId ?? "anonymous",
    digest_people: digest.people.length,
    digest_missions: digest.missions.length,
  });
  try {
    const matches = await queryRag(request.prompt);
    const web = matches.length ? [] : await webSearch(request.prompt);
    const routed = await askWithFailover(
      resolveRoute(request.model, "ask"),
      COPILOT_SYSTEM,
      `USER REQUEST:\n${request.prompt}\n\nWORLD DIGEST:\n${JSON.stringify(request.digest)}${ragPromptBlock(matches)}${webPromptBlock(web)}${historyBlock(request.history)}`,
      (request.reasoning ?? "off") as Reasoning,
      REQUEST_TIMEOUT_MS,
      undefined,
      (content) => void ModelAnswerSchema.parse(parseModelJson(content)),
    );
    const answer = ModelAnswerSchema.parse(parseModelJson(routed.content));

  // Anything referencing an id that is not in the digest is dropped: the model
  // can describe the world, it cannot create entities in it. Overlong lists
  // are trimmed rather than rejected — a seventh link is noise, not an error.
  const agents = answer.agents
    .filter((id) => knownId(digest, "agent", id))
    .slice(0, 4);
  const steps = answer.steps.slice(0, 6).map((step) => ({
    label: clip(step.label, 120),
    detail: step.detail ? clip(step.detail, 160) : undefined,
    ...(step.agentId && knownId(digest, "agent", step.agentId)
      ? { agentId: step.agentId }
      : {}),
  }));
  const links = answer.links
    .filter((link) => knownId(digest, link.kind, link.id))
    .slice(0, 6)
    .map((link) => ({
      label: clip(labelIn(request.digest, link.kind, link.id) ?? link.id, 80),
      href: hrefFor(link.kind, link.id),
      kind: link.kind,
    }));
  const approvalIds = answer.approvalIds
    .filter((id) => knownId(digest, "approval", id))
    .slice(0, 6);

    const latency = Date.now() - started;
    const dropped =
      answer.links.length - links.length + (answer.agents.length - agents.length);
    const spanId = endSpan(span, true, {
      latency_ms: latency,
      provider: routed.provider,
      model: routed.model,
      reasoning: request.reasoning ?? "off",
      failovers: routed.failovers,
      links_requested: answer.links.length,
      links_resolved: links.length,
      agents_resolved: agents.length,
      steps: steps.length,
      rag_matches: matches.length,
      web_matches: web.length,
    });
    void recordEvals(spanId, [
      { name: "schema_valid", score: 1, label: "pass", explanation: "model answer parsed and clipped to contract" },
      { name: "ids_grounded", score: dropped === 0 ? 1 : 0, label: dropped === 0 ? "pass" : "fail", explanation: `${dropped} referenced id(s) absent from the world digest were dropped` },
      { name: "latency_budget", score: latency <= REQUEST_TIMEOUT_MS ? 1 : 0, label: latency <= REQUEST_TIMEOUT_MS ? "pass" : "fail", explanation: `${latency}ms against ${REQUEST_TIMEOUT_MS}ms budget` },
    ]);
    return {
      intentId: "live-copilot",
      intentLabel: clip(answer.intentLabel, 80),
      summary: clip(answer.summary, 1_200),
      agents,
      steps,
      links,
      approvalIds,
      source: "live-model",
      provider: routed.provider,
      model: routed.model,
    };
  } catch (error) {
    endSpan(span, false, {
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    throw error;
  }
}

async function handleDesign(body: unknown) {
  const request = DesignRequestSchema.parse(body);
  const digest = readDigest(request.digest);
  const started = Date.now();
  const span = startSpan("copilot.design", {
    model: MODEL,
    goal_chars: request.goal.length,
    principal_id: request.principalId ?? "anonymous",
    digest_people: digest.people.length,
    digest_projects: digest.projects.length,
  });
  try {
  const matches = await queryRag(request.goal);
  const web = matches.length ? [] : await webSearch(request.goal);
  const routed = await askWithFailover(
    resolveRoute(request.model, "design"),
    DESIGN_SYSTEM,
    `HUMAN GOAL:\n${request.goal}\n\nWORLD DIGEST:\n${JSON.stringify(request.digest)}${ragPromptBlock(matches)}${webPromptBlock(web)}`,
    (request.reasoning ?? "off") as Reasoning,
    REQUEST_TIMEOUT_MS,
    undefined,
    (content) => void ModelDesignSchema.parse(parseModelJson(content)),
  );
  const design = ModelDesignSchema.parse(parseModelJson(routed.content));

  const agentIds = design.agentIds
    .filter((id) => knownId(digest, "agent", id))
    .slice(0, 4);
  if (agentIds.length === 0) {
    throw new Error("design referenced no known agents");
  }
  const projectId =
    design.projectId && knownId(digest, "project", design.projectId)
      ? design.projectId
      : undefined;
  const planSteps = design.planSteps.slice(0, 6).map((step) => ({
    label: clip(step.label, 120),
    detail: clip(step.detail ?? "", 200),
    ...(step.agentId && knownId(digest, "agent", step.agentId)
      ? { agentId: step.agentId }
      : {}),
  }));
  const unverified = design.unverified
    .slice(0, 6)
    .map((item) => clip(item, 200));
  const due = new Date(Date.now() + design.dueInDays * 86_400_000).toISOString();

    const latency = Date.now() - started;
    const droppedAgents = design.agentIds.length - agentIds.length;
    const spanId = endSpan(span, true, {
      latency_ms: latency,
      provider: routed.provider,
      model: routed.model,
      reasoning: request.reasoning ?? "off",
      failovers: routed.failovers,
      agents_resolved: agentIds.length,
      plan_steps: planSteps.length,
      unverified_flags: unverified.length,
      project_reused: projectId ? 1 : 0,
      rag_matches: matches.length,
      web_matches: web.length,
    });
    void recordEvals(spanId, [
      { name: "schema_valid", score: 1, label: "pass", explanation: "design parsed and clipped to contract" },
      { name: "ids_grounded", score: droppedAgents === 0 && (design.projectId ? Boolean(projectId) : true) ? 1 : 0, label: "grounding", explanation: `${droppedAgents} unknown agent id(s) dropped; project reference ${design.projectId ? (projectId ? "resolved" : "dropped") : "new"}` },
      { name: "latency_budget", score: latency <= REQUEST_TIMEOUT_MS ? 1 : 0, label: latency <= REQUEST_TIMEOUT_MS ? "pass" : "fail", explanation: `${latency}ms against ${REQUEST_TIMEOUT_MS}ms budget` },
    ]);
    return {
      kind: "mission",
      missionName: clip(design.missionName, 90),
      missionSummary: clip(design.missionSummary, 600),
      projectId,
      projectName: projectId
        ? undefined
        : clip(design.projectName?.trim() ?? "", 90) || undefined,
      objectiveName: clip(design.objectiveName, 120),
      objectiveTarget: clip(design.objectiveTarget, 120),
      horizon: design.horizon,
      due,
      agentIds,
      autonomy: design.autonomy,
      planSteps,
      rationale: clip(design.rationale, 800),
      unverified,
      source: "live-model",
    };
  } catch (error) {
    endSpan(span, false, {
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    throw error;
  }
}


/* ------------------------------------------------------------------ */
/* RI-0010: streaming session turns                                    */
/* ------------------------------------------------------------------ */

const PARTS_SYSTEM = `You are the orchestrator of "Mission Control", a relationship-intelligence console.
Answer from the WORLD DIGEST and HYBRID SEARCH MATCHES only; never invent ids, people, or facts.
Return ONLY a JSON object: {"parts": [ ... ]} where each part is one of:
 {"kind":"text","text":"...","evidence":[{"label":"source","detail":"..."}]}
 {"kind":"table","columns":["..."],"rows":[["..."]]}
 {"kind":"kpi","label":"...","value":"...","delta":"...","direction":"up|down|flat"}
 {"kind":"sparkline","label":"...","series":[numbers]}
 {"kind":"graph","nodes":[{"id":"digest id","label":"name","kind":"person|company"}],"edges":[{"from":"id","to":"id","label":"relation"}]}
 {"kind":"timeline","entries":[{"at":"ISO date","label":"...","detail":"..."}]}
 {"kind":"proposal","design":{missionName,missionSummary,projectId?,projectName?,objectiveName,objectiveTarget,horizon,dueInDays,agentIds,autonomy,planSteps:[{label,detail,agentId?}],rationale,unverified:[]}}
 {"kind":"approval","approvalId":"pending approval id from digest"}
 {"kind":"artifact","title":"...","html":"<static html, no scripts>","sources":[{"label":"...","detail":"..."}]}
Prefer visual parts (table, kpi, sparkline, graph, timeline) over long prose when the data supports them.
Use 2-6 parts. Every factual part carries evidence or is flagged unverified in text. Proposals are held for
human approval; nothing sends. Artifacts are static presentations of validated data only.`;

const ChatStreamSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  digest: z.unknown(),
  model: z.string().max(80).optional(),
  reasoning: z.enum(["off", "low", "medium", "high"]).optional(),
  sessionId: z.string().max(60).optional(),
  history: z.array(z.string().max(1200)).max(6).optional(),
});

/**
 * Single-writer turn queue (#25): turns on one session serialize, so concurrent
 * submits can interleave reads but never writes. Framework-agnostic — the same
 * queue is required whether the turn pipeline is XState or LangGraph.
 */
const turnQueues = new Map<string, Promise<unknown>>();
const enqueueTurn = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
  const prev = turnQueues.get(key) ?? Promise.resolve();
  const next = prev.then(run, run);
  turnQueues.set(key, next.catch(() => undefined));
  return next;
};

const historyBlock = (history?: string[]) =>
  history && history.length
    ? `\n\nCONVERSATION SO FAR in this thread (continue from it, do not restart):\n${history
        .map((h, i) => `${i + 1}. ${h}`)
        .join("\n")}`
    : "";

const PartsAnswerSchema = z.object({ parts: z.array(PartSchema).max(12) });

function groundPart(part: z.infer<typeof PartSchema>, digest: Digest): boolean {
  if (part.kind === "graph") {
    return part.nodes.every((node) =>
      node.kind === "company"
        ? knownId(digest, "company", node.id)
        : knownId(digest, "person", node.id),
    );
  }
  if (part.kind === "approval") return knownId(digest, "approval", part.approvalId);
  if (part.kind === "proposal") {
    const design = ModelDesignSchema.safeParse(part.design);
    if (!design.success) return false;
    return design.data.agentIds.every((id) => knownId(digest, "agent", id));
  }
  return true;
}

async function handleChatStream(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  body: unknown,
) {
  const request = ChatStreamSchema.parse(body);
  const digest = readDigest(request.digest);
  return enqueueTurn(request.sessionId ?? "anonymous", () => runTurn(req, res, request, digest));
}

async function runTurn(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  request: z.infer<typeof ChatStreamSchema>,
  digest: Digest,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const started = Date.now();
  const span = startSpan("copilot.session-turn", {
    prompt_chars: request.prompt.length,
    digest_people: digest.people.length,
    reasoning: request.reasoning ?? "off",
  });
  let dropped = 0;
  let partCount = 0;
  try {
    send("phase", { label: "Scoping the world digest" });
    const matches = await queryRag(request.prompt);
    const web = matches.length ? [] : await webSearch(request.prompt);
    send("phase", { label: matches.length ? `Hybrid search: ${matches.length} matches` : "Hybrid search: index thin" });
    send("phase", { label: "Routing to a provider" });
    const routed = await askWithFailover(
      resolveRoute(request.model, "ask"),
      PARTS_SYSTEM,
      `USER REQUEST:\n${request.prompt}\n\nWORLD DIGEST:\n${JSON.stringify(request.digest)}${ragPromptBlock(matches)}${webPromptBlock(web)}${historyBlock(request.history)}`,
      (request.reasoning ?? "off") as Reasoning,
      REQUEST_TIMEOUT_MS,
      controller.signal,
      (content) => void PartsAnswerSchema.parse(parseModelJson(content)),
    );
    send("phase", { label: `Validating parts from ${routed.provider}` });
    const parsed = PartsAnswerSchema.parse(parseModelJson(routed.content));
    for (const rawPart of parsed.parts) {
      if (controller.signal.aborted) break;
      if (!groundPart(rawPart, digest)) {
        dropped++;
        continue;
      }
      const part =
        rawPart.kind === "artifact"
          ? { ...rawPart, html: sanitizeArtifactHtml(rawPart.html) }
          : rawPart.kind === "mermaid"
            ? { ...rawPart, source: rawPart.source.replace(/```/g, "").replace(/<\/script>/gi, "<\\/script>").slice(0, 4000) }
            : rawPart;
      partCount++;
      send("part", part);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const latency = Date.now() - started;
    const spanId = endSpan(span, true, {
      latency_ms: latency,
      provider: routed.provider,
      model: routed.model,
      parts: partCount,
      dropped_parts: dropped,
      failovers: routed.failovers,
    });
    void recordEvals(spanId, [
      { name: "schema_valid", score: 1, label: "pass", explanation: "parts parsed against the part contract" },
      { name: "ids_grounded", score: dropped === 0 ? 1 : 0, label: dropped === 0 ? "pass" : "fail", explanation: `${dropped} part(s) referenced ids absent from the digest` },
      { name: "sandbox_safe", score: 1, label: "pass", explanation: "artifact html sanitized server-side before streaming" },
    ]);
    send("done", { provider: routed.provider, model: routed.model, reasoning: request.reasoning ?? "off", parts: partCount, dropped });
  } catch (error) {
    if (!controller.signal.aborted) {
      endSpan(span, false, { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
      send("error", { message: error instanceof Error ? error.message : "turn failed" });
    }
  }
  res.end();
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

const json = (
  res: import("node:http").ServerResponse,
  status: number,
  value: unknown,
) => {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > 200_000) throw new Error("request body too large");
  return text ? JSON.parse(text) : {};
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const started = Date.now();
  const finish = (status: number, detail: string) => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${url.pathname} -> ${status} ${detail} (${Date.now() - started}ms)`,
    );
  };
  try {
    if (req.method === "GET" && url.pathname === "/api/web-search") {
      const q = url.searchParams.get("q") ?? "";
      json(res, 200, { results: await webSearch(q, 6) });
      finish(200, "web search");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/models") {
      json(res, 200, { providers: await listModels(), cooldowns: cooldowns(), chains: chains() });
      finish(200, "models");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      const value = {
        ok: true,
        model: MODEL,
        configured: Boolean(BASE_URL && API_KEY),
        providers: providers.map((provider) => provider.id),
        chains: chains(),
        cooldowns: cooldowns(),
      };
      json(res, 200, value);
      finish(200, "health");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat-stream") {
      await handleChatStream(req, res, await readBody(req));
      finish(200, "session turn streamed");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/copilot") {
      const answer = await handleCopilot(await readBody(req));
      json(res, 200, answer);
      finish(200, `answer "${answer.intentLabel}"`);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/design") {
      const design = await handleDesign(await readBody(req));
      json(res, 200, design);
      finish(200, `design "${design.missionName}"`);
      return;
    }
    json(res, 404, { error: "not_found" });
    finish(404, "not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const status = message === "unconfigured" ? 503 : 502;
    json(res, status, { error: "copilot_unavailable", detail: message });
    finish(status, message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `copilot server on http://127.0.0.1:${PORT} (model ${MODEL}, ${
      BASE_URL && API_KEY ? "configured" : "UNCONFIGURED — set TOKEN_PLAN_* in console/.env"
    })`,
  );
});
