import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { agentById, pendingApprovals, projectById } from "@/data/derive";
import { useData } from "@/data/store";
import type {
  Approval,
  Decision,
  MissionDesign,
  World,
} from "@/data/types";
import {
  askCopilot,
  askDesign,
  type AnswerSource,
} from "@/lib/copilotClient";
import {
  replanAlreadyPending,
  replanProposalFor,
  stalledMissions,
} from "@/lib/intelligence";
import {
  copilotSuggestions,
  planRequest,
  type CopilotAnswer,
} from "@/lib/orchestrator";

export interface Exchange {
  prompt: string;
  answer: CopilotAnswer;
  stepIndex: number;
  complete: boolean;
  source: AnswerSource;
  provider?: string;
  model?: string;
  /** Present when the exchange ran in design mode. */
  design?: MissionDesign;
}

export type CopilotMode = "ask" | "design";

export interface TranscriptLine {
  id: string;
  role: "copilot" | "you";
  text: string;
  at: string;
}

export type CallState = "idle" | "ringing" | "live" | "ended";

export interface CallDecision {
  approvalId: string;
  title: string;
  decision: Decision;
  agentName: string;
}

export interface CallSession {
  state: CallState;
  startedAt: string | null;
  endedAt: string | null;
  queue: string[];
  index: number;
  decisions: CallDecision[];
  transcript: TranscriptLine[];
}

export interface CheckIn {
  id: string;
  label: string;
  time: string;
  detail: string;
  enabled: boolean;
}

interface OrchestratorValue {
  copilotOpen: boolean;
  openCopilot: (seedPrompt?: string) => void;
  closeCopilot: () => void;
  seedPrompt: string;
  exchange: Exchange | null;
  submitPrompt: (prompt: string) => void | Promise<void>;
  resetExchange: () => void;
  mode: CopilotMode;
  setMode: (mode: CopilotMode) => void;
  modelChoice: string;
  setModelChoice: (choice: string) => void;
  reasoning: string;
  setReasoning: (effort: string) => void;
  modelOptions: { provider: string; displayName: string; models: string[] }[];
  suggestions: string[];
  answerFor: (prompt: string) => CopilotAnswer | null;
  call: CallSession;
  callApprovals: Approval[];
  startCall: () => void;
  callDecision: (decision: Decision) => Promise<void>;
  callSkip: () => void;
  endCall: () => void;
  resetCall: () => void;
  checkIns: CheckIn[];
  toggleCheckIn: (id: string) => void;
}

const emptyCall: CallSession = {
  state: "idle",
  startedAt: null,
  endedAt: null,
  queue: [],
  index: 0,
  decisions: [],
  transcript: [],
};

const OrchestratorContext = createContext<OrchestratorValue | null>(null);

let lineId = 0;
const line = (role: TranscriptLine["role"], text: string): TranscriptLine => ({
  id: `line-${++lineId}`,
  role,
  text,
  at: new Date().toISOString(),
});

export const OrchestratorProvider = ({ children }: { children: ReactNode }) => {
  const { world, status, session, decide, addProposal, logActivity } = useData();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [seedPrompt, setSeedPrompt] = useState("");
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [mode, setMode] = useState<CopilotMode>("ask");
  const [modelChoice, setModelChoice] = useState("auto");
  const [reasoning, setReasoning] = useState("off");
  const [modelOptions, setModelOptions] = useState<
    { provider: string; displayName: string; models: string[] }[]
  >([]);
  const [call, setCall] = useState<CallSession>(emptyCall);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([
    {
      id: "morning",
      label: "Morning brief",
      time: "Daily · 08:00 PT",
      detail: "Today's approvals and stalled threads, read in 90 seconds.",
      enabled: true,
    },
    {
      id: "pipeline",
      label: "Friday pipeline review",
      time: "Fridays · 16:00 PT",
      detail: "Renewal risk and next week's meetings.",
      enabled: true,
    },
    {
      id: "inbox",
      label: "End-of-day inbox check",
      time: "Daily · 17:30 PT",
      detail: "Anything still waiting on you before the day ends.",
      enabled: false,
    },
  ]);

  const worldRef = useRef(world);
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  const openCopilot = useCallback((prompt = "") => {
    setSeedPrompt(prompt);
    setCopilotOpen(true);
  }, []);

  // Model chooser options come from the server's provider pool.
  useEffect(() => {
    if (!copilotOpen) return;
    fetch("/api/models")
      .then((response) => (response.ok ? response.json() : { providers: [] }))
      .then((body: { providers?: { provider: string; displayName: string; models: string[] }[] }) =>
        setModelOptions(body.providers ?? []),
      )
      .catch(() => setModelOptions([]));
  }, [copilotOpen]);

  const closeCopilot = useCallback(() => setCopilotOpen(false), []);

  const designAnswer = (design: MissionDesign, current: World): CopilotAnswer => {
    const project = design.projectId
      ? projectById(current, design.projectId)
      : undefined;
    return {
      intentId: "design-mission",
      intentLabel: `Design · ${design.missionName}`,
      summary: design.rationale,
      agents: design.agentIds,
      steps: design.planSteps.map((step) => ({
        label: step.label,
        agentId: step.agentId,
        detail: step.detail || undefined,
      })),
      links: project
        ? [
            {
              label: project.name,
              href: `/projects/${project.id}`,
              kind: "project" as const,
              meta: project.status.replace("_", " "),
            },
          ]
        : [],
      approvalIds: [],
    };
  };

  const submitPrompt = useCallback(
    async (prompt: string) => {
      if (!world) return;
      if (mode === "design") {
        try {
          const { design, source, provider, model } = await askDesign(prompt, world, session?.principalId, { model: modelChoice, reasoning });
          setExchange({
            prompt,
            answer: designAnswer(design, world),
            stepIndex: 0,
            complete: false,
            source,
            provider,
            model,
            design,
          });
        } catch {
          // Design has no offline stand-in: say so instead of faking a plan.
          toast.error("The copilot server could not design this mission", {
            description:
              "Design mode needs the live model. Check the copilot server is running, or ask the copilot instead.",
          });
        }
        return;
      }
      const live = await askCopilot(prompt, world, session?.principalId, { model: modelChoice, reasoning });
      const { source, provider, model, ...answer } = live;
      setExchange({ prompt, answer, stepIndex: 0, complete: false, source, provider, model });
    },
    [mode, world, session?.principalId, modelChoice, reasoning],
  );

  const resetExchange = useCallback(() => setExchange(null), []);

  const answerFor = useCallback(
    (prompt: string) => (world ? planRequest(prompt, world) : null),
    [world],
  );

  // Walk the plan forward so the copilot shows a live plan, not a spinner.
  useEffect(() => {
    if (!exchange || exchange.complete) return;
    const finishedSteps = exchange.stepIndex >= exchange.answer.steps.length;
    const timer = setTimeout(
      () =>
        setExchange((current) =>
          current
            ? finishedSteps
              ? { ...current, complete: true }
              : { ...current, stepIndex: current.stepIndex + 1 }
            : current,
        ),
      finishedSteps ? 240 : 540,
    );
    return () => clearTimeout(timer);
  }, [exchange]);

  // The iteration loop: when the world loads, every stalled mission that has
  // no pending proposal yet gets exactly one — a proposed way forward held
  // for approval, never a silent stall. Deterministic, so it runs offline.
  const proposedStallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (status !== "ready" || !world) return;
    for (const stall of stalledMissions(world)) {
      if (replanAlreadyPending(world, stall.mission.id)) continue;
      if (proposedStallsRef.current.has(stall.mission.id)) continue;
      proposedStallsRef.current.add(stall.mission.id);
      void addProposal(replanProposalFor(world, stall)).catch(() => {
        proposedStallsRef.current.delete(stall.mission.id);
      });
    }
  }, [addProposal, status, world]);

  // Global command shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCopilotOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const startCall = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    const queue = pendingApprovals(current).map((approval) => approval.id);
    setCall({
      state: "ringing",
      startedAt: new Date().toISOString(),
      endedAt: null,
      queue,
      index: 0,
      decisions: [],
      transcript: [
        line("copilot", "Calling you now. Same orchestrator, voice channel."),
      ],
    });
  }, []);

  // Ringing → live.
  useEffect(() => {
    if (call.state !== "ringing") return;
    const timer = setTimeout(() => {
      const current = worldRef.current;
      const count = current ? pendingApprovals(current).length : 0;
      setCall((session) =>
        session.state === "ringing"
          ? {
              ...session,
              state: "live",
              transcript: [
                ...session.transcript,
                line(
                  "copilot",
                  count
                    ? `You're live. ${count} decisions are waiting — I'll read them one at a time. Say approve, decline, or skip.`
                    : "You're live. Your approval inbox is clear, so there is nothing to decide.",
                ),
              ],
            }
          : session,
      );
    }, 1900);
    return () => clearTimeout(timer);
  }, [call.state]);

  // Read the current approval aloud when the cursor moves.
  useEffect(() => {
    if (call.state !== "live") return;
    const current = worldRef.current;
    const approval = current?.approvals.find(
      (item) => item.id === call.queue[call.index],
    );
    if (!current || !approval) return;
    const agent = agentById(current, approval.agentId);
    setCall((session) => {
      if (session.state !== "live" || session.index !== call.index) return session;
      return {
        ...session,
        transcript: [
          ...session.transcript,
          line(
            "copilot",
            `Number ${session.index + 1} of ${session.queue.length}. ${agent?.name ?? "The team"} wants to ${approval.kind} — ${approval.title}. ${approval.reason}`,
          ),
        ],
      };
    });
    // Deliberately keyed to the call cursor; world updates must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state, call.index]);

  const callApprovals = useMemo(() => {
    if (!world) return [];
    return call.queue
      .map((id) => world.approvals.find((approval) => approval.id === id))
      .filter((approval): approval is Approval => Boolean(approval));
  }, [call.queue, world]);

  const endCall = useCallback(() => {
    setCall((session) => {
      if (session.state === "ended" || session.state === "idle") return session;
      return {
        ...session,
        state: "ended",
        endedAt: new Date().toISOString(),
        transcript: [
          ...session.transcript,
          line(
            "copilot",
            session.decisions.length
              ? `Call ended. ${session.decisions.length} decisions taken by voice — everything is in your inbox and the timeline.`
              : "Call ended. Nothing was decided.",
          ),
        ],
      };
    });
  }, []);

  const advance = useCallback(() => {
    setCall((session) => {
      const nextIndex = session.index + 1;
      if (nextIndex >= session.queue.length) {
        return {
          ...session,
          state: "ended",
          endedAt: new Date().toISOString(),
          transcript: [
            ...session.transcript,
            line(
              "copilot",
              session.decisions.length
                ? `That's everything. ${session.decisions.length} decisions taken by voice — logged to your inbox and the timeline.`
                : "That's everything. Nothing was decided.",
            ),
          ],
        };
      }
      return { ...session, index: nextIndex };
    });
  }, []);

  const decidingRef = useRef(false);

  const callDecision = useCallback(
    async (decision: Decision) => {
      if (decidingRef.current) return;
      const approvalId = call.queue[call.index];
      const current = worldRef.current;
      const approval = current?.approvals.find((item) => item.id === approvalId);
      if (!approval || !current) return;
      decidingRef.current = true;
      const agent = agentById(current, approval.agentId);
      const agentLabel = agent?.name ?? "The agent";

      setCall((session) => ({
        ...session,
        transcript: [
          ...session.transcript,
          line("you", decision === "approved" ? "Approve it." : "No — decline that one."),
        ],
      }));

      try {
        await decide({
          approvalId,
          decision,
          note:
            decision === "approved"
              ? "Approved by voice during a call."
              : "Declined by voice during a call.",
        });
        setCall((session) => ({
          ...session,
          decisions: [
            ...session.decisions,
            {
              approvalId,
              title: approval.title,
              decision,
              agentName: agentLabel,
            },
          ],
          transcript: [
            ...session.transcript,
            line(
              "copilot",
              decision === "approved"
                ? `Approved. ${agentLabel} is on it — I'll log the result.`
                : `Declined. ${agentLabel} will stop this thread and try another angle.`,
            ),
          ],
        }));
        advance();
      } catch {
        setCall((session) => ({
          ...session,
          transcript: [
            ...session.transcript,
            line("copilot", "That one was already decided. Moving on."),
          ],
        }));
        advance();
      } finally {
        decidingRef.current = false;
      }
    },
    [advance, call.index, call.queue, decide],
  );

  const callSkip = useCallback(() => {
    setCall((session) => ({
      ...session,
      transcript: [...session.transcript, line("you", "Skip that one.")],
    }));
    advance();
  }, [advance]);

  const resetCall = useCallback(() => setCall(emptyCall), []);

  // Log the call itself once, when it ends.
  const loggedCallRef = useRef<string | null>(null);
  useEffect(() => {
    if (call.state !== "ended" || !call.startedAt) return;
    if (loggedCallRef.current === call.startedAt) return;
    loggedCallRef.current = call.startedAt;
    const firstApproval = worldRef.current?.approvals.find(
      (approval) => approval.id === call.decisions[0]?.approvalId,
    );
    if (!call.decisions.length || !firstApproval) return;
    const approved = call.decisions.filter(
      (decision) => decision.decision === "approved",
    ).length;
    void logActivity({
      agentId: firstApproval.agentId,
      type: "call",
      title: "Voice call with your copilot",
      detail: `${call.decisions.length} decisions taken by voice — ${approved} approved, ${
        call.decisions.length - approved
      } declined.`,
      outcome: "ok",
    });
  }, [call.state, call.startedAt, call.decisions, logActivity]);

  const toggleCheckIn = useCallback((id: string) => {
    setCheckIns((current) =>
      current.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  }, []);

  const value = useMemo<OrchestratorValue>(
    () => ({
      copilotOpen,
      openCopilot,
      closeCopilot,
      seedPrompt,
      exchange,
      submitPrompt,
      resetExchange,
      mode,
      setMode,
      modelChoice,
      setModelChoice,
      reasoning,
      setReasoning,
      modelOptions,
      suggestions: copilotSuggestions,
      answerFor,
      call,
      callApprovals,
      startCall,
      callDecision,
      callSkip,
      endCall,
      resetCall,
      checkIns,
      toggleCheckIn,
    }),
    [
      copilotOpen,
      openCopilot,
      closeCopilot,
      seedPrompt,
      exchange,
      submitPrompt,
      resetExchange,
      mode,
      setMode,
      modelChoice,
      setModelChoice,
      reasoning,
      setReasoning,
      modelOptions,
      answerFor,
      call,
      callApprovals,
      startCall,
      callDecision,
      callSkip,
      endCall,
      resetCall,
      checkIns,
      toggleCheckIn,
    ],
  );

  return (
    <OrchestratorContext.Provider value={value}>
      {children}
    </OrchestratorContext.Provider>
  );
};

export const useOrchestrator = () => {
  const context = useContext(OrchestratorContext);
  if (!context) {
    throw new Error("useOrchestrator must be used inside <OrchestratorProvider>");
  }
  return context;
};
