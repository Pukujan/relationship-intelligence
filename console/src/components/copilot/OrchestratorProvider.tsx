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
import { useNavigate } from "react-router-dom";
import { agentById, pendingApprovals } from "@/data/derive";
import { useData } from "@/data/store";
import type { Approval, Decision } from "@/data/types";
import { replanAlreadyPending, replanProposalFor, stalledMilestones } from "@/lib/intelligence";
import { planRequest, type CopilotAnswer } from "@/lib/orchestrator";

/**
 * RI-0010: the copilot is a workspace of persistent threads, not a modal.
 * This provider keeps the cross-cutting pieces — the stall→proposal loop, the
 * voice/call channel, and quick-ask navigation into the session workspace.
 * Thread state lives in SessionWorkspace over the source seam.
 */

export interface TranscriptLine {
  id: string;
  role: "copilot" | "you";
  text: string;
  at: string;
}

/** How many approvals one call reads. */
const CALL_QUEUE_LIMIT = 3;
const RISK_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

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
  openCopilot: (seedPrompt?: string) => void;
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
  const { world, status, decide, addProposal, logActivity } = useData();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallSession>(emptyCall);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([
    { id: "morning", label: "Morning brief", time: "Daily · 08:00 PT", detail: "Today's approvals and stalled threads, read in 90 seconds.", enabled: true },
    { id: "pipeline", label: "Friday pipeline review", time: "Fridays · 16:00 PT", detail: "Renewal risk and next week's meetings.", enabled: true },
    { id: "inbox", label: "End-of-day inbox check", time: "Daily · 17:30 PT", detail: "Anything still waiting on you before the day ends.", enabled: false },
  ]);

  const worldRef = useRef(world);
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  // Quick-ask opens or focuses the session workspace with a seeded composer.
  const openCopilot = useCallback(
    (prompt = "") => {
      navigate("/copilot", { state: { seed: prompt } });
    },
    [navigate],
  );

  const answerFor = useCallback(
    (prompt: string) => (world ? planRequest(prompt, world) : null),
    [world],
  );

  // The iteration loop: every stalled milestone without a pending proposal gets
  // exactly one proposed way forward, held for approval. Deterministic, offline-safe.
  const proposedStallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (status !== "ready" || !world) return;
    for (const stall of stalledMilestones(world)) {
      if (replanAlreadyPending(world, stall.milestone.id)) continue;
      if (proposedStallsRef.current.has(stall.milestone.id)) continue;
      proposedStallsRef.current.add(stall.milestone.id);
      void addProposal(replanProposalFor(world, stall)).catch(() => {
        proposedStallsRef.current.delete(stall.milestone.id);
      });
    }
  }, [addProposal, status, world]);

  const startCall = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    // A call is a short briefing: the few decisions that matter most, not
    // the whole inbox read aloud.
    const queue = [...pendingApprovals(current)]
      .sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])
      .slice(0, CALL_QUEUE_LIMIT)
      .map((approval) => approval.id);
    setCall({
      state: "ringing",
      startedAt: new Date().toISOString(),
      endedAt: null,
      queue,
      index: 0,
      decisions: [],
      transcript: [line("copilot", "Calling you now. Same orchestrator, voice channel.")],
    });
  }, []);

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
                line("copilot", count
                  ? `You're live. ${
                      count > CALL_QUEUE_LIMIT
                        ? `${count} decisions are waiting, and I'll read the ${CALL_QUEUE_LIMIT} that matter most`
                        : `${count} ${count === 1 ? "decision is" : "decisions are"} waiting`
                    }. Say approve, decline or skip, or ask me about one.`
                  : "You're live. Your approval inbox is clear, so there is nothing to decide."),
              ],
            }
          : session,
      );
    }, 1900);
    return () => clearTimeout(timer);
  }, [call.state]);

  useEffect(() => {
    if (call.state !== "live") return;
    const current = worldRef.current;
    const approval = current?.approvals.find((item) => item.id === call.queue[call.index]);
    if (!current || !approval) return;
    const agent = agentById(current, approval.agentId);
    setCall((session) => {
      if (session.state !== "live" || session.index !== call.index) return session;
      return {
        ...session,
        transcript: [
          ...session.transcript,
          line("copilot", `Number ${session.index + 1} of ${session.queue.length}. ${agent?.name ?? "The team"} wants to ${approval.kind} — ${approval.title}. ${approval.reason}`),
        ],
      };
    });
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
          line("copilot", session.decisions.length
            ? `Call ended. ${session.decisions.length} ${session.decisions.length === 1 ? "decision" : "decisions"} taken by voice — everything is in your inbox and the timeline.`
            : "Call ended. Nothing was decided."),
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
            line("copilot", session.decisions.length
              ? `That's everything. ${session.decisions.length} ${session.decisions.length === 1 ? "decision" : "decisions"} taken by voice — logged to your inbox and the timeline.`
              : "That's everything. Nothing was decided."),
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
        transcript: [...session.transcript, line("you", decision === "approved" ? "Approve it." : "No — decline that one.")],
      }));
      try {
        await decide({
          approvalId,
          decision,
          note: decision === "approved" ? "Approved by voice during a call." : "Declined by voice during a call.",
        });
        setCall((session) => ({
          ...session,
          decisions: [...session.decisions, { approvalId, title: approval.title, decision, agentName: agentLabel }],
          transcript: [
            ...session.transcript,
            line("copilot", decision === "approved"
              ? `Approved. ${agentLabel} is on it — I'll log the result.`
              : `Declined. ${agentLabel} will stop this thread and try another angle.`),
          ],
        }));
        advance();
      } catch {
        setCall((session) => ({
          ...session,
          transcript: [...session.transcript, line("copilot", "That one was already decided. Moving on.")],
        }));
        advance();
      } finally {
        decidingRef.current = false;
      }
    },
    [advance, call.index, call.queue, decide],
  );

  const callSkip = useCallback(() => {
    setCall((session) => ({ ...session, transcript: [...session.transcript, line("you", "Skip that one.")] }));
    advance();
  }, [advance]);

  const resetCall = useCallback(() => setCall(emptyCall), []);

  const loggedCallRef = useRef<string | null>(null);
  useEffect(() => {
    if (call.state !== "ended" || !call.startedAt) return;
    if (loggedCallRef.current === call.startedAt) return;
    loggedCallRef.current = call.startedAt;
    const firstApproval = worldRef.current?.approvals.find((approval) => approval.id === call.decisions[0]?.approvalId);
    if (!call.decisions.length || !firstApproval) return;
    const approved = call.decisions.filter((decision) => decision.decision === "approved").length;
    void logActivity({
      agentId: firstApproval.agentId,
      type: "call",
      title: "Voice call with your copilot",
      detail: `${call.decisions.length} decisions taken by voice — ${approved} approved, ${call.decisions.length - approved} declined.`,
      outcome: "ok",
    });
  }, [call.state, call.startedAt, call.decisions, logActivity]);

  const toggleCheckIn = useCallback((id: string) => {
    setCheckIns((current) => current.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)));
  }, []);

  const value = useMemo<OrchestratorValue>(
    () => ({
      openCopilot,
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
    [openCopilot, answerFor, call, callApprovals, startCall, callDecision, callSkip, endCall, resetCall, checkIns, toggleCheckIn],
  );

  return <OrchestratorContext.Provider value={value}>{children}</OrchestratorContext.Provider>;
};

export const useOrchestrator = () => {
  const context = useContext(OrchestratorContext);
  if (!context) {
    throw new Error("useOrchestrator must be used inside <OrchestratorProvider>");
  }
  return context;
};
