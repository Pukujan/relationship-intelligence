/**
 * Agent→UI action contract, adopted from Pukujan/design-bakery's copilot
 * (backend/src/copilot/tools.ts): the model proposes typed actions; code
 * decides what is legal and executes them with the app's own router, so the
 * conversation stays open while pages change.
 *
 * Guards live here, not in prompts: navigation requires an explicit human
 * confirmation (`go`), citations must name a route we actually have, and
 * scope opens pin the research thread rather than leaking context.
 */
export type CopilotAction =
  | { kind: "navigate"; path: string; label: string; go?: boolean }
  | { kind: "cite"; path: string; anchor: string; heading: string; quote?: string }
  | { kind: "openScope"; scopeKind: "person" | "project" | "mission" | "event"; id: string; label: string }
  | { kind: "ask"; text: string };

/** Routes the copilot may send a person to. Nothing outside this list. */
export const KNOWN_ROUTE_PREFIXES = [
  "/today",
  "/approvals",
  "/projects",
  "/objectives",
  "/missions",
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
      return `/missions/${action.id}`;
    case "event":
      return `/events?focus=${action.id}`;
  }
};
