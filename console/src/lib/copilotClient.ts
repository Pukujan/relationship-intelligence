import { buildWorldDigest } from "@/lib/digest";
import type { MilestoneDesign } from "@/data/types";
import type { World } from "@/data/types";
import { planRequest, type CopilotAnswer } from "@/lib/orchestrator";

/**
 * Client for the copilot server.
 *
 * The live model is the brain; the keyword router in `orchestrator.ts` is the
 * fallback. When the server is unreachable or unconfigured, the caller gets a
 * local answer honestly labelled `offline-simulation`, so the console keeps
 * working and nobody mistakes a fallback for the real thing.
 */

export type AnswerSource = "live-model" | "offline-simulation";

export interface LiveCopilotAnswer extends CopilotAnswer {
  source: AnswerSource;
  provider?: string;
  model?: string;
}

export interface CopilotOptions {
  model?: string;
  reasoning?: string;
}

export interface LiveDesign {
  design: MilestoneDesign;
  source: AnswerSource;
  provider?: string;
  model?: string;
}

interface ServerAnswer {
  intentId: string;
  intentLabel: string;
  summary: string;
  agents: string[];
  steps: { label: string; agentId?: string; detail?: string }[];
  links: { label: string; href: string; kind: string }[];
  approvalIds: string[];
  provider?: string;
  model?: string;
}

const SERVER_TIMEOUT_MS = 90_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`copilot server ${response.status}`);
  }
  return (await response.json()) as T;
}

export const askCopilot = async (
  prompt: string,
  world: World,
  principalId?: string,
  options?: CopilotOptions,
): Promise<LiveCopilotAnswer> => {
  try {
    const answer = await post<ServerAnswer>("/api/copilot", {
      prompt,
      digest: buildWorldDigest(world),
      principalId,
      model: options?.model,
      reasoning: options?.reasoning,
    });
    return {
      intentId: answer.intentId,
      intentLabel: answer.intentLabel,
      summary: answer.summary,
      agents: answer.agents,
      steps: answer.steps,
      links: answer.links as LiveCopilotAnswer["links"],
      approvalIds: answer.approvalIds,
      source: "live-model",
      provider: answer.provider,
      model: answer.model,
    };
  } catch {
    return {
      ...planRequest(prompt, world),
      source: "offline-simulation",
    };
  }
};

export const askDesign = async (
  goal: string,
  world: World,
  principalId?: string,
  options?: CopilotOptions,
): Promise<LiveDesign> => {
  const design = await post<MilestoneDesign & { provider?: string; model?: string }>("/api/design", {
    goal,
    digest: buildWorldDigest(world),
    principalId,
    model: options?.model,
    reasoning: options?.reasoning,
  });
  return {
    design: { ...design, kind: "mission" },
    source: "live-model",
    provider: design.provider,
    model: design.model,
  };
};
