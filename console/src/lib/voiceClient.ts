import { buildWorldDigest } from "@/lib/digest";
import type { World } from "@/data/types";

/**
 * One spoken turn through the live model (#69).
 *
 * The reply is written to be heard: a sentence or two, plus what the person
 * seems to want. `intent` is advice to the page, never an action: a decision
 * is recorded only after the page reads it back and the person confirms.
 *
 * Any failure (signed out, guest demo, copilot server down, slow model)
 * returns null, and the caller falls back to the offline router and says so.
 */
export type VoiceIntent = "answer" | "approve" | "decline" | "skip" | "end";

export interface VoiceReply {
  say: string;
  intent: VoiceIntent;
  provider?: string;
  model?: string;
}

export interface VoiceApprovalContext {
  title: string;
  reason?: string;
  kind?: string;
  agentName?: string;
  risk?: string;
}

/** A little longer than the server's own budget, so its error arrives first. */
const VOICE_CLIENT_TIMEOUT_MS = 25_000;

const INTENTS: VoiceIntent[] = ["answer", "approve", "decline", "skip", "end"];

export const askVoice = async (input: {
  heard: string;
  world: World;
  history?: string[];
  approval?: VoiceApprovalContext;
}): Promise<VoiceReply | null> => {
  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        heard: input.heard.slice(0, 600),
        digest: buildWorldDigest(input.world),
        history: (input.history ?? []).slice(-8).map((line) => line.slice(0, 400)),
        ...(input.approval ? { approval: input.approval } : {}),
      }),
      signal: AbortSignal.timeout(VOICE_CLIENT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<VoiceReply>;
    if (typeof body.say !== "string" || !body.say.trim()) return null;
    return {
      say: body.say,
      intent: INTENTS.includes(body.intent as VoiceIntent) ? (body.intent as VoiceIntent) : "answer",
      provider: body.provider,
      model: body.model,
    };
  } catch {
    return null;
  }
};
