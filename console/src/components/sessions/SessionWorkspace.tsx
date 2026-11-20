import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMachine } from "@xstate/react";
import { Archive, ArchiveRestore, Loader2, PanelRight, Plus, Search, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { buildWorldDigest, type WorldDigest } from "@/lib/digest";
import { streamTurn } from "@/lib/sessionClient";
import { isTurnLive, turnMachine } from "@/machines/turnMachine";
import type { Conversation, SessionMessage } from "@/data/sessionTypes";
import { PartRenderer } from "./PartRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const IDLE_ARCHIVE_DAYS = 14;
const TAB_WARN = 8;
const THREAD_PAGE_SIZE = 8;

const scopeLabel = (conversation: Conversation, world: ReturnType<typeof useData>["world"]) => {
  if (!world || !conversation.scopeId) return "workspace";
  if (conversation.scopeKind === "person") return world.people.find((p) => p.id === conversation.scopeId)?.name ?? "person";
  if (conversation.scopeKind === "project") return world.projects.find((p) => p.id === conversation.scopeId)?.name ?? "project";
  if (conversation.scopeKind === "mission") return world.missions.find((m) => m.id === conversation.scopeId)?.name ?? "mission";
  return "workspace";
};

/** Scope pinning: the digest a tab sends contains only its pinned scope. */
const scopedDigest = (digest: WorldDigest, conversation: Conversation | null): WorldDigest => {
  if (!conversation || conversation.scopeKind === "workspace" || !conversation.scopeId) return digest;
  const id = conversation.scopeId;
  if (conversation.scopeKind === "person") {
    const person = digest.people.find((p) => p.id === id);
    return {
      ...digest,
      people: person ? [person] : [],
      companies: digest.companies.filter((c) => c.id === person?.companyId),
      missions: digest.missions.filter((m) => m.personIds.includes(id)),
      approvals: digest.approvals.filter((a) => a.personId === id),
      goingColdIds: digest.goingColdIds.filter((x) => x === id),
    };
  }
  if (conversation.scopeKind === "project") {
    const project = digest.projects.find((p) => p.id === id);
    const people = digest.people.filter((p) => project?.personIds.includes(p.id));
    return {
      ...digest,
      projects: project ? [project] : [],
      people,
      companies: digest.companies.filter((c) => project?.companyIds.includes(c.id)),
      objectives: digest.objectives.filter((o) => o.projectId === id),
      missions: digest.missions.filter((m) => m.projectId === id),
    };
  }
  const mission = digest.missions.find((m) => m.id === id);
  return {
    ...digest,
    missions: mission ? [mission] : [],
    people: digest.people.filter((p) => mission?.personIds.includes(p.id)),
    objectives: digest.objectives.filter((o) => o.id === mission?.objectiveId),
    projects: digest.projects.filter((p) => p.id === mission?.projectId),
  };
};

const SessionWorkspace = () => {
  const { world, session, sessions, createSession, patchSession, appendMessage, loadMessages, refreshSessions } = useData();
  const location = useLocation();
  const seed = (location.state as { seed?: string } | null)?.seed ?? "";
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  // One XState actor replaces the streaming/phases/liveParts/liveMeta useState
  // cluster. The machine coordinates turn state; the SSE fetch is still driven
  // here in the component (see submit), which feeds the machine its events.
  const [turn, sendTurn, turnRef] = useMachine(turnMachine);
  const streaming = isTurnLive(turn.value);
  const phases = turn.context.phases;
  const liveParts = turn.context.parts;
  const liveMeta = { provider: turn.context.provider ?? undefined, model: turn.context.model ?? undefined };
  const [text, setText] = useState(seed);
  const [model, setModel] = useState("auto");
  const [reasoning, setReasoning] = useState("off");
  const [modelOptions, setModelOptions] = useState<{ provider: string; models: string[] }[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [railQuery, setRailQuery] = useState("");
  const [threadLimit, setThreadLimit] = useState(THREAD_PAGE_SIZE);
  const [contextOpen, setContextOpen] = useState(true);
  const [newScope, setNewScope] = useState<{ kind: string; id: string | null }>({ kind: "workspace", id: null });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const openSessions = sessions.filter((s) => !s.archivedAt);
  const archived = sessions.filter((s) => s.archivedAt);
  const query = railQuery.trim().toLowerCase();
  const matchesQuery = (conversation: Conversation) =>
    !query || conversation.title.toLowerCase().includes(query) || scopeLabel(conversation, world).toLowerCase().includes(query);
  const filteredOpen = openSessions.filter(matchesQuery);
  const filteredArchived = archived.filter(matchesQuery);
  // Searching is exhaustive (every match shows); otherwise the rail pages
  // through open threads THREAD_PAGE_SIZE at a time.
  const visibleOpen = query ? filteredOpen : filteredOpen.slice(0, threadLimit);
  const hiddenCount = filteredOpen.length - visibleOpen.length;

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((b: { providers?: { provider: string; models: string[] }[] }) => setModelOptions(b.providers ?? []))
      .catch(() => setModelOptions([]));
  }, []);

  // Session hygiene: archive threads idle beyond the window, once per load.
  const archivedOnce = useRef(false);
  useEffect(() => {
    if (archivedOnce.current || !sessions.length) return;
    archivedOnce.current = true;
    const cutoff = Date.now() - IDLE_ARCHIVE_DAYS * 86_400_000;
    for (const conversation of sessions) {
      if (!conversation.archivedAt && new Date(conversation.updatedAt).getTime() < cutoff) {
        void patchSession(conversation.id, { archived: true });
      }
    }
  }, [sessions, patchSession]);

  useEffect(() => {
    if (!activeId && !draft && openSessions.length) setActiveId(openSessions[0].id);
  }, [activeId, draft, openSessions]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    loadMessages(activeId)
      .then((next) => { if (!cancelled) setMessages(next); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveParts, phases]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const digest = useMemo(() => (world ? scopedDigest(buildWorldDigest(world), active) : null), [world, active]);

  const submit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || streaming || !digest || !session) return;
    let conversation = active;
    if (!conversation) {
      conversation = await createSession({
        title: prompt.slice(0, 60),
        scopeKind: newScope.kind,
        scopeId: newScope.id,
      });
      setActiveId(conversation.id);
      setDraft(false);
      await refreshSessions();
    }
    const now = new Date().toISOString();
    const userMessage: SessionMessage = {
      id: `msg-${Date.now()}-u`,
      role: "user",
      parts: [{ kind: "text", text: prompt }],
      createdAt: now,
    };
    setMessages((current) => [...current, userMessage]);
    void appendMessage(conversation.id, userMessage);
    setText("");
    // Scope pinning is synchronous and happens before SUBMIT: the scoped digest
    // we send contains only this tab's pinned scope, so the machine's scopePinned
    // guard is satisfied and no other tab's claims can reach the model.
    const turnDigest = scopedDigest(
      buildWorldDigest(world!, {
        includePeopleIds: conversation.scopeKind === "person" && conversation.scopeId ? [conversation.scopeId] : [],
      }),
      conversation,
    );
    sendTurn({
      type: "SUBMIT",
      prompt,
      scopeKind: conversation.scopeKind,
      scopeId: conversation.scopeId,
      scopePinned: true,
      route: model,
      reasoning,
    });
    // The machine owns the AbortController; read it back synchronously so the
    // fetch and the stop button share one cancellation signal.
    const controller = turnRef.getSnapshot().context.abortController!;
    abortRef.current = controller;
    let meta: { provider?: string; model?: string; reasoning?: string } = {};
    await streamTurn(
      {
        prompt,
        digest: turnDigest,
        model,
        reasoning,
        sessionId: conversation.id,
        history: messages
          .slice(-6)
          .map((m) => m.parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text).join(" ").slice(0, 1200))
          .filter((h) => h.trim().length > 0),
      },
      {
        onPhase: (label) => sendTurn({ type: "PHASE", label }),
        onPart: (part) => sendTurn({ type: "PART", part }),
        onDone: (info) => { meta = info; sendTurn({ type: "DONE", ...info }); },
        onError: (message) => {
          const systemMessage: SessionMessage = {
            id: `msg-${Date.now()}-s`,
            role: "system",
            parts: [{ kind: "text", text: `Turn failed: ${message}` }],
            createdAt: new Date().toISOString(),
          };
          setMessages((current) => [...current, systemMessage]);
          void appendMessage(conversation!.id, systemMessage);
          sendTurn({ type: "ERROR", message });
        },
      },
      controller.signal,
    ).catch(() => { /* aborted by tab switch/unmount */ });
    if (controller.signal.aborted) {
      sendTurn({ type: "ABORT" });
      return;
    }
    const parts = turnRef.getSnapshot().context.parts;
    if (parts.length) {
      const assistantMessage: SessionMessage = {
        id: `msg-${Date.now()}-a`,
        role: "assistant",
        parts,
        provider: meta.provider,
        model: meta.model,
        reasoning: meta.reasoning,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage]);
      sendTurn({ type: "PHASE", label: "Persisting the thread" });
      await appendMessage(conversation.id, assistantMessage).catch(() => {
        toast.error("Thread not persisted", { description: "The answer rendered but storage refused it." });
      });
      await refreshSessions();
    }
    // A storage refusal is a warning (toasted above), not a turn error: the
    // rendered answer stays and the turn settles either way.
    sendTurn({ type: "PHASE", label: "Thread persisted" });
  }, [text, streaming, digest, session, active, createSession, newScope, refreshSessions, appendMessage, model, reasoning, sendTurn, turnRef, world]);

  const contextEntity = useMemo(() => {
    if (!world || !active?.scopeId) return null;
    if (active.scopeKind === "person") return world.people.find((p) => p.id === active.scopeId) ?? null;
    if (active.scopeKind === "project") return world.projects.find((p) => p.id === active.scopeId) ?? null;
    return null;
  }, [world, active]);

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* rail */}
      <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-border/70 bg-surface-1/60 p-2">
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="eyebrow">Research threads</p>
          <Button
            size="sm" variant="ghost" className="h-7 w-7 rounded-md p-0" aria-label="New thread"
            onClick={() => { setDraft(true); setActiveId(null); setMessages([]); setText(seed); }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={railQuery}
            onChange={(event) => { setRailQuery(event.target.value); setThreadLimit(THREAD_PAGE_SIZE); }}
            placeholder="Search threads…"
            aria-label="Search threads"
            className="h-7 rounded-lg border-border/70 bg-surface-1 pl-6 text-[11.5px]"
          />
        </div>
        {openSessions.length > TAB_WARN ? (
          <p className="mb-2 rounded-md border border-warn/30 bg-warn/10 px-2 py-1 text-[10.5px] text-warn">
            {openSessions.length} open threads — archive what you're done with.
          </p>
        ) : null}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visibleOpen.map((conversation) => (
            <div key={conversation.id} className={cn("group flex items-center gap-1 rounded-lg px-2 py-1.5", conversation.id === activeId ? "bg-surface-2" : "hover:bg-surface-2/60")}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setDraft(false); setActiveId(conversation.id); }}>
                <p className="truncate text-[12px] font-medium">{conversation.title}</p>
                <p className="truncate text-[10px] text-muted-foreground">{scopeLabel(conversation, world)}</p>
              </button>
              <button
                type="button" aria-label="Archive thread"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => void patchSession(conversation.id, { archived: true })}
              >
                <Archive className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="focus-ring w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
              onClick={() => setThreadLimit((limit) => limit + THREAD_PAGE_SIZE)}
            >
              Show more (+{hiddenCount})
            </button>
          ) : null}
          {!filteredOpen.length ? (
            <p className="px-2 text-[11px] text-muted-foreground">{query ? "No threads match your search." : "No threads yet. Ask something."}</p>
          ) : null}
        </div>
        <button type="button" className="mt-2 px-1 text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide" : "Show"} archived ({archived.length})
        </button>
        {showArchived ? (
          <div className="mt-1 space-y-1">
            {filteredArchived.map((conversation) => (
              <div key={conversation.id} className="flex items-center gap-1 rounded-lg px-2 py-1">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[11px] text-muted-foreground" onClick={() => { void patchSession(conversation.id, { archived: false }); setDraft(false); setActiveId(conversation.id); }}>
                  {conversation.title}
                </button>
                <ArchiveRestore className="h-3 w-3 text-muted-foreground" />
              </div>
            ))}
          </div>
        ) : null}
      </aside>

      {/* thread */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border/70 bg-surface-1/40">
        <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{active?.title ?? "New research thread"}</p>
          {active ? (
            <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
              scope: {scopeLabel(active, world)}
            </span>
          ) : (
            <select
              value={`${newScope.kind}:${newScope.id ?? ""}`}
              onChange={(event) => {
                const [kind, id] = event.target.value.split(":");
                setNewScope({ kind, id: id || null });
              }}
              aria-label="Scope for new thread"
              className="h-7 rounded-md border border-border/70 bg-surface-1 px-1.5 text-[10.5px] text-muted-foreground"
            >
              <option value="workspace:">scope: workspace</option>
              {(world?.projects ?? []).map((project) => <option key={project.id} value={`project:${project.id}`}>project: {project.name}</option>)}
              {(world?.people ?? []).slice(0, 12).map((person) => <option key={person.id} value={`person:${person.id}`}>person: {person.name}</option>)}
            </select>
          )}
          <button type="button" aria-label="Toggle context panel" onClick={() => setContextOpen((v) => !v)} className="text-muted-foreground hover:text-foreground">
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <div key={message.id} className={cn("space-y-2", message.role === "user" && "rounded-xl border border-border/60 bg-surface-2/50 px-3 py-2")}>
              {message.role !== "user" ? (
                <p className="eyebrow">
                  {message.role === "system" ? "system" : `copilot${message.model ? ` · ${message.provider} · ${message.model}` : ""}`}
                </p>
              ) : null}
              {message.parts.map((part, index) => <PartRenderer key={index} part={part} />)}
            </div>
          ))}
          {streaming ? (
            <div className="space-y-2">
              <p className="eyebrow flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> copilot{liveMeta.model ? ` · ${liveMeta.provider} · ${liveMeta.model}` : ""}
              </p>
              {phases.map((phase, index) => <p key={index} className="text-[11px] text-muted-foreground">{phase}</p>)}
              {liveParts.map((part, index) => <PartRenderer key={`live-${index}`} part={part} />)}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-end gap-2 border-t border-border/70 px-3 py-2.5"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
            }}
            rows={2}
            placeholder="Ask, or describe a goal to design — the thread keeps its scope"
            aria-label="Message the copilot"
            className="min-h-10 flex-1 resize-none rounded-lg border border-border/70 bg-surface-1 px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex flex-col gap-1">
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model route" className="h-7 max-w-36 rounded-md border border-border/70 bg-surface-1 px-1.5 text-[10.5px] text-muted-foreground">
              <option value="auto">auto · policy</option>
              {modelOptions.flatMap((provider) => provider.models.slice(0, 6).map((m) => (
                <option key={`${provider.provider}/${m}`} value={`${provider.provider}/${m}`}>{provider.provider} · {m}</option>
              )))}
            </select>
            <select value={reasoning} onChange={(e) => setReasoning(e.target.value)} aria-label="Reasoning effort" className="h-7 rounded-md border border-border/70 bg-surface-1 px-1.5 text-[10.5px] text-muted-foreground">
              <option value="off">think off</option><option value="low">low</option><option value="medium">med</option><option value="high">high</option>
            </select>
          </div>
          {streaming ? (
            <Button type="button" size="sm" variant="outline" className="h-9 rounded-md px-2.5" onClick={() => sendTurn({ type: "ABORT" })} aria-label="Stop turn">
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button type="submit" size="sm" className="h-9 rounded-md px-3" disabled={!text.trim()} aria-label="Send">
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </form>
      </section>

      {/* context panel */}
      {contextOpen ? (
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto rounded-xl border border-border/70 bg-surface-1/60 p-3 xl:flex">
          <p className="eyebrow mb-2">Context · {active ? scopeLabel(active, world) : "workspace"}</p>
          {contextEntity && "claims" in contextEntity ? (
            <div className="space-y-2">
              <p className="text-[12.5px] font-medium">{contextEntity.name}</p>
              <p className="text-[11px] text-muted-foreground">{contextEntity.role} · strength {contextEntity.strength} · {contextEntity.warmth}</p>
              {contextEntity.claims.slice(0, 6).map((claim) => (
                <div key={claim.id} className={cn("rounded-lg border px-2 py-1.5 text-[11px]", claim.status === "sourced" ? "border-border/60 bg-surface-2/50" : "border-dashed border-amber-500/40 bg-amber-500/5 text-amber-200/80")}>
                  {claim.text}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{claim.source.label} · {claim.status}</p>
                </div>
              ))}
            </div>
          ) : contextEntity ? (
            <div className="space-y-2">
              <p className="text-[12.5px] font-medium">{contextEntity.name}</p>
              <p className="text-[11px] text-muted-foreground">{contextEntity.summary}</p>
              {(world?.objectives ?? []).filter((o) => o.projectId === contextEntity.id).map((objective) => (
                <p key={objective.id} className="text-[11px] text-muted-foreground">{objective.name} · {objective.progress}%</p>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Pin a person or project to keep their evidence beside the thread. {world?.people.length ?? 0} people, {world?.projects.length ?? 0} projects in this workspace.
            </p>
          )}
        </aside>
      ) : null}
    </div>
  );
};

export default SessionWorkspace;
