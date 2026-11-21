import { buildWorldDigest } from "@/lib/digest";
import type { World } from "@/data/types";

/**
 * One spoken or quick-dock turn through the live model (#69 + floating dock).
 *
 * The reply is written to be heard: a sentence or two, plus optional safe UI
 * actions (navigate, click non-destructive controls, spotlight) so the
 * floating agent cursor can visibly drive the console while speaking.
 *
 * Any failure (signed out, guest demo, copilot server down, slow model)
 * returns null, and the caller falls back to the offline router and says so.
 */
export type VoiceIntent = "answer" | "approve" | "decline" | "skip" | "end";

export type VoiceAction =
  | { type: "navigate"; to: string; label?: string }
  | { type: "click"; target: string; label?: string }
  | { type: "spotlight"; target: string; label?: string };

export interface VoiceReply {
  say: string;
  intent: VoiceIntent;
  actions?: VoiceAction[];
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

const parseActions = (raw: unknown): VoiceAction[] => {
  if (!Array.isArray(raw)) return [];
  const out: VoiceAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label : undefined;
    if (rec.type === "navigate" && typeof rec.to === "string" && rec.to.startsWith("/")) {
      out.push({ type: "navigate", to: rec.to, label });
    } else if (rec.type === "click" && typeof rec.target === "string" && rec.target.trim()) {
      out.push({ type: "click", target: rec.target.trim(), label });
    } else if (rec.type === "spotlight" && typeof rec.target === "string" && rec.target.trim()) {
      out.push({ type: "spotlight", target: rec.target.trim(), label });
    }
  }
  return out.slice(0, 2);
};

export const askVoice = async (input: {
  heard: string;
  world: World;
  history?: string[];
  currentPath?: string;
  screenTargets?: string[];
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
        ...(input.currentPath ? { currentPath: input.currentPath.slice(0, 200) } : {}),
        ...(input.screenTargets?.length
          ? { screenTargets: input.screenTargets.slice(0, 30).map((t) => t.slice(0, 120)) }
          : {}),
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
      actions: parseActions(body.actions),
      provider: body.provider,
      model: body.model,
    };
  } catch {
    return null;
  }
};
