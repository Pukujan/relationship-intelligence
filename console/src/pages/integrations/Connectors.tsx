import { useState } from "react";
import {
  Calendar,
  Check,
  Linkedin,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Plug,
  RefreshCw,
  Twitter,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { connectorStatusMeta, relativeTime } from "@/data/derive";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { ConnectorProvider } from "@/data/types";

const providerIcon: Record<ConnectorProvider, typeof Mail> = {
  linkedin: Linkedin,
  x: Twitter,
  luma: MapPin,
  gmail: Mail,
  gcal: Calendar,
};

const Connectors = () => {
  const { world, status, error, reload, connectConnector } = useData();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [webResults, setWebResults] = useState<{ title: string; url: string; snippet: string }[]>([]);
  const [webBusy, setWebBusy] = useState(false);

  const testWeb = async () => {
    setWebBusy(true);
    try {
      const r = await fetch("/api/web-search?q=relationship+intelligence+crm");
      const body = (await r.json()) as { results?: { title: string; url: string; snippet: string }[] };
      setWebResults(body.results ?? []);
    } finally {
      setWebBusy(false);
    }
  };

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

  const connect = async (connectorId: string, name: string) => {
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

  const groups = [
    { status: "connected" as const, label: "Connected" },
    { status: "needs_setup" as const, label: "Needs setup" },
    { status: "expired" as const, label: "Expired" },
  ];

  const connected = world.connectors.filter((c) => c.status === "connected").length;

  return (
    <div className="space-y-5">
      <div className="mb-4 rounded-xl border border-border/70 bg-surface-1/60 p-3">
        <p className="eyebrow mb-2">What is actually wired</p>
        <div className="flex flex-wrap gap-1.5 text-[10.5px]">
          <span className="rounded-full border border-run/30 bg-run/10 px-2 py-0.5 text-run">TinyFish web research: live (unverified until sourced)</span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">LinkedIn: session proof exists (collector), wiring pending #12</span>
          <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn">Gmail / Calendar: needs Google scopes + OAuth client (owner action)</span>
        </div>
        <button
          type="button"
          onClick={() => void testWeb()}
          disabled={webBusy}
          className="focus-ring mt-2 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {webBusy ? "Searching…" : "Test web search"}
        </button>
        {webResults.length ? (
          <div className="mt-2 space-y-1">
            {webResults.map((r) => (
              <p key={r.url} className="truncate text-[11px] text-muted-foreground">
                <span className="text-foreground/80">{r.title}</span> · {r.snippet.slice(0, 90)} · <span className="text-amber-400">unverified</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <PageHeader
        eyebrow="Integrations"
        title="Connectors"
        description="Where the workspace reads from. Every connector belongs to a principal — a teammate or a named agent — and no credential ever reaches the browser."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-run" />
          Credentials are stored server-side and never shown.
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="num text-foreground">{connected}</span> of{" "}
          {world.connectors.length} connected
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {world.connectors
            .filter((connector) => connector.status !== "connected")
            .map((connector) => (
              <Pill
                key={connector.id}
                className="border-warn/30 bg-warn/10 text-warn"
              >
                {connector.name}
              </Pill>
            ))}
        </span>
      </div>

      {groups.map((group) => {
        const connectors = world.connectors.filter(
          (connector) => connector.status === group.status,
        );
        if (!connectors.length) return null;
        return (
          <section key={group.status} className="space-y-2.5">
            <SectionHeader title={group.label} count={connectors.length} />
            <div className="grid gap-3 md:grid-cols-2">
              {connectors.map((connector) => {
                const Icon = providerIcon[connector.provider];
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
                          <p className="truncate text-[13px] font-semibold">
                            {connector.name}
                          </p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {connector.principal}
                          </p>
                        </div>
                      </div>
                      <Pill className={meta.className}>{meta.label}</Pill>
                    </div>

                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {connector.detail}
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {connector.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded border border-border/70 bg-surface-2/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                      <span className="text-[10.5px] text-muted-foreground">
                        {connector.lastSync
                          ? `Last sync ${relativeTime(connector.lastSync)}`
                          : "Never synced"}
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
                          onClick={() => void connect(connector.id, connector.name)}
                        >
                          {isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : connector.status === "expired" ? (
                            <RefreshCw className="h-3 w-3" />
                          ) : (
                            <Plug className="h-3 w-3" />
                          )}
                          {connector.status === "expired" ? "Reconnect" : "Connect"}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {world.connectors.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={Plug}
            title="No connectors yet"
            description="Connect a source so the agents can read from it. Reads are safe; every write still needs your approval."
          />
        </div>
      ) : null}

      <div className={cn("rounded-xl border border-border/60 bg-surface-1/40 p-3.5")}>
        <p className="text-[11.5px] font-medium">Who owns a connector</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          A connector belongs to the principal who authorised it. If a teammate
          connects their own LinkedIn, their graph is theirs — it is not silently
          merged into the workspace. Agents only read what their principal granted.
        </p>
      </div>
    </div>
  );
};

export default Connectors;
