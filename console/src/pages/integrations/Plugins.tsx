import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Download, Loader2, Puzzle, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useData } from "@/data/store";
import { agentById } from "@/data/derive";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";

const Plugins = () => {
  const { world, status, error, reload, setPluginInstalled } = useData();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (status === "loading") return <PageSkeleton rows={4} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Plugins didn't load"
        description={error ?? "Something went wrong reading the plugin registry."}
        onRetry={reload}
      />
    );
  }

  const toggle = async (pluginId: string, installed: boolean, name: string) => {
    setPendingId(pluginId);
    try {
      await setPluginInstalled(pluginId, installed);
      toast.success(installed ? `${name} installed` : `${name} removed`, {
        description: installed
          ? "The agent can use it on the next run. Permissions stay scoped."
          : "The agent stops using it immediately.",
      });
    } catch (cause) {
      toast.error("That change didn't apply", {
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setPendingId(null);
    }
  };

  const installed = world.plugins.filter((plugin) => plugin.installed);
  const available = world.plugins.filter((plugin) => !plugin.installed);

  const renderCard = (
    plugin: (typeof world.plugins)[number],
  ) => {
    const isPending = pendingId === plugin.id;
    return (
      <article key={plugin.id} className="panel flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{plugin.name}</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">
              {plugin.category} · {plugin.author}
            </p>
          </div>
          {plugin.installed ? (
            <Pill className="border-run/30 bg-run/10 text-run">
              <Check className="h-2.5 w-2.5" />
              Installed
            </Pill>
          ) : (
            <Pill className="border-border bg-surface-2 text-muted-foreground">
              Available
            </Pill>
          )}
        </div>

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {plugin.description}
        </p>

        <div className="flex flex-wrap gap-1">
          {plugin.permissions.map((permission) => (
            <span
              key={permission}
              className="rounded border border-border/70 bg-surface-2/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
            >
              {permission}
            </span>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
          <div className="flex items-center gap-1.5">
            {plugin.agentIds.map((agentId) => {
              const agent = agentById(world, agentId);
              if (!agent) return null;
              return (
                <Link
                  key={agentId}
                  to={`/agents/${agent.id}`}
                  className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:text-primary"
                >
                  <AgentAvatar
                    agent={agent}
                    size="sm"
                    className="[&>div]:h-3.5 [&>div]:w-3.5 [&>div]:rounded-[4px]"
                  />
                  {agent.name}
                </Link>
              );
            })}
          </div>
          {plugin.installed ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 rounded-md px-2 text-[11px] text-muted-foreground"
              disabled={isPending}
              onClick={() => void toggle(plugin.id, false, plugin.name)}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Remove
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1 rounded-md px-2 text-[11px]"
              disabled={isPending}
              onClick={() => void toggle(plugin.id, true, plugin.name)}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Install
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Integrations"
        title="Plugins"
        description="Capabilities an agent can use on a run. Installing one grants a scoped permission — never blanket access to a source."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span>
          <span className="num text-foreground">{installed.length}</span> installed ·{" "}
          <span className="num text-foreground">{available.length}</span> available
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Permissions are scoped per agent and shown on every card.
        </span>
      </div>

      <section className="space-y-2.5">
        <SectionHeader title="Installed" count={installed.length} />
        {installed.length === 0 ? (
          <div className="panel p-5">
            <EmptyState
              icon={Puzzle}
              title="No plugins installed"
              description="Install one from the marketplace below. Nothing is enabled until you choose it."
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {installed.map(renderCard)}
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <SectionHeader title="Marketplace" count={available.length} />
        {available.length === 0 ? (
          <div className="panel p-5">
            <EmptyState
              icon={Puzzle}
              title="Everything is installed"
              description="Every plugin in the marketplace is already available to the team."
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {available.map(renderCard)}
          </div>
        )}
      </section>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Plugins run inside the agent's autonomy. A plugin can read what its
        connector grants, but every outbound action still lands in your approval
        inbox first.
      </p>
    </div>
  );
};

export default Plugins;
