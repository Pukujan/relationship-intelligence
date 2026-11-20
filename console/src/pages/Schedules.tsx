import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useData } from "@/data/store";
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

const Schedules = () => {
  const { session, world } = useData();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [scope, setScope] = useState("workspace:");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch(`/app-api/schedules?workspaceId=${encodeURIComponent(session.workspaceId)}`, { credentials: "same-origin" });
    if (!r.ok) return;
    const body = (await r.json()) as { schedules?: Schedule[]; runs?: Run[] };
    setSchedules(body.schedules ?? []);
    setRuns(body.runs ?? []);
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!prompt.trim() || !session) return;
    setBusy(true);
    const [kind, id] = scope.split(":");
    const r = await fetch("/app-api/schedules", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: session.workspaceId, prompt, cadence, scopeKind: kind, scopeId: id || null }),
    });
    setBusy(false);
    if (r.ok) { setPrompt(""); toast.success("Schedule created", { description: "Due runs are queued; execution lands with the research slice." }); void load(); }
    else toast.error("Could not create schedule");
  };

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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cadence"
        title="Scheduled research"
        description="Recurring research jobs scoped to a project, person, or the whole workspace. Due runs queue here; the research worker executes them in the next slice."
      />
      <section className="panel p-4">
        <SectionHeader title="New schedule" />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="e.g. Refresh attendee briefs for the Halcyon renewal dinner"
            aria-label="Schedule prompt"
            className="min-h-10 min-w-64 flex-1 resize-none rounded-lg border border-border/70 bg-surface-1 px-2.5 py-2 text-[13px] outline-none"
          />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} aria-label="Cadence" className="h-9 rounded-md border border-border/70 bg-surface-1 px-2 text-[12px]">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="once">once</option>
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope" className="h-9 max-w-56 rounded-md border border-border/70 bg-surface-1 px-2 text-[12px]">
            <option value="workspace:">whole workspace</option>
            {(world?.projects ?? []).map((p) => <option key={p.id} value={`project:${p.id}`}>project: {p.name}</option>)}
            {(world?.people ?? []).slice(0, 12).map((p) => <option key={p.id} value={`person:${p.id}`}>person: {p.name}</option>)}
          </select>
          <Button size="sm" className="h-9 gap-1.5 rounded-lg" disabled={busy || !prompt.trim()} onClick={() => void create()}>
            <Plus className="h-3.5 w-3.5" /> Create
          </Button>
        </div>
      </section>

      <section className="panel p-4">
        <SectionHeader title="Schedules" count={schedules.length} />
        {schedules.length === 0 ? (
          <EmptyState className="mt-3" icon={CalendarClock} title="No scheduled research" description="Create one above; due runs appear in the queue below." />
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
