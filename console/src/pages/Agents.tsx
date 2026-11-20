import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Check,
  Lock,
  Megaphone,
  Microscope,
  Plus,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentStats, missionsForAgent, relativeTime } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { AgentCard } from "@/components/AgentCard";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import type { AgentIcon } from "@/data/types";

interface AgentTemplateItem {
  id: string;
  name: string;
  role: string;
  cadence: "daily" | "pre_event" | "signal";
  autonomyZone: "prep" | "suggest" | "co_design";
  connectors: string[];
  description: string;
  instructions: string;
}

interface DraftPlanItem {
  id: string;
  title: string;
  objectiveName: string;
  missionSummary: string;
  status: "draft" | "locked";
  horizon: string;
  steps: { id: string; label: string; detail?: string }[];
  lockedAt?: string;
}

const domains: {
  id: AgentIcon;
  label: string;
  icon: typeof Megaphone;
  description: string;
}[] = [
  {
    id: "sales",
    label: "Sales",
    icon: Megaphone,
    description: "Revenue relationships — follow-ups, intros, renewals.",
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Sparkles,
    description: "Narrative, publishing, and distribution.",
  },
  {
    id: "research",
    label: "Research",
    icon: Microscope,
    description: "Market and person research, evidence first.",
  },
];

const Agents = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const [searchParams, setSearchParams] = useSearchParams();
  const domainParam = searchParams.get("domain");
  const domain = domains.find((item) => item.id === domainParam);

  const [templates, setTemplates] = useState<AgentTemplateItem[]>([]);
  const [draftPlans, setDraftPlans] = useState<DraftPlanItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [customCadence, setCustomCadence] = useState<"daily" | "pre_event" | "signal">("daily");
  const [customZone, setCustomZone] = useState<"prep" | "suggest" | "co_design">("suggest");
  const [customInstructions, setCustomInstructions] = useState("");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftObjective, setDraftObjective] = useState("");
  const [draftStepsText, setDraftStepsText] = useState("");

  const loadWorkspaceExtras = useCallback(async () => {
    try {
      const [tplRes, planRes] = await Promise.all([
        fetch("/app-api/agent-templates", { credentials: "same-origin" }),
        fetch("/app-api/draft-plans", { credentials: "same-origin" }),
      ]);
      if (tplRes.ok) {
        const data = (await tplRes.json()) as { templates?: AgentTemplateItem[] };
        setTemplates(data.templates ?? []);
      }
      if (planRes.ok) {
        const data = (await planRes.json()) as { draftPlans?: DraftPlanItem[] };
        setDraftPlans(data.draftPlans ?? []);
      }
    } catch {
      // Offline / demo fallback
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceExtras();
  }, [loadWorkspaceExtras]);

  if (status === "loading") return <PageSkeleton rows={3} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Agents didn't load"
        description={error ?? "Something went wrong reading the agent roster."}
        onRetry={reload}
      />
    );
  }

  const installTemplate = async (tpl: AgentTemplateItem) => {
    setBusyId(tpl.id);
    try {
      const r = await fetch("/app-api/agents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          role: tpl.role,
          cadence: tpl.cadence,
          autonomyZone: tpl.autonomyZone,
          connectors: tpl.connectors,
          instructions: tpl.instructions,
          templateId: tpl.id,
        }),
      });
      if (!r.ok) throw new Error("Failed to install agent template");
      toast.success(`${tpl.name} added to workspace`, {
        description: `Cadence: ${tpl.cadence} · Autonomy: ${tpl.autonomyZone}`,
      });
      void reload();
    } catch (cause) {
      toast.error("Could not install template", {
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const createCustom = async () => {
    if (!customName.trim() || !customRole.trim() || !customInstructions.trim()) return;
    setBusyId("custom-agent");
    try {
      const r = await fetch("/app-api/agents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          role: customRole.trim(),
          cadence: customCadence,
          autonomyZone: customZone,
          instructions: customInstructions.trim(),
          connectors: ["gmail", "gcal"],
        }),
      });
      if (!r.ok) throw new Error("Failed to create custom agent");
      toast.success(`${customName.trim()} created`);
      setCustomName("");
      setCustomRole("");
      setCustomInstructions("");
      setShowBuilder(false);
      void reload();
    } catch (cause) {
      toast.error("Could not create agent", {
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const saveDraftPlan = async () => {
    const steps = draftStepsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label, detail: "", agentId: "research" }));
    if (!draftTitle.trim() || !draftObjective.trim() || steps.length === 0) return;
    setBusyId("draft-create");
    try {
      const r = await fetch("/app-api/draft-plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim(),
          objectiveName: draftObjective.trim(),
          steps,
        }),
      });
      if (!r.ok) throw new Error("Failed to create draft plan");
      toast.success("Draft plan staged", {
        description: "Iterate freely — nothing runs until you click Lock plan.",
      });
      setDraftTitle("");
      setDraftObjective("");
      setDraftStepsText("");
      await loadWorkspaceExtras();
    } catch (cause) {
      toast.error("Could not stage draft plan", {
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const lockPlan = async (planId: string, title: string) => {
    setBusyId(`lock:${planId}`);
    try {
      const r = await fetch(`/app-api/draft-plans/${encodeURIComponent(planId)}/lock`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error("Failed to lock plan");
      toast.success(`Locked: ${title}`, {
        description: "Materialized Objective + Mission in your workspace.",
      });
      await loadWorkspaceExtras();
      void reload();
    } catch (cause) {
      toast.error("Could not lock plan", {
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const visibleDomains = domain ? [domain] : domains;
  const openWork = world.tasks.filter((task) => task.status !== "done").length;
  const pending = world.approvals.filter(
    (approval) => approval.status === "pending",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agents & Co-Design"
        title="Your agent team"
        description="Install starter templates, build custom workspace agents with clear cadences, and co-design Draft Plans that only execute once you Lock them."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => setShowBuilder((v) => !v)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {showBuilder ? "Close builder" : "Build custom agent"}
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() =>
                openCopilot("Add an ops agent that keeps vendor relationships warm")
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Design in chat
            </Button>
          </div>
        }
      />

      {showBuilder ? (
        <section className="panel space-y-3 p-4">
          <p className="text-[13px] font-semibold">Build a custom workspace agent</p>
          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Agent name (e.g. Grant Scout)"
              className="h-8 rounded-md border border-border bg-surface-1 px-2.5 text-[11.5px]"
            />
            <input
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              placeholder="Role (e.g. Track NYC DOT grants)"
              className="h-8 rounded-md border border-border bg-surface-1 px-2.5 text-[11.5px]"
            />
            <select
              value={customCadence}
              onChange={(e) => setCustomCadence(e.target.value as "daily" | "pre_event" | "signal")}
              className="h-8 rounded-md border border-border bg-surface-1 px-2 text-[11.5px]"
            >
              <option value="daily">Cadence: Per-day</option>
              <option value="pre_event">Cadence: Per-event (T-7d/24h)</option>
              <option value="signal">Cadence: Continuous signal</option>
            </select>
            <select
              value={customZone}
              onChange={(e) => setCustomZone(e.target.value as "prep" | "suggest" | "co_design")}
              className="h-8 rounded-md border border-border bg-surface-1 px-2 text-[11.5px]"
            >
              <option value="prep">Zone 1: Sense & Prep (read-only)</option>
              <option value="suggest">Zone 2: Suggest (Approvals)</option>
              <option value="co_design">Zone 3: Co-Design Draft Plans</option>
            </select>
          </div>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={2}
            placeholder="Plain-language instructions: what should this agent watch, summarize, or propose?"
            className="w-full rounded-md border border-border bg-surface-1 p-2.5 text-[11.5px]"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-8 text-[11.5px]"
              disabled={busyId === "custom-agent" || !customName.trim() || !customRole.trim() || !customInstructions.trim()}
              onClick={() => void createCustom()}
            >
              Create agent
            </Button>
          </div>
        </section>
      ) : null}

      {templates.length > 0 ? (
        <section className="space-y-2.5">
          <SectionHeader title="Starter agent templates" count={templates.length} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {templates.map((tpl) => (
              <article key={tpl.id} className="panel flex flex-col gap-2.5 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-semibold">{tpl.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">{tpl.role}</p>
                  </div>
                  <Pill className="border-primary/30 bg-primary/10 text-primary">{tpl.cadence}</Pill>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {tpl.description}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {tpl.connectors.join(", ")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={busyId === tpl.id}
                    onClick={() => void installTemplate(tpl)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Install
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold">Co-Design Draft Plans → Lock</p>
            <p className="text-[11px] text-muted-foreground">
              Stage multi-step plans with your agents here. Nothing creates missions or tasks until you explicitly click Lock plan.
            </p>
          </div>
          <Pill className="border-border bg-surface-2 text-muted-foreground">
            {draftPlans.filter((p) => p.status === "draft").length} draft
          </Pill>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Plan title (e.g. MTA $2M SMART Grant Pilot Follow-Up)"
            className="h-8 rounded-md border border-border bg-surface-1 px-2.5 text-[11.5px]"
          />
          <input
            value={draftObjective}
            onChange={(e) => setDraftObjective(e.target.value)}
            placeholder="North Star Objective (e.g. Book NaviLens demo with MTA)"
            className="h-8 rounded-md border border-border bg-surface-1 px-2.5 text-[11.5px]"
          />
        </div>
        <textarea
          value={draftStepsText}
          onChange={(e) => setDraftStepsText(e.target.value)}
          rows={2}
          placeholder="Steps (one per line, e.g. Pull SMART Grant brief from Drive / Draft intro email via Jenny)"
          className="w-full rounded-md border border-border bg-surface-1 p-2.5 text-[11.5px]"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7.5 text-[11px]"
            disabled={busyId === "draft-create" || !draftTitle.trim() || !draftObjective.trim() || !draftStepsText.trim()}
            onClick={() => void saveDraftPlan()}
          >
            Stage Draft Plan
          </Button>
        </div>

        {draftPlans.length > 0 ? (
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {draftPlans.map((plan) => (
              <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[11.5px]">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{plan.title}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    Goal: {plan.objectiveName} · {plan.steps.length} step(s)
                  </p>
                </div>
                {plan.status === "locked" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-run">
                    <Check className="h-3.5 w-3.5" />
                    Locked
                  </span>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-[11px]"
                    disabled={busyId === `lock:${plan.id}`}
                    onClick={() => void lockPlan(plan.id, plan.title)}
                  >
                    <Lock className="h-3 w-3" />
                    Lock plan
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSearchParams({}, { replace: true })}
          className={cn(
            "focus-ring rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            !domain
              ? "border-border bg-surface-2 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          All specializations
          <span className="num ml-1 text-[10px] text-muted-foreground">
            {world.agents.length}
          </span>
        </button>
        {domains.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSearchParams({ domain: item.id }, { replace: true })}
            className={cn(
              "focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              domainParam === item.id
                ? "border-border bg-surface-2 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="h-3 w-3" />
            {item.label}
            <span className="num text-[10px] text-muted-foreground">
              {world.agents.filter((agent) => agent.icon === item.id).length}
            </span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            <span className="num text-foreground">{openWork}</span> open tasks
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="num text-warn">{pending}</span> waiting on you
          </span>
        </span>
      </div>

      {visibleDomains.map((item) => {
        const agents = world.agents.filter((agent) => agent.icon === item.id);
        return (
          <section key={item.id} className="space-y-3">
            <SectionHeader
              title={item.label}
              count={agents.length}
              action={
                <span className="text-[11px] text-muted-foreground">
                  {item.description}
                </span>
              }
            />
            {agents.length === 0 ? (
              <div className="panel p-5">
                <EmptyState
                  icon={Bot}
                  title={`No ${item.label.toLowerCase()} agent yet`}
                  description="Install a template above or build a custom agent. Nothing sends externally without your approval."
                  action={
                    <Button
                      size="sm"
                      className="rounded-lg"
                      onClick={() => setShowBuilder(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Build one
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} world={world} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section className="space-y-3">
        <SectionHeader title="Assigned missions" count={world.missions.length} />
        <div className="grid gap-2 lg:grid-cols-2">
          {world.agents.map((agent) => {
            const missions = missionsForAgent(world, agent.id);
            const stats = agentStats(world, agent.id);
            return (
              <div key={agent.id} className="panel p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/agents/${agent.id}`}
                    className="focus-ring inline-flex items-center gap-1.5 rounded text-[12.5px] font-medium transition-colors hover:text-primary"
                  >
                    {agent.name}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <span className="num text-[10.5px] text-muted-foreground">
                    {stats.successRate}% success · {stats.pending} waiting
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {missions.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No missions assigned right now.
                    </p>
                  ) : (
                    missions.map((mission) => (
                      <Link
                        key={mission.id}
                        to={`/missions/${mission.id}`}
                        className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            mission.status === "running" && "bg-run",
                            mission.status === "blocked" && "bg-warn",
                            mission.status === "queued" && "bg-idle",
                            mission.status === "done" && "bg-primary",
                          )}
                        />
                        <span className="flex-1 truncate">{mission.name}</span>
                        <span className="num text-[10px]">
                          {relativeTime(mission.due)}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default Agents;
