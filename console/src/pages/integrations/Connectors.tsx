import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Check,
  ExternalLink,
  HardDrive,
  Linkedin,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Mic,
  Phone,
  Plug,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  Twitter,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { connectorStatusMeta, relativeTime } from "@/data/derive";
import {
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { ConnectorProvider } from "@/data/types";
import {
  CONNECTOR_CRED_PREFIX,
  deriveConnectorChip,
  type UserConnectorView,
} from "../../../../app/shared/contracts";
import { RunnerSetupDialog } from "@/components/integrations/RunnerSetupDialog";

type UserConnectorItem = UserConnectorView;

const CHIP_CLASS: Record<string, string> = {
  ok: "border-run/30 bg-run/10 text-run",
  warn: "border-warn/30 bg-warn/10 text-warn",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-surface-2 text-muted-foreground",
};

interface ConnectorRouteItem {
  id: string;
  provider: string;
  matchExpr: string;
  targetWorkspaceId: string;
  targetProjectId: string | null;
  cadence: "daily" | "pre_event" | "signal";
  createdAt: string;
}

const providerIcon: Record<string, typeof Mail> = {
  linkedin: Linkedin,
  x: Twitter,
  luma: MapPin,
  gmail: Mail,
  gcal: Calendar,
  gdrive: HardDrive,
  zoom: Video,
  calendly: Calendar,
  slack: MessageSquare,
  discord: MessageSquare,
  wispr: Mic,
  riley: Phone,
};

const Connectors = () => {
  const { world, status, error, reload, connectConnector } = useData();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [userConnectors, setUserConnectors] = useState<UserConnectorItem[]>([]);
  const [routes, setRoutes] = useState<ConnectorRouteItem[]>([]);
  const [routeProvider, setRouteProvider] = useState("gmail");
  const [routeMatch, setRouteMatch] = useState("");
  const [routeWorkspaceId, setRouteWorkspaceId] = useState("");
  const [routeProjectId, setRouteProjectId] = useState("");
  const [routeCadence, setRouteCadence] = useState<"daily" | "pre_event" | "signal">("signal");
  const [routeBusy, setRouteBusy] = useState(false);
  const [setupFor, setSetupFor] = useState<UserConnectorItem | null>(null);

  const loadUserConnectors = useCallback(async () => {
    try {
      const r = await fetch("/app-api/connectors", { credentials: "same-origin" });
      if (!r.ok) return;
      const data = (await r.json()) as {
        connectors?: UserConnectorItem[];
        routes?: ConnectorRouteItem[];
      };
      setUserConnectors(data.connectors ?? []);
      setRoutes(data.routes ?? []);
    } catch {
      // Offline / demo mode gracefully hides user-connector server panel
    }
  }, []);

  useEffect(() => {
    void loadUserConnectors();
    const params = new URLSearchParams(window.location.search);
    const connectedProvider = params.get("connected");
    const connectorErr = params.get("connector_error");
    if (connectedProvider) {
      toast.success(`${connectedProvider.toUpperCase()} connected`, {
        description: "Tokens are stored server-side. Add a routing rule below to direct signals.",
      });
    } else if (connectorErr) {
      toast.error("Connector OAuth didn't finish", { description: connectorErr });
    }
  }, [loadUserConnectors]);

  useEffect(() => {
    if (!routeWorkspaceId && world?.workspaces?.[0]?.id) {
      setRouteWorkspaceId(world.workspaces[0].id);
    }
  }, [routeWorkspaceId, world]);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Connectors didn't load"
        description={error ?? "Something went wrong reading the connectors."}
        onRetry={reload}
      />
    );
  }

  const addRoute = async () => {
    if (!routeMatch.trim() || !routeWorkspaceId) return;
    setRouteBusy(true);
    try {
      const r = await fetch("/app-api/connectors/routes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: routeProvider,
          matchExpr: routeMatch.trim(),
          targetWorkspaceId: routeWorkspaceId,
          targetProjectId: routeProjectId || null,
          cadence: routeCadence,
        }),
      });
      if (!r.ok) throw new Error("Failed to save routing rule");
      setRouteMatch("");
      toast.success("Routing rule added");
      await loadUserConnectors();
    } catch (cause) {
      toast.error("Could not save route", {
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setRouteBusy(false);
    }
  };

  const removeRoute = async (id: string) => {
    try {
      await fetch(`/app-api/connectors/routes/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setRoutes((prev) => prev.filter((item) => item.id !== id));
    } catch {
      toast.error("Could not remove route");
    }
  };

  const syncNow = async (provider: string, name: string) => {
    setPendingId(`sync:${provider}`);
    try {
      const r = await fetch(`/app-api/connectors/${encodeURIComponent(provider)}/sync`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await r.json()) as { syncedCount?: number; detail?: string; error?: string };
      if (!r.ok) {
        toast.error(`${name} sync failed`, { description: data.detail ?? data.error ?? "Try again." });
        await loadUserConnectors();
        return;
      }
      toast.success(`${name} synced`, {
        description: `Imported ${data.syncedCount ?? 0} recent item(s) and applied your routing rules.`,
      });
      await loadUserConnectors();
      void reload();
    } finally {
      setPendingId(null);
    }
  };

  const disconnectUserConnector = async (provider: string, name: string) => {
    setPendingId(provider);
    try {
      await fetch(`/app-api/connectors/${encodeURIComponent(provider)}/disconnect`, {
        method: "POST",
        credentials: "same-origin",
      });
      toast.success(`${name} disconnected`);
      await loadUserConnectors();
    } finally {
      setPendingId(null);
    }
  };

  const connectLegacy = async (connectorId: string, name: string) => {
    setPendingId(connectorId);
    try {
      await connectConnector(connectorId);
      toast.success(`${name} connected`, {
        description: "The agent can read from it now. Sending still needs you.",
      });
    } catch (cause) {
      toast.error("That connection didn't complete", {
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setPendingId(null);
    }
  };

  const connectedCount = userConnectors.filter((c) => c.status === "connected").length;
  const workspaceName = (id: string) =>
    world.workspaces.find((w) => w.id === id)?.name ?? id;
  const projectName = (id: string | null) =>
    id ? (world.projects.find((p) => p.id === id)?.name ?? id) : "Workspace inbox";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Integrations"
        title="Connectors & Routing"
        description="Authorize your personal tools once (Gmail, Google Calendar, Google Drive, Zoom, etc.) and route signals into the right Workspace and Project. Credentials stay server-side."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-run" />
          OAuth tokens are stored server-side and never sent to the browser.
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="num text-foreground">{connectedCount}</span> of{" "}
          {userConnectors.length || world.connectors.length} personal connectors active
        </span>
      </div>

      {userConnectors.length > 0 ? (
        <section className="space-y-2.5">
          <SectionHeader
            title="Your personal connectors (follow you across workspaces)"
            count={userConnectors.length}
          />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {userConnectors.map((c) => {
              const Icon = providerIcon[c.provider] ?? Plug;
              const chip = deriveConnectorChip(c);
              const isBusy = pendingId === c.provider;
              return (
                <article key={c.provider} className="panel flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-foreground/80">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">{c.name}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">
                          {c.accountEmail ?? c.category}
                        </p>
                      </div>
                    </div>
                    <Pill className={CHIP_CLASS[chip.tone] ?? CHIP_CLASS.muted}>{chip.label}</Pill>
                  </div>

                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {c.description}
                  </p>

                  <div className="flex flex-wrap gap-1">
                    {c.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded border border-border/70 bg-surface-2/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                      >
                        {scope.replace("https://www.googleapis.com/auth/", "")}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                    <span className="text-[10.5px] text-muted-foreground">
                      {c.lastSync ? `Synced ${relativeTime(c.lastSync)}` : "Not connected yet"}
                    </span>
                    {c.status === "connected" ? (
                      <div className="flex items-center gap-1.5">
                        {c.authKind !== "local_runner" ? (
                        <Button
                          size="sm"
                          className="h-7 gap-1 rounded-md px-2 text-[11px]"
                          disabled={pendingId === `sync:${c.provider}`}
                          onClick={() => void syncNow(c.provider, c.name)}
                        >
                          {pendingId === `sync:${c.provider}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          Sync now
                        </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 rounded-md px-2 text-[11px]"
                          disabled={isBusy}
                          onClick={() => void disconnectUserConnector(c.provider, c.name)}
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-run" />}
                          Disconnect
                        </Button>
                        {c.authKind === "local_runner" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 rounded-md px-2 text-[11px]"
                            onClick={() => setSetupFor(c)}
                          >
                            Set up
                          </Button>
                        ) : null}
                      </div>
                    ) : c.connectUrl ? (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 rounded-md px-2 text-[11px]"
                        asChild
                      >
                        <a href={c.connectUrl}>
                          <ExternalLink className="h-3 w-3" />
                          Connect {c.name}
                        </a>
                      </Button>
                    ) : (
                      c.authKind === "local_runner" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 rounded-md px-2 text-[11px]"
                          onClick={() => setSetupFor(c)}
                        >
                          <Plug className="h-3 w-3" />
                          Set up
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {`Add ${CONNECTOR_CRED_PREFIX[c.provider] ?? c.provider.toUpperCase()}_CLIENT_ID/SECRET`}
                        </span>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="panel space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-primary" />
          <div>
            <p className="text-[13px] font-semibold">Workspace & Project routing rules</p>
            <p className="text-[11px] text-muted-foreground">
              Route incoming emails, calendar events, Drive files, or Zoom recordings into a specific Workspace and Project. Unmatched items stay in your Personal workspace.
            </p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          <select
            value={routeProvider}
            onChange={(e) => setRouteProvider(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface-1 px-2 text-[11.5px]"
          >
            {userConnectors.length > 0 ? (
              userConnectors.map((c) => (
                <option key={c.provider} value={c.provider}>
                  {c.name}
                </option>
              ))
            ) : (
              <>
                <option value="gmail">Gmail</option>
                <option value="gcal">Google Calendar</option>
                <option value="gdrive">Google Drive</option>
                <option value="zoom">Zoom</option>
                <option value="linkedin">LinkedIn</option>
                <option value="luma">Luma</option>
              </>
            )}
          </select>
          <input
            value={routeMatch}
            onChange={(e) => setRouteMatch(e.target.value)}
            placeholder="Match (e.g. mta.info, GISMO, SMART Grant)"
            className="h-8 rounded-md border border-border bg-surface-1 px-2.5 text-[11.5px] md:col-span-2"
          />
          <select
            value={routeWorkspaceId}
            onChange={(e) => setRouteWorkspaceId(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface-1 px-2 text-[11.5px]"
          >
            {world.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <select
              value={routeCadence}
              onChange={(e) => setRouteCadence(e.target.value as "daily" | "pre_event" | "signal")}
              className="h-8 flex-1 rounded-md border border-border bg-surface-1 px-2 text-[11.5px]"
            >
              <option value="signal">Signal</option>
              <option value="daily">Daily</option>
              <option value="pre_event">Per-event</option>
            </select>
            <Button
              size="sm"
              className="h-8 gap-1 px-2.5 text-[11px]"
              disabled={routeBusy || !routeMatch.trim()}
              onClick={() => void addRoute()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>

        {world.projects.length > 0 ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Optional project target:</span>
            <select
              value={routeProjectId}
              onChange={(e) => setRouteProjectId(e.target.value)}
              className="h-7 rounded-md border border-border bg-surface-1 px-2 text-[11px]"
            >
              <option value="">Workspace inbox (any project)</option>
              {world.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {routes.length > 0 ? (
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {routes.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[11.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill className="border-border bg-surface-2 text-foreground">{r.provider}</Pill>
                  <span className="font-mono text-[11px] text-foreground">{r.matchExpr}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">{workspaceName(r.targetWorkspaceId)}</span>
                  <span className="text-muted-foreground">/ {projectName(r.targetProjectId)}</span>
                  <Pill className="border-primary/30 bg-primary/10 text-primary">{r.cadence}</Pill>
                </div>
                <button
                  type="button"
                  onClick={() => void removeRoute(r.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No routing rules yet — add one above (for example, route <span className="font-mono">mta.info</span> from Gmail into Design Bakery).
          </p>
        )}
      </section>

      {world.connectors.length > 0 ? (
        <section className="space-y-2.5">
          <SectionHeader title="Workspace connectors" count={world.connectors.length} />
          <div className="grid gap-3 md:grid-cols-2">
            {world.connectors.map((connector) => {
              const Icon = providerIcon[connector.provider as ConnectorProvider] ?? Plug;
              const meta = connectorStatusMeta[connector.status];
              const isPending = pendingId === connector.id;
              return (
                <article key={connector.id} className="panel flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-foreground/80">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">{connector.name}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">{connector.principal}</p>
                      </div>
                    </div>
                    <Pill className={meta.className}>{meta.label}</Pill>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">{connector.detail}</p>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                    <span className="text-[10.5px] text-muted-foreground">
                      {connector.lastSync ? `Last sync ${relativeTime(connector.lastSync)}` : "Never synced"}
                    </span>
                    {connector.status === "connected" ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-run">
                        <Check className="h-3 w-3" />
                        Healthy
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 rounded-md px-2 text-[11px]"
                        disabled={isPending}
                        onClick={() => void connectLegacy(connector.id, connector.name)}
                      >
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Connect
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {setupFor ? (
        <RunnerSetupDialog
          provider={setupFor.provider}
          name={setupFor.name}
          scopes={setupFor.scopes}
          onClose={() => setSetupFor(null)}
          onChanged={() => void loadUserConnectors()}
        />
      ) : null}

      <div className={cn("rounded-xl border border-border/60 bg-surface-1/40 p-3.5")}>
        <p className="text-[11.5px] font-medium">Who owns a connector</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          A connector belongs to the principal who authorised it. Incoming signals stay private in your Personal workspace unless a routing rule directs them into a shared Workspace or Project.
        </p>
      </div>
    </div>
  );
};

export default Connectors;
