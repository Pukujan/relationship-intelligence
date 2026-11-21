import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  MessageSquare,
  Mic,
  Phone,
  PhoneOff,
  Send,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useSpeech } from "@/hooks/useSpeech";
import { askVoice, type VoiceAction, type VoiceApprovalContext } from "@/lib/voiceClient";
import {
  isConversationOver,
  parseVoiceCommand,
  resolveConfirmation,
} from "@/lib/voiceCommands";
import { agentCursor, collectScreenTargets } from "./agentCursor";
import { Button } from "@/components/ui/button";

interface DockMessage {
  id: string;
  role: "you" | "copilot";
  text: string;
  actions?: VoiceAction[];
  at: string;
}

let msgSeq = 0;
const makeMsg = (
  role: DockMessage["role"],
  text: string,
  actions?: VoiceAction[],
): DockMessage => ({
  id: `dock-${++msgSeq}`,
  role,
  text,
  actions,
  at: new Date().toISOString(),
});

const VOICE_MUTE_KEY = "ri_dock_voice_muted";

/**
 * Persistent floating bottom-right voice + chat dock (inspired by design-bakery's CopilotDock).
 *
 * Mounted in AppShell so live hands-free voice conversations and approval calls keep running
 * in the background while screens change and the animated agent cursor clicks safe controls.
 */
export const CopilotDock = () => {
  const { world } = useData();
  const {
    call,
    callApprovals,
    startCall,
    callDecision,
    callSkip,
    endCall,
    answerFor,
  } = useOrchestrator();
  const location = useLocation();
  const navigate = useNavigate();

  const speech = useSpeech();
  const {
    engine,
    canListen,
    listening,
    speaking,
    interim,
    level,
    listenError,
    listen,
    stopListening,
    speak,
    stopSpeaking,
  } = speech;

  const [open, setOpen] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [peek, setPeek] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => {
    try {
      return window.localStorage.getItem(VOICE_MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [messages, setMessages] = useState<DockMessage[]>([
    makeMsg(
      "copilot",
      "Hey — tap the mic orb to talk hands-free, or type here. I can answer questions, open pages, and click around while we talk.",
    ),
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>([]);
  const liveModeRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const worldRef = useRef(world);
  worldRef.current = world;
  const locationRef = useRef(location);
  locationRef.current = location;
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingConfirmRef = useRef<"approved" | "declined" | null>(null);

  const toggleMuted = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(VOICE_MUTE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      if (next) stopSpeaking();
      return next;
    });
  };

  const showPeek = useCallback((text: string) => {
    clearTimeout(peekTimerRef.current);
    setPeek(text);
    peekTimerRef.current = setTimeout(() => setPeek(null), 5500);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, open]);

  const remember = (role: "you" | "copilot", text: string) => {
    historyRef.current = [...historyRef.current, `${role}: ${text}`].slice(-8);
  };

  const currentApproval = callApprovals[call.index];
  const onCall = call.state === "live" || call.state === "ringing";

  // Keep latest call actions in a ref for async speech callbacks.
  const callRef = useRef({
    call,
    currentApproval,
    callDecision,
    callSkip,
    endCall,
  });
  callRef.current = { call, currentApproval, callDecision, callSkip, endCall };

  const stopLiveVoice = useCallback(() => {
    liveModeRef.current = false;
    setLiveMode(false);
    pendingConfirmRef.current = null;
    stopListening();
    stopSpeaking();
  }, [stopListening, stopSpeaking]);

  // Core turn handler used by BOTH voice and typed chat in the floating dock.
  const runTurn = useCallback(
    async (
      prompt: string,
      opts: { fromVoice: boolean; continueListening?: () => void },
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      if (opts.fromVoice && isConversationOver(trimmed)) {
        const bye = "Got it — tap the orb whenever you need me.";
        setMessages((prev) => [
          ...prev,
          makeMsg("you", trimmed),
          makeMsg("copilot", bye),
        ]);
        stopLiveVoice();
        if (!mutedRef.current) speak(bye);
        else showPeek(bye);
        return;
      }

      // If an approval call is live, handle verbal confirmation / direct commands first.
      const activeCall = callRef.current;
      if (activeCall.call.state === "live" && activeCall.currentApproval) {
        if (pendingConfirmRef.current) {
          const decision = pendingConfirmRef.current;
          pendingConfirmRef.current = null;
          const verdict = resolveConfirmation(trimmed);
          if (verdict === "confirm") {
            setMessages((prev) => [...prev, makeMsg("you", trimmed)]);
            await activeCall.callDecision(decision);
            return;
          }
          const cancelMsg =
            verdict === "cancel"
              ? "Okay, nothing recorded. Approve, decline, or skip?"
              : "Didn't catch a yes, so nothing recorded. Approve, decline, or skip?";
          setMessages((prev) => [
            ...prev,
            makeMsg("you", trimmed),
            makeMsg("copilot", cancelMsg),
          ]);
          if (!mutedRef.current) speak(cancelMsg, opts.continueListening);
          else opts.continueListening?.();
          return;
        }
        const cmd = parseVoiceCommand(trimmed);
        if (cmd === "approve") return void activeCall.callDecision("approved");
        if (cmd === "decline") return void activeCall.callDecision("declined");
        if (cmd === "skip") return activeCall.callSkip();
        if (cmd === "end") {
          stopLiveVoice();
          return activeCall.endCall();
        }
      }

      setMessages((prev) => [...prev, makeMsg("you", trimmed)]);
      remember("you", trimmed);
      setThinking(true);

      const currentWorld = worldRef.current;
      const approvalCtx: VoiceApprovalContext | undefined =
        activeCall.call.state === "live" && activeCall.currentApproval
          ? {
              title: activeCall.currentApproval.title,
              reason: activeCall.currentApproval.reason,
              kind: activeCall.currentApproval.kind,
              risk: activeCall.currentApproval.risk,
            }
          : undefined;

      let say: string;
      let actions: VoiceAction[] = [];
      let endAfter = false;

      try {
        const reply = currentWorld
          ? await askVoice({
              heard: trimmed,
              world: currentWorld,
              history: historyRef.current,
              currentPath: `${locationRef.current.pathname}${locationRef.current.search}`,
              screenTargets: collectScreenTargets(),
              approval: approvalCtx,
            })
          : null;

        if (reply) {
          if (reply.intent === "skip" && activeCall.call.state === "live") {
            setThinking(false);
            activeCall.callSkip();
            return;
          }
          if (reply.intent === "end") {
            endAfter = true;
            if (activeCall.call.state === "live") activeCall.endCall();
          }
          if (
            (reply.intent === "approve" || reply.intent === "decline") &&
            activeCall.call.state === "live" &&
            activeCall.currentApproval
          ) {
            const approving = reply.intent === "approve";
            pendingConfirmRef.current = approving ? "approved" : "declined";
            say = `${approving ? "Approve" : "Decline"} "${activeCall.currentApproval.title}"? Say yes or no.`;
          } else {
            say = reply.say;
            actions = reply.actions ?? [];
          }
        } else {
          const fallback = answerFor(trimmed);
          say = fallback?.summary ?? "I couldn't reach the copilot just now.";
          if (fallback?.links?.[0]?.href) {
            actions = [
              {
                type: "navigate",
                to: fallback.links[0].href,
                label: `Opening ${fallback.links[0].label}`,
              },
            ];
          }
        }
      } finally {
        setThinking(false);
      }

      setMessages((prev) => [...prev, makeMsg("copilot", say, actions)]);
      remember("copilot", say);
      if (!open) showPeek(say);

      // Run UI actions (cursor glides & clicks/navigates) concurrently with speech!
      if (actions.length > 0) {
        void agentCursor.runActions(actions, navigate);
      }

      if (endAfter) {
        stopLiveVoice();
        if (!mutedRef.current) speak(say);
        return;
      }

      if (!mutedRef.current && (opts.fromVoice || open)) {
        speak(say, opts.continueListening);
      } else {
        opts.continueListening?.();
      }
    },
    [answerFor, navigate, open, showPeek, speak, stopLiveVoice],
  );

  // Continuous hands-free voice loop.
  const listenLoop = useCallback(() => {
    if (!liveModeRef.current) return;
    listen({
      onHeard: (text) => {
        if (!liveModeRef.current) return;
        void runTurn(text, {
          fromVoice: true,
          continueListening: () => {
            if (liveModeRef.current) listenLoop();
          },
        });
      },
      onError: (err) => {
        if (!liveModeRef.current) return;
        if (err === "no-speech") {
          // Stay gently alive for one pause or end cleanly if user stopped talking.
          stopLiveVoice();
          showPeek("Paused listening. Tap the orb anytime.");
          return;
        }
        stopLiveVoice();
        if (err === "blocked") {
          showPeek("Allow microphone access in your browser to talk live.");
        }
      },
    });
  }, [listen, runTurn, showPeek, stopLiveVoice]);

  const handleOrbClick = () => {
    if (!canListen) {
      setOpen(true);
      showPeek("Allow microphone access in site settings to talk live.");
      return;
    }
    // Barge-in: if the assistant is speaking during live mode, interrupt and listen immediately!
    if (liveModeRef.current && speaking) {
      stopSpeaking();
      listenLoop();
      return;
    }
    if (liveModeRef.current || listening) {
      stopLiveVoice();
      return;
    }
    liveModeRef.current = true;
    setLiveMode(true);
    setPeek(null);
    listenLoop();
  };

  // Background approval-call narration when the user navigates away from /voice.
  const spokenCallIdxRef = useRef(0);
  useEffect(() => {
    if (!onCall) {
      spokenCallIdxRef.current = 0;
      return;
    }
    // Let Voice.tsx handle narration when the user is actively on /voice.
    if (location.pathname === "/voice") {
      spokenCallIdxRef.current = call.transcript.length;
      return;
    }
    const fresh = call.transcript.slice(spokenCallIdxRef.current);
    spokenCallIdxRef.current = call.transcript.length;
    for (const entry of fresh) {
      if (entry.role === "copilot") {
        showPeek(entry.text);
        if (!mutedRef.current) {
          speak(entry.text, () => {
            if (liveModeRef.current) listenLoop();
          });
        }
      }
    }
  }, [call.transcript, listenLoop, location.pathname, onCall, showPeek, speak]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    void runTurn(text, { fromVoice: false });
  };

  const orbStatus = useMemo(() => {
    if (thinking) return "Thinking…";
    if (listening) return interim || "Listening…";
    if (speaking) return "Speaking… (tap to interrupt)";
    if (onCall) return call.state === "ringing" ? "Ringing…" : "On call";
    if (liveMode) return "Live";
    return null;
  }, [call.state, interim, listening, liveMode, onCall, speaking, thinking]);

  return (
    <div
      data-copilot-dock
      className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2.5 sm:bottom-5 sm:right-5"
    >
      {/* Expandable non-blocking bottom-right chat + transcript layer */}
      {open ? (
        <section
          aria-label="Live copilot dock"
          className="flex h-[470px] max-h-[72vh] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border",
                liveMode || onCall
                  ? "border-run/40 bg-run/15 text-run"
                  : "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              <Sparkles className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold leading-tight">
                Live Copilot
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {engine
                  ? `${engine.stt} · ${engine.tts}`
                  : "Voice + screen actions"}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleMuted}
              aria-label={muted ? "Unmute spoken replies" : "Mute spoken replies"}
              title={muted ? "Unmute voice replies" : "Mute voice replies"}
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {muted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (onCall) {
                  stopLiveVoice();
                  endCall();
                } else {
                  startCall();
                  if (!liveModeRef.current && canListen) {
                    liveModeRef.current = true;
                    setLiveMode(true);
                  }
                }
              }}
              aria-label={onCall ? "End background call" : "Start approval call"}
              title={onCall ? "End call" : "Call me for approvals"}
              className={cn(
                "focus-ring inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10.5px] font-medium transition-colors",
                onCall
                  ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "border-border/70 bg-surface-1 text-muted-foreground hover:text-foreground",
              )}
            >
              {onCall ? (
                <>
                  <PhoneOff className="h-3 w-3" />
                  End
                </>
              ) : (
                <>
                  <Phone className="h-3 w-3" />
                  Call
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize chat dock"
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Background call banner inside the dock */}
          {call.state === "live" && currentApproval ? (
            <div className="border-b border-run/25 bg-run/[0.06] px-3.5 py-2">
              <div className="flex items-center justify-between text-[10px] font-medium text-run">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
                  Approval call · {call.index + 1}/{call.queue.length}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] font-medium text-foreground">
                {currentApproval.title}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="h-6 flex-1 rounded-md text-[10.5px]"
                  onClick={() => void callDecision("approved")}
                >
                  <Check className="h-3 w-3" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 rounded-md text-[10.5px]"
                  onClick={() => void callDecision("declined")}
                >
                  <X className="h-3 w-3" />
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 rounded-md px-1.5 text-[10.5px]"
                  onClick={callSkip}
                >
                  <SkipForward className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : null}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
            aria-live="polite"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1",
                  msg.role === "you" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed",
                    msg.role === "you"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-border/60 bg-surface-1 text-foreground",
                  )}
                >
                  {msg.text}
                </div>
                {msg.actions?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {msg.actions.map((action, idx) => (
                      <span
                        key={`${msg.id}-act-${idx}`}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                      >
                        <ArrowUpRight className="h-2.5 w-2.5" />
                        {action.label ||
                          (action.type === "navigate"
                            ? action.to
                            : action.target)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {thinking ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Thinking…
              </div>
            ) : null}

            {listening ? (
              <div className="flex items-center gap-2 text-[11px] text-run">
                <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
                {interim || "Listening…"}
              </div>
            ) : null}
          </div>

          {/* Input composer */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 border-t border-border/60 bg-surface-1/60 p-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything or say “open approvals”…"
              className="focus-ring h-9 min-w-0 flex-1 rounded-xl border border-border/70 bg-background px-3 text-[12px] text-foreground placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              onClick={handleOrbClick}
              aria-label={liveMode ? "Stop voice" : "Talk hands-free"}
              className={cn(
                "focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
                liveMode || listening
                  ? "border-run/40 bg-run/15 text-run"
                  : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || thinking}
              aria-label="Send message"
              className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </section>
      ) : null}

      {/* Floating status / reply peek bubble when minimized */}
      {!open && (orbStatus || peek || listenError === "blocked") ? (
        <div className="max-w-[290px] rounded-2xl border border-border/80 bg-background/95 px-3 py-2 text-[11.5px] leading-snug text-foreground shadow-lg backdrop-blur-md">
          {listenError === "blocked" ? (
            <span className="text-warn">
              Microphone blocked — allow mic access in browser settings.
            </span>
          ) : orbStatus ? (
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  listening || liveMode || onCall
                    ? "bg-run animate-live-dot"
                    : "bg-primary animate-pulse",
                )}
              />
              {orbStatus}
            </span>
          ) : (
            <span className="line-clamp-3">{peek}</span>
          )}
        </div>
      ) : null}

      {/* Bottom-right floating bar: Chat pill + Live Voice Orb */}
      <div className="flex items-center gap-2">
        {liveMode ? (
          <button
            type="button"
            onClick={stopLiveVoice}
            aria-label="End live voice session"
            title="End voice session"
            className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full border border-destructive/40 bg-background/95 text-destructive shadow-lg backdrop-blur-md transition-transform hover:scale-105"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={open ? "Minimize chat dock" : "Open chat dock"}
          className={cn(
            "focus-ring inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-[12px] font-medium shadow-lg backdrop-blur-md transition-all hover:scale-[1.02]",
            onCall
              ? "border-run/40 bg-background/95 text-run"
              : "border-border/80 bg-background/95 text-foreground hover:border-primary/40",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          <span>
            {onCall
              ? `On call ${Math.min(call.index + 1, Math.max(1, call.queue.length))}/${Math.max(1, call.queue.length)}`
              : open
                ? "Hide chat"
                : "Chat"}
          </span>
        </button>

        {/* Live Voice Orb */}
        <button
          type="button"
          onClick={handleOrbClick}
          aria-label={
            speaking
              ? "Interrupt and speak"
              : liveMode
                ? "Stop live voice"
                : "Start live voice assistant"
          }
          title={
            speaking
              ? "Tap to interrupt"
              : liveMode
                ? "Live voice active — tap to stop"
                : "Talk live (hands-free)"
          }
          className={cn(
            "focus-ring relative flex h-12 w-12 items-center justify-center rounded-full border shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-all duration-200 hover:scale-105",
            listening || liveMode
              ? "border-run/60 bg-run text-background"
              : speaking
                ? "border-primary bg-primary text-primary-foreground"
                : thinking
                  ? "border-primary/60 bg-surface-2 text-primary"
                  : "border-primary/40 bg-primary text-primary-foreground",
          )}
        >
          {/* Reactive voice-level halo */}
          {listening || liveMode || speaking ? (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 rounded-full transition-transform duration-100",
                listening ? "bg-run/35" : "bg-primary/30 animate-ping",
              )}
              style={
                listening
                  ? { transform: `scale(${(1.12 + level * 0.45).toFixed(2)})` }
                  : undefined
              }
            />
          ) : null}

          {speaking ? (
            <span className="relative z-10 flex h-4 items-center gap-[2.5px]">
              {[0, 1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className="w-[2.5px] rounded-full bg-current animate-[voice-bar_0.9s_ease-in-out_infinite]"
                  style={{
                    height: `${8 + ((bar * 5) % 9)}px`,
                    animationDelay: `${bar * 100}ms`,
                  }}
                />
              ))}
            </span>
          ) : (
            <Mic className="relative z-10 h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
};
