import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  cachedLoad,
  clearCache,
  invalidate,
  isAuthError,
  scopePrefix,
  type CacheScope,
} from "@/lib/cache";
import {
  createLocalSeedSource,
  type ApprovalDecisionResult,
  type MissionControlSource,
  type NewActivity,
} from "./source";
import { createOctoSource } from "./octoSource";
import type { Conversation, SessionMessage } from "./sessionTypes";
import type {
  ActivityEntry,
  Agent,
  Approval,
  Connector,
  ConnectorStatus,
  DecisionInput,
  NewProposal,
  Plugin,
  Project,
  Session,
  SessionMode,
  World,
} from "./types";

type LoadStatus = "loading" | "ready" | "error";

const SESSION_KEY = "mission-control.session.v1";
const WORKSPACE_KEY = "mission-control.workspace.v1";

const readStoredSession = (): Session | null => {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    // Only guest sessions persist locally; owner authority is the cookie.
    return parsed?.mode === "guest" ? parsed : null;
  } catch {
    return null;
  }
};

const writeStoredSession = (session: Session | null) => {
  try {
    if (session?.mode === "guest") {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // A blocked storage API should never break sign-in.
  }
};

interface AdapterSession {
  authenticated: boolean;
  principal?: { id: string; email: string; displayName: string | null };
  workspaces?: { id: string; name: string }[];
  /** Epoch ms of the Octo token's absolute expiry; advisory countdown only. */
  expiresAt?: number;
  /** Why the session ended: "octo_token_expired" | "idle_expired". */
  reason?: string;
  /** True when the adapter kept the cookie so sign-in can resume in place. */
  resume?: boolean;
}

/** Cache entries are scoped to the principal so snapshots never cross users. */
const cacheScope = (session: Session): CacheScope => ({
  mode: session.mode,
  workspaceId: session.workspaceId,
  principalId: session.principalId ?? "",
});

interface DataContextValue {
  world: World | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
  session: Session | null;
  /** True while the adapter cookie is being checked on first paint. */
  bootstrapping: boolean;
  /** Epoch ms when the Octo token expires; null for guests or when unknown. */
  sessionExpiresAt: number | null;
  /** "octo_token_expired" | "idle_expired" when the adapter ended the session. */
  sessionReason: string | null;
  /** Re-authenticate through Octo and return to the current path. */
  resumeSession: () => void;
  connectWithKey: (key: string) => Promise<void>;
  /** True when the last adapter read failed and a stale snapshot is shown. */
  offline: boolean;
  signIn: (mode: SessionMode) => Promise<Session>;
  signOut: () => void;
  /** "all" or a project id. Scopes the work views. */
  activeProjectId: string;
  activeProject: Project | null;
  setActiveProject: (projectId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  decide: (input: DecisionInput) => Promise<ApprovalDecisionResult>;
  addProposal: (input: NewProposal) => Promise<Approval>;
  toggleAgentPause: (agentId: string) => Promise<Agent>;
  connectConnector: (connectorId: string) => Promise<Connector>;
  setPluginInstalled: (pluginId: string, installed: boolean) => Promise<Plugin>;
  logActivity: (input: NewActivity) => Promise<ActivityEntry>;
  sessions: Conversation[];
  refreshSessions: () => Promise<void>;
  createSession: (input: { title: string; scopeKind: string; scopeId?: string | null }) => Promise<Conversation>;
  patchSession: (sessionId: string, patch: { title?: string; archived?: boolean; scopeKind?: string; scopeId?: string | null }) => Promise<Conversation>;
  loadMessages: (sessionId: string) => Promise<SessionMessage[]>;
  appendMessage: (sessionId: string, message: SessionMessage) => Promise<SessionMessage>;
}

const DataContext = createContext<DataContextValue | null>(null);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [world, setWorld] = useState<World | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Session | null>(readStoredSession);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [sessionReason, setSessionReason] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string>("all");
  const [sessions, setSessions] = useState<Conversation[]>([]);

  const seedSource = useMemo(() => createLocalSeedSource(), []);
  const octoSource = useMemo(
    () => createOctoSource(() => session?.workspaceId ?? ""),
    [session?.workspaceId],
  );
  const source: MissionControlSource =
    session?.mode === "owner" ? octoSource : seedSource;

  /**
   * Re-check the sealed session without adopting a new one. A transient
   * adapter/Octo outage (non-OK response or network error) is NOT a sign-out;
   * only an explicit authenticated:false ends the session, carrying the
   * adapter's reason so SignIn can offer a one-click Resume.
   */
  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/app-api/session", { credentials: "same-origin" });
      if (!response.ok) return;
      const state = (await response.json()) as AdapterSession;
      if (state.authenticated) {
        setSessionExpiresAt(typeof state.expiresAt === "number" ? state.expiresAt : null);
        setSessionReason(null);
        return;
      }
      setSessionReason(state.reason ?? null);
      setSessionExpiresAt(null);
      setSession(null);
      setWorld(null);
      setSessions([]);
    } catch {
      // Network failure is not a sign-out; the cached views stay usable.
    }
  }, []);

  // First paint: ask the adapter whether a sealed owner session exists. The
  // cookie is the authority; a stored guest session is only a demo convenience.
  useEffect(() => {
    let cancelled = false;
    fetch("/app-api/session", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { authenticated: false }))
      .then(async (state: AdapterSession) => {
        if (cancelled) return;
        if (state.authenticated && state.principal && state.workspaces?.length) {
          // Restore the owner's last selected workspace so reloads resume the
          // same threads instead of falling back to the first membership.
          let stored: string | null = null;
          try {
            stored = window.sessionStorage.getItem(WORKSPACE_KEY);
          } catch {
            stored = null;
          }
          // Prefer the workspace this console is configured for (the one with
          // the ri_console schema), then the owner's last selection, then first.
          let configured: string | null = null;
          try {
            const cfg = await fetch("/app-api/config", { credentials: "same-origin" }).then((r) => r.json());
            configured = cfg.workspaceId ?? null;
          } catch {
            configured = null;
          }
          const selected =
            state.workspaces.find((workspace) => workspace.id === configured) ??
            state.workspaces.find((workspace) => workspace.id === stored) ??
            state.workspaces[0];
          setSession({
            mode: "owner",
            name: state.principal.displayName ?? state.principal.email,
            email: state.principal.email,
            organizationId: "",
            workspaceId: selected.id,
            signedInAt: new Date().toISOString(),
            principalId: state.principal.id,
          });
          setSessionExpiresAt(typeof state.expiresAt === "number" ? state.expiresAt : null);
          setSessionReason(null);
        } else {
          // Keep the reason (octo_token_expired / idle_expired) for SignIn's
          // resume banner; a plain anonymous state is a first sign-in.
          setSessionReason(state.reason ?? null);
          setSessionExpiresAt(null);
        }
        setBootstrapping(false);
      })
      .catch(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Longevity: poll the session while an owner is signed in, and re-check on
  // tab focus so a token that expired in a background tab is caught at once.
  useEffect(() => {
    if (session?.mode !== "owner") return;
    const interval = window.setInterval(() => void checkSession(), 60_000);
    const onFocus = () => void checkSession();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [session?.mode, checkSession]);

  // Re-check right after the token's absolute expiry so the UI flips to the
  // resume flow promptly instead of waiting for the next poll.
  useEffect(() => {
    if (session?.mode !== "owner" || sessionExpiresAt === null) return;
    const delay = Math.max(0, sessionExpiresAt - Date.now()) + 1_000;
    const timer = window.setTimeout(() => void checkSession(), delay);
    return () => window.clearTimeout(timer);
  }, [session?.mode, sessionExpiresAt, checkSession]);

  useEffect(() => {
    if (bootstrapping || !session) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);

    // Owner reads go through the stale-while-revalidate cache; an unreachable
    // adapter serves the last snapshot labelled offline. Guest mode bypasses
    // the cache: the demo promises decisions reset on reload.
    const load =
      session.mode === "owner"
        ? cachedLoad<World>(cacheScope(session), "world", "", () =>
            source.loadWorld(session.workspaceId),
          ).then((result) => {
            if (!cancelled) setOffline(result.offline);
            return result.data;
          })
        : source.loadWorld();

    load
      .then((next) => {
        if (cancelled) return;
        setWorld(next);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setWorld(null);
        setError(
          cause instanceof Error ? cause.message : "Could not load the workspace.",
        );
        setStatus("error");
        // An expired session must reach the resume flow, not sit as an error.
        if (isAuthError(cause)) void checkSession();
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, bootstrapping, session, source, checkSession]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  /** Drop cached reads after a mutation so the next load reflects the write. */
  const invalidateCache = useCallback(
    (suffix: string) => {
      if (session?.mode !== "owner") return;
      invalidate(scopePrefix(cacheScope(session)) + suffix);
    },
    [session],
  );

  const connectWithKey = useCallback(async (key: string) => {
    const r = await fetch("/app-api/session/accept-key", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error === "KEY_REJECTED" ? "Octo rejected that key." : "Key must start with octo_live_ws_ or octo_live_acc_.");
    }
    window.location.reload();
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!session) return;
    try {
      if (session.mode === "owner") {
        const result = await cachedLoad<Conversation[]>(
          cacheScope(session),
          "sessions",
          "",
          () => source.listSessions(),
        );
        setOffline(result.offline);
        setSessions(result.data);
      } else {
        setSessions(await source.listSessions());
      }
    } catch (cause) {
      setSessions([]);
      if (isAuthError(cause)) void checkSession();
    }
  }, [session, source, checkSession]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const createSession = useCallback(
    async (input: { title: string; scopeKind: string; scopeId?: string | null }) => {
      const conversation = await source.createSession(input);
      invalidateCache("sessions");
      setSessions((current) => [conversation, ...current]);
      return conversation;
    },
    [source, invalidateCache],
  );

  const patchSession = useCallback(
    async (sessionId: string, patch: { title?: string; archived?: boolean; scopeKind?: string; scopeId?: string | null }) => {
      const conversation = await source.patchSession(sessionId, patch);
      invalidateCache("sessions");
      setSessions((current) => current.map((item) => (item.id === sessionId ? conversation : item)));
      return conversation;
    },
    [source, invalidateCache],
  );

  const loadMessages = useCallback(
    async (sessionId: string) => {
      if (session?.mode !== "owner") return source.loadMessages(sessionId);
      const result = await cachedLoad<SessionMessage[]>(
        cacheScope(session),
        "messages",
        sessionId,
        () => source.loadMessages(sessionId),
      );
      setOffline(result.offline);
      return result.data;
    },
    [session, source],
  );

  const appendMessage = useCallback(
    async (sessionId: string, message: SessionMessage) => {
      const saved = await source.appendMessage(sessionId, message);
      // The thread and the session list (updatedAt) both changed.
      invalidateCache(`messages:${sessionId}`);
      invalidateCache("sessions");
      return saved;
    },
    [source, invalidateCache],
  );

  const signIn = useCallback(
    async (mode: SessionMode) => {
      if (mode === "owner") {
        // Redirects to the adapter's Google-through-Octo handshake.
        return octoSource.signIn("owner");
      }
      const next = await seedSource.signIn("guest");
      writeStoredSession(next);
      setSession(next);
      setSessionExpiresAt(null);
      setSessionReason(null);
      setOffline(false);
      setActiveProjectId("all");
      return next;
    },
    [octoSource, seedSource],
  );

  /**
   * One-click resume after an expired/idle session: re-run the Google-through-
   * Octo handshake and land back on the exact path the user was on. The
   * adapter only accepts same-origin return paths (safeReturnTo), so this
   * cannot become an open redirect.
   */
  const resumeSession = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `/octo-auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }, []);

  const signOut = useCallback(() => {
    if (session?.mode === "owner") {
      void fetch("/app-api/logout", { method: "POST", credentials: "same-origin" });
    }
    // No principal's cached snapshot may outlive their session in this tab.
    clearCache();
    writeStoredSession(null);
    setSession(null);
    setWorld(null);
    setSessions([]);
    setSessionExpiresAt(null);
    setSessionReason(null);
    setOffline(false);
    setActiveProjectId("all");
  }, [session?.mode]);

  const setActiveProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
  }, []);

  const setActiveWorkspace = useCallback((workspaceId: string) => {
    try {
      window.sessionStorage.setItem(WORKSPACE_KEY, workspaceId);
    } catch {
      // storage blocked: selection lives for this visit only
    }
    setSession((current) =>
      current ? { ...current, workspaceId } : current,
    );
    setActiveProjectId("all");
  }, []);

  const decide = useCallback(
    async (input: DecisionInput) => {
      const result = await source.decideApproval(input);
      invalidateCache("world");
      setWorld((current) => {
        if (!current) return current;
        // An approved proposal can create work; adopt the source's snapshot.
        if (result.world) return result.world;
        return {
          ...current,
          approvals: current.approvals.map((approval) =>
            approval.id === result.approval.id ? result.approval : approval,
          ),
          activity: [result.activity, ...current.activity],
          agents: current.agents.map((agent) =>
            agent.id === result.agent.id ? result.agent : agent,
          ),
        };
      });
      return result;
    },
    [source, invalidateCache],
  );

  const addProposal = useCallback(
    async (input: NewProposal) => {
      const approval = await source.addProposal(input);
      invalidateCache("world");
      setWorld((current) =>
        current
          ? { ...current, approvals: [approval, ...current.approvals] }
          : current,
      );
      return approval;
    },
    [source, invalidateCache],
  );

  const toggleAgentPause = useCallback(
    async (agentId: string) => {
      const current = world?.agents.find((agent) => agent.id === agentId);
      const nextStatus = current?.status === "paused" ? "running" : "paused";
      const agent = await source.setAgentStatus(agentId, nextStatus);
      invalidateCache("world");
      setWorld((state) =>
        state
          ? {
              ...state,
              agents: state.agents.map((item) =>
                item.id === agent.id ? agent : item,
              ),
            }
          : state,
      );
      return agent;
    },
    [source, world, invalidateCache],
  );

  const connectConnector = useCallback(
    async (connectorId: string) => {
      const connector = await source.setConnectorStatus(
        connectorId,
        "connected" as ConnectorStatus,
      );
      invalidateCache("world");
      setWorld((state) =>
        state
          ? {
              ...state,
              connectors: state.connectors.map((item) =>
                item.id === connector.id ? connector : item,
              ),
            }
          : state,
      );
      return connector;
    },
    [source, invalidateCache],
  );

  const setPluginInstalled = useCallback(
    async (pluginId: string, installed: boolean) => {
      const plugin = await source.setPluginInstalled(pluginId, installed);
      invalidateCache("world");
      setWorld((state) =>
        state
          ? {
              ...state,
              plugins: state.plugins.map((item) =>
                item.id === plugin.id ? plugin : item,
              ),
            }
          : state,
      );
      return plugin;
    },
    [source, invalidateCache],
  );

  const logActivity = useCallback(
    async (input: NewActivity) => {
      const entry = await source.logActivity(input);
      invalidateCache("world");
      setWorld((state) =>
        state ? { ...state, activity: [entry, ...state.activity] } : state,
      );
      return entry;
    },
    [source, invalidateCache],
  );

  const activeProject = useMemo(() => {
    if (!world || activeProjectId === "all") return null;
    return world.projects.find((project) => project.id === activeProjectId) ?? null;
  }, [world, activeProjectId]);

  const value = useMemo<DataContextValue>(
    () => ({
      world,
      status,
      error,
      reload,
      session,
      bootstrapping,
      sessionExpiresAt,
      sessionReason,
      resumeSession,
      connectWithKey,
      offline,
      signIn,
      signOut,
      activeProjectId,
      activeProject,
      setActiveProject,
      setActiveWorkspace,
      decide,
      addProposal,
      toggleAgentPause,
      connectConnector,
      setPluginInstalled,
      logActivity,
      sessions,
      refreshSessions,
      createSession,
      patchSession,
      loadMessages,
      appendMessage,
    }),
    [
      world,
      status,
      error,
      reload,
      session,
      bootstrapping,
      sessionExpiresAt,
      sessionReason,
      resumeSession,
      connectWithKey,
      offline,
      signIn,
      signOut,
      activeProjectId,
      activeProject,
      setActiveProject,
      setActiveWorkspace,
      decide,
      addProposal,
      toggleAgentPause,
      connectConnector,
      setPluginInstalled,
      logActivity,
      sessions,
      refreshSessions,
      createSession,
      patchSession,
      loadMessages,
      appendMessage,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used inside <DataProvider>");
  }
  return context;
};
