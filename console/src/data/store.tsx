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
  createLocalSeedSource,
  type ApprovalDecisionResult,
  type MissionControlSource,
  type NewActivity,
} from "./source";
import { createOctoSource } from "./octoSource";
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
}

interface DataContextValue {
  world: World | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
  session: Session | null;
  /** True while the adapter cookie is being checked on first paint. */
  bootstrapping: boolean;
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
}

const DataContext = createContext<DataContextValue | null>(null);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [world, setWorld] = useState<World | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Session | null>(readStoredSession);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string>("all");

  const seedSource = useMemo(() => createLocalSeedSource(), []);
  const octoSource = useMemo(
    () => createOctoSource(() => session?.workspaceId ?? ""),
    [session?.workspaceId],
  );
  const source: MissionControlSource =
    session?.mode === "owner" ? octoSource : seedSource;

  // First paint: ask the adapter whether a sealed owner session exists. The
  // cookie is the authority; a stored guest session is only a demo convenience.
  useEffect(() => {
    let cancelled = false;
    fetch("/app-api/session", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { authenticated: false }))
      .then((state: AdapterSession) => {
        if (cancelled) return;
        if (state.authenticated && state.principal && state.workspaces?.length) {
          setSession({
            mode: "owner",
            name: state.principal.displayName ?? state.principal.email,
            email: state.principal.email,
            organizationId: "",
            workspaceId: state.workspaces[0].id,
            signedInAt: new Date().toISOString(),
            principalId: state.principal.id,
          });
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

  useEffect(() => {
    if (bootstrapping || !session) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);

    source
      .loadWorld(session.mode === "owner" ? session.workspaceId : undefined)
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
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, bootstrapping, session, source]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const signIn = useCallback(
    async (mode: SessionMode) => {
      if (mode === "owner") {
        // Redirects to the adapter's Google-through-Octo handshake.
        return octoSource.signIn("owner");
      }
      const next = await seedSource.signIn("guest");
      writeStoredSession(next);
      setSession(next);
      setActiveProjectId("all");
      return next;
    },
    [octoSource, seedSource],
  );

  const signOut = useCallback(() => {
    if (session?.mode === "owner") {
      void fetch("/app-api/logout", { method: "POST", credentials: "same-origin" });
    }
    writeStoredSession(null);
    setSession(null);
    setWorld(null);
    setActiveProjectId("all");
  }, [session?.mode]);

  const setActiveProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
  }, []);

  const setActiveWorkspace = useCallback((workspaceId: string) => {
    setSession((current) =>
      current ? { ...current, workspaceId } : current,
    );
    setActiveProjectId("all");
  }, []);

  const decide = useCallback(
    async (input: DecisionInput) => {
      const result = await source.decideApproval(input);
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
    [source],
  );

  const addProposal = useCallback(
    async (input: NewProposal) => {
      const approval = await source.addProposal(input);
      setWorld((current) =>
        current
          ? { ...current, approvals: [approval, ...current.approvals] }
          : current,
      );
      return approval;
    },
    [source],
  );

  const toggleAgentPause = useCallback(
    async (agentId: string) => {
      const current = world?.agents.find((agent) => agent.id === agentId);
      const nextStatus = current?.status === "paused" ? "running" : "paused";
      const agent = await source.setAgentStatus(agentId, nextStatus);
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
    [source, world],
  );

  const connectConnector = useCallback(
    async (connectorId: string) => {
      const connector = await source.setConnectorStatus(
        connectorId,
        "connected" as ConnectorStatus,
      );
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
    [source],
  );

  const setPluginInstalled = useCallback(
    async (pluginId: string, installed: boolean) => {
      const plugin = await source.setPluginInstalled(pluginId, installed);
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
    [source],
  );

  const logActivity = useCallback(
    async (input: NewActivity) => {
      const entry = await source.logActivity(input);
      setWorld((state) =>
        state ? { ...state, activity: [entry, ...state.activity] } : state,
      );
      return entry;
    },
    [source],
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
    }),
    [
      world,
      status,
      error,
      reload,
      session,
      bootstrapping,
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
