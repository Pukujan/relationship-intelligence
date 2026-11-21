/**
 * Workflow canvas and API-service types the console imports. Kept free of
 * runtime dependencies (no zod) so the console builds without the app's
 * packages installed, like connectorContracts.ts.
 */

import type { ConnectorChip } from "./connectorContracts.js";

/** Outside-API service connector (RI-0021 extension): TinyFish web agent or
 * generic REST. Browser-safe view — never carries the raw key or headers. */
export type ApiServiceProvider = "tinyfish" | "rest";

export interface ApiServiceView {
  id: string;
  provider: ApiServiceProvider;
  name: string;
  baseUrl: string;
  status: "connected" | "needs_setup" | "expired" | "error";
  keyHint: string;
  hasHeaders: boolean;
  lastTest: { ok: boolean; message: string; at?: string } | null;
}

export function deriveApiServiceChip(s: ApiServiceView): ConnectorChip {
  if (s.status === "connected") return { label: "Connected", tone: "ok" };
  if (s.lastTest && !s.lastTest.ok)
    return { label: "Test failed", tone: "error" };
  return { label: "Needs setup", tone: "warn" };
}

/** Visual workflow (RI-0021 extension): an n8n-style node graph that composes
 * schedules, outside-API service calls, conditions and copilot steps. */
export type WorkflowNodeType =
  | "trigger.manual"
  | "trigger.schedule"
  | "action.api_service"
  | "action.schedule"
  | "action.copilot"
  | "action.condition"
  | "action.log";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNodeResult {
  nodeId: string;
  type: string;
  status: "running" | "success" | "error" | "skipped";
  output?: unknown;
  error?: string | null;
}

export interface WorkflowRunView {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  nodeResults: WorkflowNodeResult[];
  log: { at: string; nodeId: string; message: string }[];
}

/** Canvas node catalog metadata shared by server validation and console UI. */
export const WORKFLOW_NODE_DEFS: {
  type: WorkflowNodeType;
  label: string;
  category: "trigger" | "action" | "logic";
  description: string;
  outputs: string[];
}[] = [
  {
    type: "trigger.manual",
    label: "Manual trigger",
    category: "trigger",
    description: "Run on demand.",
    outputs: ["out"],
  },
  {
    type: "trigger.schedule",
    label: "Schedule trigger",
    category: "trigger",
    description: "Fire on a cadence (daily / weekly / once).",
    outputs: ["out"],
  },
  {
    type: "action.api_service",
    label: "API service call",
    category: "action",
    description: "Call an attached TinyFish or REST service.",
    outputs: ["out"],
  },
  {
    type: "action.schedule",
    label: "Create schedule",
    category: "action",
    description: "Create a scheduled research job (cadence + prompt).",
    outputs: ["out"],
  },
  {
    type: "action.copilot",
    label: "Copilot step",
    category: "action",
    description: "Ask the copilot model to analyze or decide.",
    outputs: ["out"],
  },
  {
    type: "action.condition",
    label: "Condition (if)",
    category: "logic",
    description: "Branch true / false on a value.",
    outputs: ["true", "false"],
  },
  {
    type: "action.log",
    label: "Log / note",
    category: "logic",
    description: "Record a message into the run log.",
    outputs: ["out"],
  },
];
