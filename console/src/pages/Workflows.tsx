import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Workflow as WorkflowIcon, Play, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionHeader, EmptyState } from "@/components/common";
import { WORKFLOW_NODE_DEFS, type WorkflowView, type WorkflowNode } from "../../../app/shared/workflowContracts";

const api = async (path: string, method = "GET", body?: unknown) => {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || json.error || res.statusText);
  return json;
};

export default function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const j = await api("/app-api/workflows");
      setWorkflows(j.workflows ?? []);
    } catch (e) {
      toast.error("Couldn't load workflows: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      const j = await api("/app-api/workflows", "POST", {
        name: "New workflow",
        nodes: [{ id: "n1", type: "trigger.manual", position: { x: 80, y: 160 }, config: {} }],
        edges: [],
      });
      navigate(`/workflows/${j.workflow.id}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Create failed"); }
  };

  const run = async (w: WorkflowView) => {
    try {
      await api(`/app-api/workflows/${w.id}/run`, "POST", {});
      toast.success("Started " + w.name);
      navigate(`/workflows/${w.id}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Run failed"); }
  };

  const remove = async (w: WorkflowView) => {
    try {
      await api(`/app-api/workflows/${w.id}`, "DELETE");
      toast.success("Deleted " + w.name);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Workflows"
        description="Visual automations: wire schedule triggers, outside-API calls (TinyFish / REST), copilot steps and conditions on a canvas. The copilot can build these for you."
        actions={<Button size="sm" className="gap-1" onClick={create}><Plus className="h-4 w-4" /> New workflow</Button>}
      />
      {loading ? (
        <p className="text-[12px] text-muted-foreground">Loading…</p>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Create one visually, or ask the copilot: 'build a workflow that fetches competitor pricing with TinyFish every week'."
          action={<Button size="sm" className="gap-1" onClick={create}><Plus className="h-4 w-4" /> Create workflow</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((w) => (
            <article key={w.id} className="panel flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
                <button className="text-[13px] font-semibold hover:underline" onClick={() => navigate(`/workflows/${w.id}`)}>{w.name}</button>
                <span className="ml-auto rounded-full border border-border bg-surface-2 px-1.5 py-px text-[10px] text-muted-foreground">{w.nodes.length} nodes</span>
              </div>
              <p className="min-h-[28px] text-[11.5px] text-muted-foreground">{w.description || "No description."}</p>
              <div className="flex flex-wrap gap-1">
                {w.nodes.slice(0, 8).map((n: WorkflowNode) => {
                  const d = WORKFLOW_NODE_DEFS.find((x) => x.type === n.type);
                  return <span key={n.id} className="rounded border border-border bg-surface-2 px-1.5 py-px text-[9.5px] text-muted-foreground">{d?.label || n.type}</span>;
                })}
              </div>
              <div className="mt-auto flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => navigate(`/workflows/${w.id}`)}><Pencil className="h-3.5 w-3.5" /> Open</Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => run(w)}><Play className="h-3.5 w-3.5" /> Run</Button>
                <button className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-destructive" title="Delete" onClick={() => remove(w)}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
