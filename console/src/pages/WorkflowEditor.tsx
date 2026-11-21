import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, addEdge,
  useNodesState, useEdgesState, MarkerType, ReactFlowProvider, useReactFlow,
  type Node, type Edge, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Play, Save, Trash2, Loader2, CheckCircle2, XCircle, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  WORKFLOW_NODE_DEFS, type WorkflowNodeType, type WorkflowRunView, type ApiServiceView,
} from "../../../app/shared/workflowContracts";

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

interface NodeConfig {
  cadence?: string; serviceId?: string; operation?: string; url?: string; goal?: string;
  query?: string; method?: string; body?: string; prompt?: string; left?: string;
  operator?: string; right?: string; message?: string;
}
type NodeData = { type: WorkflowNodeType; config: NodeConfig; subtitle?: string; runStatus?: string };
type StudioNodeT = Node<NodeData, "studio">;

const defOf = (t: string) => WORKFLOW_NODE_DEFS.find((d) => d.type === t);
const CAT_COLOR: Record<string, string> = { trigger: "#f59e0b", action: "#6366f1", logic: "#94a3b8" };

function subtitle(type: string, c: NodeConfig): string {
  switch (type) {
    case "trigger.schedule": return c.cadence || "weekly";
    case "action.api_service": return (c.operation || c.method || "call") + (c.url ? " · " + c.url : "");
    case "action.schedule": return (c.cadence || "weekly") + " · " + (c.prompt || "").slice(0, 30);
    case "action.copilot": return (c.prompt || "").slice(0, 40);
    case "action.condition": return `${c.left ?? "?"} ${c.operator || "eq"} ${c.right ?? ""}`;
    case "action.log": return (c.message || "").slice(0, 40);
    default: return "";
  }
}

function StudioNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const def = defOf(data.type) || { label: data.type, category: "logic", outputs: ["out"] };
  const color = CAT_COLOR[def.category] || "#94a3b8";
  const st = data.runStatus;
  return (
    <div className={`rounded-xl border bg-panel px-3 py-2.5 shadow-sm min-w-[180px] ${selected ? "border-primary ring-2 ring-primary/20" : "border-border"} ${st === "success" ? "border-run" : st === "error" ? "border-destructive" : st === "running" ? "border-warn" : ""}`}>
      {def.category !== "trigger" && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-tight">{def.label}</div>
          {data.subtitle && <div className="truncate text-[10px] text-muted-foreground max-w-[150px]">{data.subtitle}</div>}
        </div>
        {st && (
          <span className="ml-auto">
            {st === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-warn" /> : st === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-run" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
          </span>
        )}
      </div>
      {def.outputs.map((o: string, i: number) => (
        <Handle key={o} type="source" position={Position.Right} id={o}
          style={def.outputs.length > 1 ? { top: i === 0 ? "30%" : "70%" } : undefined} />
      ))}
    </div>
  );
}
const nodeTypes = { studio: StudioNode } as unknown as NodeTypes;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12px]";

function ConfigPanel({ node, services, onChange, onDelete }: {
  node: StudioNodeT; services: ApiServiceView[]; onChange: (c: NodeConfig) => void; onDelete: () => void;
}) {
  const def = defOf(node.data.type);
  const c = node.data.config;
  const set = (k: keyof NodeConfig, v: string) => onChange({ ...c, [k]: v });
  const svc = services.find((s) => s.id === c.serviceId);
  return (
    <div className="w-[290px] shrink-0 space-y-3 overflow-y-auto border-l border-border bg-surface-1 p-4">
      <div>
        <h3 className="text-[13px] font-semibold">{def?.label}</h3>
        <p className="text-[11px] text-muted-foreground">{def?.description}</p>
      </div>
      {node.data.type === "trigger.schedule" && (
        <Field label="Cadence">
          <select className={inputCls} value={c.cadence || "weekly"} onChange={(e) => set("cadence", e.target.value)}>
            <option value="daily">daily</option><option value="weekly">weekly</option><option value="once">once</option>
          </select>
        </Field>
      )}
      {node.data.type === "action.api_service" && (
        <>
          <Field label="API service">
            <select className={inputCls} value={c.serviceId || ""} onChange={(e) => set("serviceId", e.target.value)}>
              <option value="">— select —</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.provider})</option>)}
            </select>
          </Field>
          {svc?.provider === "tinyfish" ? (
            <>
              <Field label="Operation">
                <select className={inputCls} value={c.operation || "agent"} onChange={(e) => set("operation", e.target.value)}>
                  <option value="agent">agent (url + goal)</option><option value="fetch">fetch</option><option value="search">search</option>
                </select>
              </Field>
              <Field label="Target URL"><input className={inputCls} value={c.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Goal / query"><textarea className={inputCls + " h-16 py-1.5"} value={c.goal || c.query || ""} onChange={(e) => { set("goal", e.target.value); set("query", e.target.value); }} /></Field>
            </>
          ) : (
            <>
              <Field label="Method">
                <select className={inputCls} value={c.method || "GET"} onChange={(e) => set("method", e.target.value)}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="URL (or /path joined to base)"><input className={inputCls} value={c.url || ""} onChange={(e) => set("url", e.target.value)} /></Field>
              <Field label="Body (JSON)"><textarea className={inputCls + " h-16 py-1.5 font-mono"} value={c.body || ""} onChange={(e) => set("body", e.target.value)} /></Field>
            </>
          )}
        </>
      )}
      {node.data.type === "action.schedule" && (
        <>
          <Field label="Cadence">
            <select className={inputCls} value={c.cadence || "weekly"} onChange={(e) => set("cadence", e.target.value)}>
              <option value="daily">daily</option><option value="weekly">weekly</option><option value="once">once</option>
            </select>
          </Field>
          <Field label="Research prompt"><textarea className={inputCls + " h-20 py-1.5"} value={c.prompt || ""} onChange={(e) => set("prompt", e.target.value)} placeholder="What each run should produce…" /></Field>
        </>
      )}
      {node.data.type === "action.copilot" && (
        <Field label="Prompt"><textarea className={inputCls + " h-24 py-1.5"} value={c.prompt || ""} onChange={(e) => set("prompt", e.target.value)} placeholder="Analyze {{input}} and…" /></Field>
      )}
      {node.data.type === "action.condition" && (
        <>
          <Field label="Value"><input className={inputCls} value={c.left || ""} onChange={(e) => set("left", e.target.value)} placeholder="{{input.price}}" /></Field>
          <Field label="Operator">
            <select className={inputCls} value={c.operator || "eq"} onChange={(e) => set("operator", e.target.value)}>
              {["eq", "neq", "gt", "gte", "lt", "lte", "contains", "truthy", "empty"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Compared to"><input className={inputCls} value={c.right || ""} onChange={(e) => set("right", e.target.value)} /></Field>
        </>
      )}
      {node.data.type === "action.log" && (
        <Field label="Message"><textarea className={inputCls + " h-16 py-1.5"} value={c.message || ""} onChange={(e) => set("message", e.target.value)} placeholder="Fetched {{input}} at {{now}}" /></Field>
      )}
      <Button variant="outline" size="sm" className="gap-1 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete node</Button>
    </div>
  );
}

function EditorInner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNodeT>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [services, setServices] = useState<ApiServiceView[]>([]);
  const [run, setRun] = useState<WorkflowRunView | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { api("/app-api/services").then((j) => setServices(j.services ?? [])).catch(() => {}); }, []);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = useCallback(async () => {
    if (!id) return;
    const j = await api(`/app-api/workflows/${id}`);
    const wf = j.workflow;
    if (initRef.current === wf.id) return;
    initRef.current = wf.id;
    setName(wf.name);
    setNodes(wf.nodes.map((n: { id: string; type: WorkflowNodeType; position: { x: number; y: number }; config?: NodeConfig }) => ({
      id: n.id, type: "studio" as const, position: n.position,
      data: { type: n.type, config: n.config || {}, subtitle: subtitle(n.type, n.config || {}) },
    })));
    setEdges(wf.edges.map((e: { id: string; source: string; target: string; sourceHandle?: string }) => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed }, label: e.sourceHandle && e.sourceHandle !== "out" ? e.sourceHandle : undefined,
    })));
    if (j.runs?.[0]) setRun(j.runs[0]);
    setDirty(false);
  }, [id, setNodes, setEdges]);

  useEffect(() => { void load().catch((e) => toast.error(e.message)); }, [load]);

  const applyRun = (r: WorkflowRunView) => {
    const by: Record<string, string> = {};
    for (const nr of r.nodeResults || []) by[nr.nodeId] = nr.status;
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, runStatus: by[n.id] } })));
  };

  const save = async () => {
    const payload = {
      name,
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.type, position: n.position, config: n.data.config })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}) })),
    };
    await api(`/app-api/workflows/${id}`, "PUT", payload);
    setDirty(false);
    toast.success("Saved");
  };

  const startRun = async () => {
    try {
      if (dirty) await save();
      const j = await api(`/app-api/workflows/${id}/run`, "POST", {});
      setRun(j.run); setDrawer(true); applyRun(j.run);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const r = (await api(`/app-api/workflow-runs/${j.run.id}`)).run as WorkflowRunView;
          setRun(r); applyRun(r);
          if (r.status !== "running" && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } catch { /* keep polling */ }
      }, 1000);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Run failed"); }
  };

  const addNode = (type: WorkflowNodeType, position?: { x: number; y: number }) => {
    const pos = position || rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const nid = "n" + Date.now().toString(36);
    setNodes((ns) => [...ns, { id: nid, type: "studio", position: pos, data: { type, config: {}, subtitle: "" }, selected: true }]);
    setSelected(nid); setDirty(true);
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const updateConfig = (config: NodeConfig) => {
    setNodes((ns) => ns.map((n) => n.id === selected ? { ...n, data: { ...n.data, config, subtitle: subtitle(n.data.type, config) } } : n));
    setDirty(true);
  };
  const deleteSelected = () => {
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null); setDirty(true);
  };

  const groups = ["trigger", "action", "logic"] as const;
  const changes = (ch: unknown) => (Array.isArray(ch) ? ch : []) as { type: string; dragging?: boolean }[];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-surface-1 px-4 py-2.5">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate("/workflows")}><ArrowLeft className="h-4 w-4" /></Button>
        <input className="h-7 w-64 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-semibold hover:border-border focus:border-border" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        {dirty && <span className="rounded-full border border-warn/30 bg-warn/10 px-2 py-px text-[10px] text-warn">unsaved</span>}
        {run && <span className={`rounded-full px-2 py-px text-[10px] ${run.status === "success" ? "bg-run/10 text-run" : run.status === "error" ? "bg-destructive/10 text-destructive" : "bg-warn/10 text-warn"}`}>{run.status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDrawer((d) => !d)}><ScrollText className="h-3.5 w-3.5" /> Runs</Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => save().catch((e) => toast.error(e.message))}><Save className="h-3.5 w-3.5" /> Save</Button>
          <Button size="sm" className="h-7 gap-1 px-2 text-[11px]" disabled={run?.status === "running"} onClick={startRun}>
            {run?.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-surface-1 p-3">
          <p className="mb-2 text-[10.5px] text-muted-foreground">Drag onto the canvas, or click to add.</p>
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g === "trigger" ? "Triggers" : g === "action" ? "Actions" : "Logic"}</div>
              {WORKFLOW_NODE_DEFS.filter((d) => d.category === g).map((d) => (
                <button key={d.type} draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/ri-node", d.type); e.dataTransfer.effectAllowed = "move"; }}
                  onClick={() => addNode(d.type)}
                  className="mb-1 flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[11.5px] hover:border-border hover:bg-surface-2"
                  title={d.description}>
                  <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[g] }} />
                  {d.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={(ch) => { onNodesChange(ch); if (changes(ch).some((c) => c.type !== "select" && c.type !== "dimensions" && !(c.type === "position" && !c.dragging))) setDirty(true); }}
            onEdgesChange={(ch) => { onEdgesChange(ch); if (changes(ch).some((c) => c.type !== "select")) setDirty(true); }}
            onConnect={(p) => { setEdges((es) => addEdge({ ...p, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, label: p.sourceHandle && p.sourceHandle !== "out" ? p.sourceHandle : undefined }, es)); setDirty(true); }}
            onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
            onDrop={(e) => { e.preventDefault(); const t = e.dataTransfer.getData("application/ri-node") as WorkflowNodeType; if (t) addNode(t, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            fitView deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }} minZoom={0.2} maxZoom={1.6}
          >
            <Background gap={20} size={1} />
            <Controls position="bottom-left" />
            <MiniMap position="top-right" pannable zoomable bgColor="transparent" />
          </ReactFlow>
        </div>

        {selectedNode && <ConfigPanel node={selectedNode} services={services} onChange={updateConfig} onDelete={deleteSelected} />}
      </div>

      {drawer && (
        <div className="max-h-[240px] overflow-y-auto border-t border-border bg-surface-1 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <strong>Run history</strong>
            {run && <span className="text-muted-foreground">{run.trigger} · {new Date(run.startedAt).toLocaleString()}</span>}
            {run?.error && <span className="text-destructive">{run.error}</span>}
          </div>
          {run ? (run.nodeResults || []).map((nr) => (
            <div key={nr.nodeId} className="flex items-start gap-2 border-b border-border/60 py-1.5 text-[11.5px]">
              {nr.status === "success" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-run" /> : nr.status === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-warn" />}
              <div className="min-w-0 flex-1">
                <div><strong>{defOf(nr.type)?.label || nr.type}</strong> <span className="text-muted-foreground">{nr.nodeId}</span></div>
                {nr.error && <div className="text-destructive">{nr.error}</div>}
                {nr.output != null && <pre className="mt-1 max-h-28 overflow-auto rounded bg-surface-2 p-1.5 text-[10.5px] whitespace-pre-wrap">{JSON.stringify(nr.output, null, 2).slice(0, 1500)}</pre>}
              </div>
            </div>
          )) : <p className="text-[11.5px] text-muted-foreground">No run yet — press Run.</p>}
        </div>
      )}
    </div>
  );
}

export default function WorkflowEditor() {
  return <ReactFlowProvider><EditorInner /></ReactFlowProvider>;
}
