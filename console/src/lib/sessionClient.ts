import type { Part } from "@/data/sessionTypes";

/**
 * SSE consumer for session turns. Parts arrive as they are validated server
 * side; phases report real progress (scoping, search, routing, validating).
 * Aborting the fetch cancels the server run via req close.
 */
export interface TurnHandlers {
  onPhase: (label: string) => void;
  onPart: (part: Part) => void;
  onDone: (info: { provider: string; model: string; reasoning: string; parts: number; dropped: number }) => void;
  onError: (message: string) => void;
}

export const streamTurn = async (
  body: { prompt: string; digest: unknown; model?: string; reasoning?: string },
  handlers: TurnHandlers,
  signal: AbortSignal,
): Promise<void> => {
  const response = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    handlers.onError(`The copilot answered ${response.status}.`);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "message";
      const dataLine = block.match(/^data: (.+)$/m)?.[1];
      if (!dataLine) continue;
      const data = JSON.parse(dataLine) as Record<string, unknown>;
      if (event === "phase") handlers.onPhase(String(data.label ?? ""));
      if (event === "part") handlers.onPart(data as unknown as Part);
      if (event === "done") {
        handlers.onDone({
          provider: String(data.provider ?? ""),
          model: String(data.model ?? ""),
          reasoning: String(data.reasoning ?? "off"),
          parts: Number(data.parts ?? 0),
          dropped: Number(data.dropped ?? 0),
        });
      }
      if (event === "error") handlers.onError(String(data.message ?? "turn failed"));
    }
  }
};
