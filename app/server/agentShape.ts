/**
 * The shape the console needs from every agent row.
 *
 * The Agents page groups agents by team (`icon`) and its cards read `tone`,
 * `sparkline`, `kpis` and `joinedAt`. An agent installed from a template or
 * built by hand was saved without those fields, so it was stored but never
 * shown. `completeAgentDoc` fills them, both when an agent is created and when
 * the world is read, which also repairs rows saved before this existed.
 */

export const AGENT_DOMAINS = ["sales", "marketing", "research"] as const;
export type AgentDomain = (typeof AGENT_DOMAINS)[number];

const TONE: Record<AgentDomain, "coral" | "indigo" | "teal"> = {
  sales: "coral",
  marketing: "indigo",
  research: "teal",
};

/** Autonomy zone (issue #49) to the console's three autonomy levels. */
const AUTONOMY: Record<string, "draft" | "approve" | "full"> = {
  prep: "full",
  suggest: "approve",
  co_design: "draft",
};

const isDomain = (value: unknown): value is AgentDomain =>
  typeof value === "string" &&
  (AGENT_DOMAINS as readonly string[]).includes(value);

const text = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

export function completeAgentDoc<T extends Record<string, unknown>>(
  doc: T,
): T & Record<string, unknown> {
  const domain: AgentDomain = isDomain(doc.icon)
    ? doc.icon
    : isDomain(doc.domain)
      ? doc.domain
      : "research";
  const autonomy =
    doc.autonomy === "draft" ||
    doc.autonomy === "approve" ||
    doc.autonomy === "full"
      ? doc.autonomy
      : (AUTONOMY[String(doc.autonomyZone)] ?? "approve");
  return {
    ...doc,
    icon: domain,
    tone:
      doc.tone === "coral" || doc.tone === "indigo" || doc.tone === "teal"
        ? doc.tone
        : TONE[domain],
    mission: text(doc.mission, text(doc.instructions, "")),
    status: text(doc.status, "idle"),
    autonomy,
    currentTask: doc.currentTask ?? null,
    sparkline: Array.isArray(doc.sparkline) ? doc.sparkline : [],
    kpis: Array.isArray(doc.kpis) ? doc.kpis : [],
    joinedAt: text(
      doc.joinedAt,
      text(doc.createdAt, new Date(0).toISOString()),
    ),
  };
}
