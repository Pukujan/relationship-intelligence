import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Pause, Play, Sparkles, Trash2 } from "lucide-react";
import { useData } from "@/data/store";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { PageHeader, SectionHeader, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";

interface Schedule {
  id: string;
  cadence: string;
  scope_kind: string;
  scope_id: string | null;
  prompt: string;
  paused: boolean;
  next_run_at: string;
}
interface Run {
  id: string;
  schedule_id: string;
  status: string;
  due_at: string;
}

/**
 * Schedules are agreed in conversation, not configured on this page. The seed
 * opens a copilot thread that plans the brief, cadence, and scope with the
 * human; the schedule itself is only proposed there, and only created after
 * the human explicitly confirms it (see SessionActions).
 */
const planSeed = (idea: string) =>
  `I want to plan a scheduled research job${idea.trim() ? `: ${idea.trim()}` : ""}. ` +
  "Talk it through with me first — what each run should produce, how often it should run, " +
  "and whether it covers the whole workspace, one project, or one person. " +
  "Ask me about anything I haven't decided; don't assume defaults. " +
  "Only propose the schedule once we agree, and wait for my confirmation before it's created.";

const Schedules = () => {
  const { session, world } = useData();
  const { openCopilot } = useOrchestrator();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [idea, setIdea] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch(`/app-api/schedules?workspaceId=${encodeURIComponent(session.workspaceId)}`, { credentials: "same-origin" });
    if (!r.ok) return;
    const body = (await r.json()) as { schedules?: Schedule[]; runs?: Run[] };
    setSchedules(body.schedules ?? []);
    setRuns(body.runs ?? []);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (id: string, paused: boolean) => {
    await fetch(`/app-api/schedules/${id}?workspaceId=${encodeURIComponent(session?.workspaceId ?? "")}`, {
      method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    });
    void load();
  };

  const remove = async (id: string) => {
    await fetch(`/app-api/schedules/${id}?workspaceId=${encodeURIComponent(session?.workspaceId ?? "")}`, { method: "DELETE", credentials: "same-origin" });
    void load();
  };

  // Starting points grounded in the actual workspace — each opens a planning
  // conversation, never a pre-decided schedule.
  const suggestions = [
    ...(world?.projects ?? []).slice(0, 3).map((project) => ({
      label: `Recurring brief on ${project.name}`,
      idea: `Keep a recurring brief on the ${project.name} project — what moved, what's stuck, and what needs me.`,
    })),
    ...(world?.people ?? []).slice(0, 2).map((person) => ({
      label: `Watch ${person.name}`,
      idea: `Track ${person.name} on a cadence — role or company changes, and anything worth a timely touchpoint.`,
    })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cadence"
        title="Scheduled research"
        description="Recurring research jobs scoped to a project, person, or the whole workspace. Plan them with the copilot — nothing is scheduled until you agree. Due runs queue here; the research worker executes them in the next slice."
      />
      <section className="panel p-4">
        <SectionHeader title="Plan with the copilot" />
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Describe the research you want repeated. The copilot talks through the brief, cadence, and scope
          with you, then proposes the schedule for your confirmation — no defaults decided for you.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            placeholder="What should the research track, for whom, and what should a good run produce? Start here and the copilot will ask about the rest."
            aria-label="Schedule idea"
            className="min-h-10 min-w-64 flex-1 resize-none rounded-lg border border-border/70 bg-surface-1 px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <Button size="sm" className="h-9 gap-1.5 rounded-lg" onClick={() => openCopilot(planSeed(idea))}>
            <Sparkles className="h-3.5 w-3.5" /> Plan with copilot
          </Button>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => openCopilot(planSeed(suggestion.idea))}
                className="focus-ring rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel p-4">
        <SectionHeader title="Schedules" count={schedules.length} />
        {schedules.length === 0 ? (
          <EmptyState className="mt-3" icon={CalendarClock} title="No scheduled research" description="Plan one with the copilot above; agreed schedules appear here and due runs queue below." />
        ) : (
          <div className="mt-2 divide-y divide-border/60">
            {schedules.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{s.prompt}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {s.cadence} · {s.scope_kind}{s.scope_id ? `:${s.scope_id.slice(0, 8)}` : ""} · next {new Date(s.next_run_at).toLocaleString()}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${s.paused ? "border-border/70 text-muted-foreground" : "border-run/30 bg-run/10 text-run"}`}>
                  {s.paused ? "paused" : "active"}
                </span>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={s.paused ? "Resume" : "Pause"} onClick={() => void patch(s.id, !s.paused)}>
                  {s.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" aria-label="Delete" onClick={() => void remove(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel p-4">
        <SectionHeader title="Run queue" count={runs.length} />
        {runs.length === 0 ? (
          <p className="mt-2 text-[11.5px] text-muted-foreground">Nothing queued yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-border/60">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-2 text-[11.5px]">
                <span className="num text-muted-foreground">{new Date(r.due_at).toLocaleString()}</span>
                <span className="flex-1 truncate text-muted-foreground">{r.schedule_id.slice(0, 8)}</span>
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Schedules;
