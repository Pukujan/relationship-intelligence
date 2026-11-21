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

/** The agent statuses the console knows (`AgentStatus` in console types). */
const AGENT_STATUSES = ["idle", "running", "needs_you", "paused"];

/**
 * Whether the owner has paused this agent (#101).
 *
 * `paused: true` is the stored record of the owner's pause; the console's
 * Pause writes it together with `status: "paused"`, and Resume clears both.
 * Rows paused before the flag existed carry only the status, so either one
 * counts. The runner and the world read behind the console both decide with
 * this function, and `PAUSED_SQL` in executor.ts is the same test in SQL.
 */
export const isAgentPaused = (
  doc: Record<string, unknown> | null | undefined,
): boolean => doc?.paused === true || doc?.status === "paused";

/**
 * What the console's Pause and Resume write to an agent row, or null for a
 * status the console does not know. Pause sets the flag and clears the
 * current task; any other status clears the flag, so a row paused either way
 * resumes.
 */
export function agentStatusPatch(
  status: unknown,
): Record<string, unknown> | null {
  if (typeof status !== "string" || !AGENT_STATUSES.includes(status)) {
    return null;
  }
  const paused = status === "paused";
  return { status, paused, ...(paused ? { currentTask: null } : {}) };
}

export function completeAgentDoc<T extends Record<string, unknown>>(
  doc: T,
): T & Record<string, unknown> {
  const paused = isAgentPaused(doc);
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
    paused,
    status: paused ? "paused" : text(doc.status, "idle"),
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
