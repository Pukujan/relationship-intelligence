import { Link } from "react-router-dom";
import {
  ArrowRight,
  Database,
  Lock,
  Server,
  Terminal,
  Wrench,
} from "lucide-react";
import { useData } from "@/data/store";
import { mcpStatusMeta } from "@/data/derive";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";

const McpServers = () => {
  const { world, status, error, reload } = useData();

  if (status === "loading") return <PageSkeleton rows={3} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="MCP servers didn't load"
        description={error ?? "Something went wrong reading the MCP servers."}
        onRetry={reload}
      />
    );
  }

  const connected = world.mcpServers.filter((server) => server.status === "connected");
  const pending = world.mcpServers.filter((server) => server.status !== "connected");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Integrations"
        title="MCP servers"
        description="Model Context Protocol servers expose tools to the agents. Octo MCP is the workspace's own record — projects, milestones, claims, and the graph."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5 text-run" />
          {connected.length} connected · {pending.length} need setup
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          Endpoints only — no tokens are rendered here.
        </span>
        <Link
          to="/integrations/connectors"
          className="focus-ring ml-auto inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
        >
          Connectors
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <section className="space-y-2.5">
        <SectionHeader title="Servers" count={world.mcpServers.length} />
        <div className="space-y-3">
          {world.mcpServers.map((server) => {
            const meta = mcpStatusMeta[server.status];
            const isOcto = server.id === "mcp1";
            return (
              <article
                key={server.id}
                className={
                  isOcto
                    ? "panel border-primary/25 p-4"
                    : "panel p-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-foreground/80">
                      <Database className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                        {server.name}
                        {isOcto ? (
                          <Pill className="border-primary/30 bg-primary/10 text-primary">
                            First
                          </Pill>
                        ) : null}
                      </p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {server.principal}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Pill className="border-border/70 bg-surface-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {server.transport}
                    </Pill>
                    <Pill className={meta.className}>{meta.label}</Pill>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5 rounded border border-border/70 bg-surface-2/60 px-1.5 py-0.5 font-mono">
                    <Terminal className="h-2.5 w-2.5" />
                    {server.endpoint}
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    {server.tools.length} tool
                    {server.tools.length === 1 ? "" : "s"} exposed
                  </span>
                </div>

                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {server.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
                    >
                      <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-foreground/85">
                        <Wrench className="h-2.5 w-2.5 text-muted-foreground" />
                        {tool.name}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>

                {server.status !== "connected" ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2">
                    <p className="text-[10.5px] leading-relaxed text-warn/90">
                      {server.status === "error"
                        ? "The server rejected the last call. Check the endpoint."
                        : "Add credentials server-side to finish setup."}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md px-2 text-[11px]"
                      asChild
                    >
                      <Link to="/integrations/connectors">Open connectors</Link>
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2.5 text-[10px] text-muted-foreground">
                    {isOcto
                      ? "Every query is scoped to this workspace's schema."
                      : `Exposes ${server.tools.length} tool${
                          server.tools.length === 1 ? "" : "s"
                        } to the agents, read-only unless the tool says otherwise.`}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {world.mcpServers.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={Server}
            title="No MCP servers connected"
            description="Connect Octo MCP first — it gives the agents the workspace record they need to be useful."
          />
        </div>
      ) : null}
    </div>
  );
};

export default McpServers;
