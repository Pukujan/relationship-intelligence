/**
 * Agent→UI action contract, adopted from Pukujan/design-bakery's copilot
 * (backend/src/copilot/tools.ts): the model proposes typed actions; code
 * decides what is legal and executes them with the app's own router, so the
 * conversation stays open while pages change.
 *
 * Guards live here, not in prompts: navigation requires an explicit human
 * confirmation (`go`), citations must name a route we actually have, and
 * scope opens pin the research thread rather than leaking context, and a
 * proposed schedule is only created when a human explicitly confirms it.
 */
export type CopilotAction =
  | { kind: "navigate"; path: string; label: string; go?: boolean }
  | { kind: "cite"; path: string; anchor: string; heading: string; quote?: string }
  | { kind: "openScope"; scopeKind: "person" | "project" | "mission" | "event"; id: string; label: string }
  | {
      kind: "createSchedule";
      prompt: string;
      cadence: "daily" | "weekly" | "once";
      scopeKind: "workspace" | "project" | "person";
      scopeId?: string | null;
      label: string;
    }
  | { kind: "ask"; text: string };

/** Cadences the schedules API accepts; anything else is not a real schedule. */
export const SCHEDULE_CADENCES = ["daily", "weekly", "once"] as const;

/** Routes the copilot may send a person to. Nothing outside this list. */
export const KNOWN_ROUTE_PREFIXES = [
  "/today",
  "/approvals",
  "/projects",
  "/objectives",
  "/milestones",
  "/plans",
  "/people",
  "/events",
  "/calendar",
  "/agents",
  "/activity",
  "/knowledge",
  "/integrations",
  "/profile",
  "/schedules",
  "/copilot",
];

export const isKnownRoute = (path: string): boolean => {
  const clean = path.split("#")[0].split("?")[0] || "/";
  return KNOWN_ROUTE_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(prefix + "/"));
};

/** An action is executable only when its guard passes; otherwise it renders as a chip. */
export const canExecute = (action: CopilotAction): boolean => {
  switch (action.kind) {
    case "navigate":
      return Boolean(action.go) && isKnownRoute(action.path);
    case "cite":
      return isKnownRoute(action.path) && Boolean(action.anchor);
    case "openScope":
      return Boolean(action.id);
    case "createSchedule":
      return (
        Boolean(action.prompt.trim()) &&
        (SCHEDULE_CADENCES as readonly string[]).includes(action.cadence) &&
        (action.scopeKind === "workspace" ||
          ((action.scopeKind === "project" || action.scopeKind === "person") &&
            Boolean(action.scopeId)))
      );
    case "ask":
      return Boolean(action.text.trim());
  }
};

export const scopePath = (action: Extract<CopilotAction, { kind: "openScope" }>): string => {
  switch (action.scopeKind) {
    case "person":
      return `/people/${action.id}`;
    case "project":
      return `/projects/${action.id}`;
    case "mission":
      return `/milestones/${action.id}`;
    case "event":
      return `/events?focus=${action.id}`;
  }
};
