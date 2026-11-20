import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentById, relativeTime } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { useSpeech } from "@/hooks/useSpeech";
import { parseVoiceCommand } from "@/lib/voiceCommands";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  KindBadge,
  PageHeader,
  PersonAvatar,
  RiskBadge,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { CopilotAnswer } from "@/lib/orchestrator";

interface DemoLine {
  id: string;
  role: "copilot" | "you";
  text: string;
  at: string;
}

/** How many times the call re-opens the mic for one approval before it waits for a tap. */
const MAX_COMMAND_RETRIES = 2;

let demoId = 0;
const makeLine = (role: DemoLine["role"], text: string): DemoLine => ({
  id: `demo-${++demoId}`,
  role,
  text,
  at: new Date().toISOString(),
});

const Voice = () => {
  const { world } = useData();
  const {
    call,
    callApprovals,
    startCall,
    callDecision,
    callSkip,
    endCall,
    resetCall,
    checkIns,
    toggleCheckIn,
    answerFor,
    openCopilot,
  } = useOrchestrator();

  const speech = useSpeech();
  const {
    listening,
    canListen,
    listenError,
    interim,
    listen,
    stopListening,
    speak,
    stopSpeaking,
  } = speech;
  const [misheard, setMisheard] = useState<string | null>(null);
  const [intent, setIntent] = useState<CopilotAnswer | null>(null);
  const [demoLines, setDemoLines] = useState<DemoLine[]>([
    makeLine(
      "copilot",
      "I'm here. Ask about a relationship, a decision, or say “call me” and I'll phone you.",
    ),
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onCall = call.state !== "idle";
  const lines = onCall ? call.transcript : demoLines;
  const currentApproval = callApprovals[call.index];
  const currentAgent = world
    ? agentById(world, currentApproval?.agentId)
    : undefined;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines.length, call.state]);

  // Talk, off a call: one spoken question in, one spoken answer out.
  const askByVoice = () => {
    if (listening) {
      stopListening();
      return;
    }
    setMisheard(null);
    listen({
      onHeard: (prompt) => {
        const answer = answerFor(prompt);
        const reply =
          answer?.summary ?? "I couldn't reach the orchestrator just now.";
        setDemoLines((current) => [
          ...current,
          makeLine("you", prompt),
          makeLine("copilot", reply),
        ]);
        setIntent(answer);
        speak(reply);
      },
    });
  };

  // On a call the handlers below run from speech callbacks, long after the
  // render that created them, so they read the latest call through a ref.
  const live = useRef({ call, callDecision, callSkip, endCall });
  live.current = { call, callDecision, callSkip, endCall };
  const retries = useRef(0);

  const listenForCommand = useCallback(() => {
    const now = live.current.call;
    if (now.state !== "live" || !now.queue[now.index] || !canListen) return;
    listen({
      onHeard: (heard) => {
        const command = parseVoiceCommand(heard);
        const actions = live.current;
        setMisheard(null);
        if (command === "approve") void actions.callDecision("approved");
        else if (command === "decline") void actions.callDecision("declined");
        else if (command === "skip") actions.callSkip();
        else if (command === "end") actions.endCall();
        else {
          // Not clearly one command: say what was heard and decide nothing.
          setMisheard(heard);
          if (retries.current < MAX_COMMAND_RETRIES) {
            retries.current += 1;
            speak("Say approve, decline, or skip.", listenForCommand);
          }
        }
      },
      onError: (error) => {
        if (error === "no-speech" && retries.current < MAX_COMMAND_RETRIES) {
          retries.current += 1;
          listenForCommand();
        }
      },
    });
  }, [canListen, listen, speak]);

  // Read each new copilot line aloud; when the queue goes quiet, open the mic.
  const spoken = useRef(0);
  useEffect(() => {
    if (!onCall) {
      spoken.current = 0;
      return;
    }
    const fresh = call.transcript.slice(spoken.current);
    spoken.current = call.transcript.length;
    for (const entry of fresh) {
      if (entry.role === "copilot") speak(entry.text, listenForCommand);
    }
  }, [call.transcript, onCall, speak, listenForCommand]);

  useEffect(() => {
    retries.current = 0;
    setMisheard(null);
  }, [call.index, call.state]);

  // A tap always beats the voice: stop reading and listening before acting.
  const quiet = () => {
    stopSpeaking();
    stopListening();
  };
  const decideByTap = (decision: "approved" | "declined") => {
    quiet();
    void callDecision(decision);
  };
  const skipByTap = () => {
    quiet();
    callSkip();
  };
  const hangUp = () => {
    quiet();
    endCall();
  };
  const answerByVoice = () => {
    if (listening) {
      stopListening();
      return;
    }
    stopSpeaking();
    retries.current = 0;
    listenForCommand();
  };

  const micNotice = !canListen
    ? "This browser has no speech recognition, so the mic is off. Chrome, Edge and Safari have it. The buttons work everywhere."
    : listenError === "blocked"
      ? "Microphone access is blocked for this site. Allow it in the browser's site settings, then tap Talk."
      : misheard
        ? `Heard “${misheard}”. Nothing was decided. Say approve, decline or skip, or use the buttons.`
        : "Your browser's speech service turns your voice into text. Every voice decision shows in the transcript.";

  const stateLabel = useMemo(() => {
    if (call.state === "ringing") return "Ringing";
    if (call.state === "live") return listening ? "Listening" : "Speaking";
    if (call.state === "ended") return "Call ended";
    return listening ? "Listening" : "Ready";
  }, [call.state, listening]);

  const active = call.state === "live" || call.state === "ringing" || listening;
  const intentLabel =
    intent?.intentLabel ??
    (onCall && call.state !== "ended" ? "Reading your approval queue" : null);
  const decided = (approvalId: string) =>
    call.decisions.find((decision) => decision.approvalId === approvalId);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="One orchestrator · three surfaces"
        title="Voice & call"
        description="Typing, speaking, and phone calls all route through the same copilot. A call is just the approval inbox, read aloud — with your decisions landing back in the timeline."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => openCopilot()}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Type instead
            </Button>
            {call.state === "live" || call.state === "ringing" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 rounded-lg text-[12px]"
                onClick={hangUp}
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End call
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-9 gap-1.5 rounded-lg text-[12px]"
                onClick={startCall}
              >
                <Phone className="h-3.5 w-3.5" />
                Call me now
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="panel flex flex-col p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                  call.state === "live"
                    ? "border-run/30 bg-run/10 text-run"
                    : call.state === "ringing"
                      ? "border-warn/30 bg-warn/10 text-warn"
                      : call.state === "ended"
                        ? "border-border bg-surface-2 text-muted-foreground"
                        : listening
                          ? "border-run/30 bg-run/10 text-run"
                          : "border-border bg-surface-2 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    call.state === "live" || listening
                      ? "bg-run animate-live-dot"
                      : call.state === "ringing"
                        ? "bg-warn animate-live-dot"
                        : "bg-idle",
                  )}
                />
                {stateLabel}
              </span>
              {intentLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                  <Sparkles className="h-3 w-3" />
                  {intentLabel}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {(["ringing", "live", "ended"] as const).map((stage) => (
                <span
                  key={stage}
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 capitalize",
                    call.state === stage
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground/60",
                  )}
                >
                  {stage}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-col items-center gap-3">
            <div
              className={cn(
                "relative flex h-36 w-36 items-center justify-center rounded-full border",
                call.state === "live" || listening
                  ? "border-run/35 bg-run/[0.06]"
                  : call.state === "ringing"
                    ? "border-warn/35 bg-warn/[0.05]"
                    : "border-border/70 bg-surface-1",
              )}
            >
              {active ? (
                <span className="absolute inset-0 rounded-full animate-soft-ring" />
              ) : null}
              <span className="absolute inset-5 rounded-full border border-border/50" />
              <span className="absolute inset-9 rounded-full border border-border/30" />
              {call.state === "live" && !listening ? (
                <div className="flex h-8 items-center gap-1">
                  {[0, 1, 2, 3, 4, 5].map((bar) => (
                    <span
                      key={bar}
                      className="w-[3px] rounded-full bg-run animate-[voice-bar_1.05s_ease-in-out_infinite]"
                      style={{
                        height: `${10 + ((bar * 7) % 18)}px`,
                        animationDelay: `${bar * 110}ms`,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  {listening || call.state === "idle" ? (
                    <Mic
                      className={cn(
                        "h-7 w-7",
                        listening ? "text-run" : "text-muted-foreground",
                      )}
                    />
                  ) : (
                    <MicOff className="h-7 w-7 text-muted-foreground" />
                  )}
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {call.state === "ringing"
                      ? "dialing"
                      : listening
                        ? "listening"
                        : call.state === "live"
                          ? "on call"
                          : "ready"}
                  </span>
                </div>
              )}
            </div>
            <p className="text-center text-[12px] text-muted-foreground">
              {call.state === "ringing"
                ? "Connecting. The copilot reads the queue aloud in this tab."
                : call.state === "live"
                  ? `Reading decision ${Math.min(call.index + 1, call.queue.length)} of ${call.queue.length}.`
                  : call.state === "ended"
                    ? "The call is over. Decisions are already in your inbox."
                    : listening
                      ? "Go ahead — I'm routing this through the orchestrator."
                      : "Tap the mic to speak, or call yourself and decide by voice."}
            </p>
            <p className="text-center text-[10px] text-muted-foreground/70">
              {micNotice}
            </p>
          </div>

          {call.state === "live" && currentApproval ? (
            <div className="mt-4 rounded-xl border border-border/70 bg-background/50 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {currentAgent ? (
                    <AgentAvatar agent={currentAgent} size="sm" showStatus />
                  ) : null}
                  <div>
                    <p className="text-[11.5px] font-medium">
                      {currentAgent?.name} wants to {currentApproval.kind}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={currentApproval.kind} />
                      <RiskBadge risk={currentApproval.risk} />
                      {currentApproval.personId && world ? (
                        <Link
                          to={`/people/${currentApproval.personId}`}
                          className="focus-ring inline-flex items-center gap-1 rounded-full text-[10.5px] text-muted-foreground hover:text-foreground"
                        >
                          {(() => {
                            const person = world.people.find(
                              (item) => item.id === currentApproval.personId,
                            );
                            return person ? (
                              <>
                                <PersonAvatar name={person.name} size="xs" />
                                {person.name}
                              </>
                            ) : null;
                          })()}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
                <span className="num text-[10px] text-muted-foreground">
                  {call.index + 1}/{call.queue.length}
                </span>
              </div>
              <p className="mt-2 text-[13px] font-medium leading-snug">
                {currentApproval.title}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                {currentApproval.reason}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  className="h-8 flex-1 rounded-lg text-[11.5px]"
                  onClick={() => decideByTap("approved")}
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 rounded-lg text-[11.5px]"
                  onClick={() => decideByTap("declined")}
                >
                  <X className="h-3.5 w-3.5" />
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 rounded-lg px-2 text-[11.5px] text-muted-foreground"
                  onClick={skipByTap}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Skip
                </Button>
              </div>
            </div>
          ) : null}

          <div
            ref={scrollRef}
            className="mt-4 max-h-[280px] min-h-[150px] flex-1 space-y-2.5 overflow-y-auto rounded-xl border border-border/60 bg-background/40 p-3"
            aria-live="polite"
            aria-label="Live transcript"
          >
            {lines.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex gap-2",
                  entry.role === "you" ? "justify-end" : "justify-start",
                )}
              >
                {entry.role === "copilot" ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                  </span>
                ) : null}
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11.5px] leading-relaxed",
                    entry.role === "you"
                      ? "bg-surface-3 text-foreground"
                      : "border border-border/60 bg-surface-1 text-foreground/85",
                  )}
                >
                  {entry.text}
                </div>
                {entry.role === "you" ? (
                  <PersonAvatar name="Alex Rivera" size="xs" className="mt-0.5" />
                ) : null}
              </div>
            ))}
            {listening ? (
              <div className="flex items-center gap-2 text-[10.5px] text-run">
                <span className="flex items-center gap-0.5">
                  {[0, 1, 2].map((bar) => (
                    <span
                      key={bar}
                      className="w-[2px] rounded-full bg-run animate-[voice-bar_0.9s_ease-in-out_infinite]"
                      style={{ height: "9px", animationDelay: `${bar * 130}ms` }}
                    />
                  ))}
                </span>
                {interim || "listening…"}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant={listening ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 rounded-lg text-[11.5px]"
              onClick={call.state === "live" ? answerByVoice : askByVoice}
              disabled={
                !canListen ||
                call.state === "ringing" ||
                call.state === "ended"
              }
            >
              {listening ? (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  Listening…
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  Talk
                </>
              )}
            </Button>
            {call.state === "live" || call.state === "ringing" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-lg text-[11.5px]"
                onClick={hangUp}
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End call
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-lg text-[11.5px]"
                onClick={startCall}
              >
                <Phone className="h-3.5 w-3.5" />
                {call.state === "ended" ? "Call again" : "Call me"}
              </Button>
            )}
            {call.state === "ended" ? (
              <button
                type="button"
                onClick={() => {
                  quiet();
                  resetCall();
                  setIntent(null);
                }}
                className="focus-ring rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                New conversation
              </button>
            ) : null}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {call.state === "live"
                ? "Approve, decline, or skip — decisions are logged as you speak."
                : "Same approvals, same orchestrator, different channel."}
            </span>
          </div>
        </section>

        <aside className="space-y-3">
          <div className="panel p-3.5">
            <SectionHeader
              title="On this call"
              count={call.state === "idle" ? undefined : call.queue.length}
              action={
                <Link
                  to="/approvals"
                  className="focus-ring rounded text-[10.5px] text-muted-foreground hover:text-foreground"
                >
                  Inbox
                </Link>
              }
            />
            {call.state === "idle" ? (
              <div className="mt-3 space-y-2">
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  No call in progress. When you call, the copilot reads the
                  pending approvals one by one and takes your decisions.
                </p>
                <Button
                  size="sm"
                  className="h-8 w-full rounded-lg text-[11.5px]"
                  onClick={startCall}
                >
                  <Phone className="h-3.5 w-3.5" />
                  Call me now
                </Button>
              </div>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {callApprovals.map((approval, index) => {
                  const decision = decided(approval.id);
                  const isCurrent = call.state === "live" && index === call.index;
                  return (
                    <div
                      key={approval.id}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                        isCurrent
                          ? "border-primary/35 bg-primary/[0.06]"
                          : "border-border/60 bg-background/30",
                      )}
                    >
                      <span className="num mt-0.5 w-3 text-[9.5px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <p
                        className={cn(
                          "min-w-0 flex-1 truncate text-[11px]",
                          decision && "text-muted-foreground line-through decoration-border",
                        )}
                      >
                        {approval.title}
                      </p>
                      {decision ? (
                        <span
                          className={cn(
                            "shrink-0 text-[9.5px] font-medium",
                            decision.decision === "approved"
                              ? "text-run"
                              : "text-muted-foreground",
                          )}
                        >
                          {decision.decision === "approved" ? "approved" : "declined"}
                        </span>
                      ) : isCurrent ? (
                        <span className="shrink-0 text-[9.5px] font-medium text-primary">
                          now
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel p-3.5">
            <SectionHeader title="Scheduled check-ins" />
            <div className="mt-2.5 space-y-2.5">
              {checkIns.map((checkIn) => (
                <div key={checkIn.id} className="flex items-start gap-2.5">
                  <Switch
                    checked={checkIn.enabled}
                    onCheckedChange={() => toggleCheckIn(checkIn.id)}
                    aria-label={`Toggle ${checkIn.label}`}
                    className="mt-0.5 scale-90"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium">{checkIn.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {checkIn.time}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/80">
                      {checkIn.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
              {checkIns.filter((item) => item.enabled).length} active · the
              copilot calls you, not the other way around.
            </p>
          </div>

          {call.state === "ended" ? (
            <div className="panel p-3.5">
              <SectionHeader
                title="Call recap"
                count={call.decisions.length}
                action={
                  call.endedAt ? (
                    <span className="text-[10px] text-muted-foreground">
                      {relativeTime(call.endedAt)}
                    </span>
                  ) : null
                }
              />
              {call.decisions.length ? (
                <div className="mt-2.5 space-y-1.5">
                  {call.decisions.map((decision) => (
                    <div
                      key={decision.approvalId}
                      className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/30 px-2 py-1.5"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          decision.decision === "approved"
                            ? "border-run/30 bg-run/10 text-run"
                            : "border-border bg-surface-2 text-muted-foreground",
                        )}
                      >
                        {decision.decision === "approved" ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <X className="h-2.5 w-2.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] leading-snug">
                          {decision.title}
                        </p>
                        <p className="text-[9.5px] text-muted-foreground">
                          {decision.agentName} ·{" "}
                          {decision.decision === "approved"
                            ? "approved by voice"
                            : "declined by voice"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Nothing was decided on this call. The queue is unchanged.
                </p>
              )}
              <div className="mt-2.5 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 rounded-md text-[10.5px]"
                  asChild
                >
                  <Link to="/approvals">Open inbox</Link>
                </Button>
                <Button
                  size="sm"
                  className="h-7 flex-1 rounded-md text-[10.5px]"
                  onClick={startCall}
                >
                  Call again
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-surface-1/50 p-3.5">
              <p className="text-[11.5px] font-medium">Why a call?</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Driving, walking, away from the desk. The copilot reads each
                decision with its evidence, takes your answer, and writes it
                back to the same inbox the screen shows.
              </p>
              <button
                type="button"
                onClick={() => openCopilot("What's waiting on my approval?")}
                className="focus-ring mt-2 inline-flex items-center gap-1 rounded text-[11px] text-primary"
              >
                Preview the queue in the copilot
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Voice;
