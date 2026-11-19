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
  dataSource,
  type ApprovalDecisionResult,
  type NewActivity,
} from "./source";
import type {
  ActivityEntry,
  Agent,
  Connector,
  ConnectorStatus,
  DecisionInput,
  Plugin,
  Project,
  Session,
  SessionMode,
  World,
} from "./types";

type LoadStatus = "loading" | "ready" | "error";

const SESSION_KEY = "mission-control.session.v1";

const readSession = (): Session | null => {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

const writeSession = (session: Session | null) => {
  try {
    if (session) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // A blocked storage API should never break sign-in.
  }
};

interface DataContextValue {
  world: World | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
  session: Session | null;
  signIn: (mode: SessionMode) => Promise<Session>;
  signOut: () => void;
  /** "all" or a project id. Scopes the work views. */
  activeProjectId: string;
  activeProject: Project | null;
  setActiveProject: (projectId: string) => void;
  decide: (input: DecisionInput) => Promise<ApprovalDecisionResult>;
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
  const [session, setSession] = useState<Session | null>(readSession);
  const [activeProjectId, setActiveProjectId] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    dataSource
      .loadWorld()
      .then((next) => {
        if (cancelled) return;
        setWorld(next);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load the workspace.",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const signIn = useCallback(async (mode: SessionMode) => {
    const next = await dataSource.signIn(mode);
    writeSession(next);
    setSession(next);
    setActiveProjectId("all");
    return next;
  }, []);

  const signOut = useCallback(() => {
    writeSession(null);
    setSession(null);
    setActiveProjectId("all");
  }, []);

  const setActiveProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
  }, []);

  const decide = useCallback(async (input: DecisionInput) => {
    const result = await dataSource.decideApproval(input);
    setWorld((current) => {
      if (!current) return current;
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
  }, []);

  const toggleAgentPause = useCallback(async (agentId: string) => {
    const current = world?.agents.find((agent) => agent.id === agentId);
    const nextStatus = current?.status === "paused" ? "running" : "paused";
    const agent = await dataSource.setAgentStatus(agentId, nextStatus);
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
  }, [world]);

  const connectConnector = useCallback(
    async (connectorId: string) => {
      const connector = await dataSource.setConnectorStatus(
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
    [],
  );

  const setPluginInstalled = useCallback(
    async (pluginId: string, installed: boolean) => {
      const plugin = await dataSource.setPluginInstalled(pluginId, installed);
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
    [],
  );

  const logActivity = useCallback(async (input: NewActivity) => {
    const entry = await dataSource.logActivity(input);
    setWorld((state) =>
      state ? { ...state, activity: [entry, ...state.activity] } : state,
    );
    return entry;
  }, []);

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
      signIn,
      signOut,
      activeProjectId,
      activeProject,
      setActiveProject,
      decide,
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
      signIn,
      signOut,
      activeProjectId,
      activeProject,
      setActiveProject,
      decide,
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
