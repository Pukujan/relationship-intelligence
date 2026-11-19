import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { agentById } from "@/data/derive";
import { designAsProposal } from "@/lib/intelligence";
import { sanitizeMermaidSource, type Part } from "@/data/sessionTypes";
import type { MissionDesign } from "@/data/types";
import { Sparkline } from "@/components/Sparkline";
import { SessionActions } from "./SessionActions";
import type { CopilotAction } from "@/lib/actions";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";

const EvidenceChips = ({ evidence }: { evidence?: { label: string; detail: string }[] }) =>
  evidence?.length ? (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {evidence.map((item) => (
        <span
          key={`${item.label}-${item.detail}`}
          title={item.detail}
          className="rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {item.label}
        </span>
      ))}
    </div>
  ) : null;

const GraphSnippet = ({ part }: { part: Extract<Part, { kind: "graph" }> }) => {
  const radius = 70;
  const center = 90;
  const positions = part.nodes.map((node, index) => {
    const angle = (index / Math.max(1, part.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...node, x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  });
  const at = (id: string) => positions.find((node) => node.id === id);
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44" role="img" aria-label="Relationship snippet">
      {part.edges.map((edge, index) => {
        const from = at(edge.from);
        const to = at(edge.to);
        if (!from || !to) return null;
        return (
          <g key={index}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--color-border, #334)" strokeWidth={1} />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 3} fontSize={7} fill="#8fa0ab" textAnchor="middle">
              {edge.label}
            </text>
          </g>
        );
      })}
      {positions.map((node) => (
        <g key={node.id}>
          <circle cx={node.x} cy={node.y} r={10} fill={node.kind === "company" ? "#1f2a33" : "#2a2030"} stroke="#4b5a66" />
          <text x={node.x} y={node.y + 20} fontSize={8} fill="#cfd8de" textAnchor="middle">
            {node.label.slice(0, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
};

const Artifact = ({ part }: { part: Extract<Part, { kind: "artifact" }> }) => (
  <div className="rounded-xl border border-border/70 bg-surface-1/60 p-2">
    <p className="eyebrow mb-1.5 px-1">{part.title} · sandboxed artifact</p>
    <iframe
      title={part.title}
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:;"><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e6e8eb;background:#0b0d10;margin:12px}table{border-collapse:collapse}td,th{border:1px solid #232a31;padding:4px 8px}h1,h2,h3{font-size:15px}</style></head><body>${part.html}</body></html>`}
      className="h-64 w-full rounded-lg border border-border/60 bg-background"
    />
    <EvidenceChips evidence={part.sources} />
  </div>
);

/**
 * Model-suggested image. Trust rules: https only (re-checked here even though
 * the contract validates it — stored parts may predate validation), lazy
 * loading, and no referrer so the third-party host never learns the console
 * URL or who is looking. Sources render as chips; an unsourced image is still
 * just a picture, never a canonical claim.
 */
const ImagePart = ({ part }: { part: Extract<Part, { kind: "image" }> }) => {
  let safe = false;
  try {
    safe = new URL(part.url).protocol === "https:";
  } catch {
    safe = false;
  }
  if (!safe) {
    return (
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-warn" />
        Image blocked — only https sources render.
      </p>
    );
  }
  return (
    <figure className="inline-flex max-w-full flex-col rounded-lg border border-border/70 bg-surface-1 p-2">
      <img
        src={part.url}
        alt={part.alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-80 max-w-full rounded-md border border-border/60 object-contain"
      />
      {part.caption ? (
        <figcaption className="mt-1.5 px-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {part.caption}
        </figcaption>
      ) : null}
      <EvidenceChips evidence={part.sources} />
    </figure>
  );
};

/**
 * Mermaid diagram from model output. The source is sanitized (backticks and
 * script sequences stripped) and rendered inside an opaque-origin sandbox:
 * sandbox="allow-scripts" with NO allow-same-origin, plus a CSP that only
 * admits the mermaid CDN. The diagram can run JS but can never read console
 * storage, cookies, or the parent DOM.
 */
const MermaidPart = ({ part }: { part: Extract<Part, { kind: "mermaid" }> }) => {
  const source = sanitizeMermaidSource(part.source);
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src https://cdn.jsdelivr.net data:;"><style>body{margin:8px;background:#0b0d10;color:#e6e8eb;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}#out{overflow-x:auto}</style></head><body><div id="out">Rendering diagram…</div><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" onerror="document.getElementById('out').textContent='Mermaid failed to load — check the network.'"></script><script>try{var src=${JSON.stringify(source)};window.mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'strict'});window.mermaid.render('diagram',src).then(function(r){document.getElementById('out').innerHTML=r.svg;}).catch(function(e){document.getElementById('out').textContent='Diagram failed: '+(e&&e.message?e.message:e);});}catch(e){document.getElementById('out').textContent='Diagram failed: '+(e&&e.message?e.message:e);}</script></body></html>`;
  return (
    <div className="rounded-xl border border-border/70 bg-surface-1/60 p-2">
      <p className="eyebrow mb-1.5 px-1">{part.title} · sandboxed diagram</p>
      <iframe
        title={part.title}
        sandbox="allow-scripts"
        loading="lazy"
        srcDoc={srcDoc}
        className="h-72 w-full rounded-lg border border-border/60 bg-background"
      />
      <EvidenceChips evidence={part.sources} />
    </div>
  );
};

interface TreeNodeData {
  id: string;
  label: string;
  children?: string[];
}

/** Recursive indented tree with expand/collapse; cycles in model data are cut. */
const TreeNode = ({
  node,
  byId,
  depth,
  ancestors,
}: {
  node: TreeNodeData;
  byId: Map<string, TreeNodeData>;
  depth: number;
  ancestors: Set<string>;
}) => {
  const [open, setOpen] = useState(depth === 0);
  const children = (node.children ?? [])
    .map((id) => byId.get(id))
    .filter((child): child is TreeNodeData => Boolean(child) && !ancestors.has(child!.id));
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(node.id);
  return (
    <li>
      {children.length ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="focus-ring flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition-colors hover:bg-surface-2/60"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium">{node.label}</span>
          <span className="num text-[9.5px] text-muted-foreground/70">{children.length}</span>
        </button>
      ) : (
        <span className="flex items-center gap-1.5 px-1 py-1 text-[12px]">
          <span className="h-3 w-3 shrink-0" />
          <span className="text-foreground/85">{node.label}</span>
        </span>
      )}
      {children.length && open ? (
        <ul className="ml-3 space-y-0.5 border-l border-border/60 pl-2">
          {children.map((child) => (
            <TreeNode key={child.id} node={child} byId={byId} depth={depth + 1} ancestors={nextAncestors} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

const TreePart = ({ part }: { part: Extract<Part, { kind: "tree" }> }) => {
  const byId = new Map(part.nodes.map((node) => [node.id, node]));
  const referenced = new Set(part.nodes.flatMap((node) => node.children ?? []));
  // Roots are nodes nobody lists as a child; if the model sent a pure cycle,
  // fall back to the first node so something still renders.
  const roots = part.nodes.filter((node) => !referenced.has(node.id));
  const shown = roots.length ? roots : part.nodes.slice(0, 1);
  return (
    <div className="rounded-lg border border-border/70 bg-surface-1 p-2.5">
      <p className="eyebrow mb-1.5">{part.title}</p>
      <ul className="space-y-0.5">
        {shown.map((node) => (
          <TreeNode key={node.id} node={node} byId={byId} depth={0} ancestors={new Set()} />
        ))}
      </ul>
    </div>
  );
};

const ProposalPart = ({ part }: { part: Extract<Part, { kind: "proposal" }> }) => {
  const { world, addProposal } = useData();
  const [heldId, setHeldId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const design = part.design as MissionDesign;
  const hold = async () => {
    if (!world) return;
    setBusy(true);
    try {
      const approval = await addProposal(designAsProposal(world, design));
      setHeldId(approval.id);
      toast.success("Held for approval", { description: "In your inbox; nothing becomes work until you approve." });
    } catch (error) {
      toast.error("Could not hold the proposal", { description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
      <p className="eyebrow">Proposed mission — held for you</p>
      <p className="mt-1 text-[13px] font-medium">{design.missionName}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{design.missionSummary}</p>
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-border/60 bg-surface-1 px-2.5 py-2">
        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div>
          <p className="text-[12px] font-medium">{design.objectiveName}</p>
          <p className="text-[11px] text-muted-foreground">target: {design.objectiveTarget}</p>
        </div>
      </div>
      <ol className="mt-2 space-y-1">
        {(design.planSteps ?? []).map((step, index) => (
          <li key={index} className="flex gap-2 text-[12px]">
            <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border/70 bg-surface-2 text-[9px] text-muted-foreground">
              {index + 1}
            </span>
            <span>
              {step.label}
              {step.detail ? <span className="ml-1.5 text-[11px] text-muted-foreground">{step.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {(design.unverified ?? []).length ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {design.unverified.join(" · ")}
        </p>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2">
        {heldId ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-run/30 bg-run/10 px-2.5 py-1 text-[11px] font-medium text-run">
              <CheckCircle2 className="h-3.5 w-3.5" /> In your approval inbox
            </span>
            <Link to={`/approvals?focus=${heldId}`} className="text-[11.5px] text-muted-foreground hover:text-foreground hover:underline">
              Open in inbox
            </Link>
          </>
        ) : (
          <Button size="sm" className="h-8 rounded-md px-3 text-[11.5px]" disabled={busy} onClick={() => void hold()}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Hold for approval
          </Button>
        )}
      </div>
      <EvidenceChips evidence={part.evidence} />
    </div>
  );
};

const ApprovalPart = ({ part }: { part: Extract<Part, { kind: "approval" }> }) => {
  const { world, decide } = useData();
  const [busy, setBusy] = useState(false);
  const approval = world?.approvals.find((item) => item.id === part.approvalId);
  if (!approval) return <p className="text-[12px] text-muted-foreground">Approval no longer in the queue.</p>;
  const agent = world ? agentById(world, approval.agentId) : undefined;
  const act = async (decision: "approved" | "declined") => {
    setBusy(true);
    try {
      await decide({ approvalId: approval.id, decision, note: decision === "approved" ? "Approved inline from a research thread." : "Declined inline from a research thread." });
      toast.success(decision === "approved" ? "Approved" : "Declined", { description: "Same queue, same record as the inbox." });
    } catch (error) {
      toast.error("Decision not recorded", { description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface-1 px-2.5 py-2">
      {agent ? <AgentAvatar agent={agent} size="sm" /> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{approval.title}</p>
        <p className="text-[10.5px] text-muted-foreground">{approval.risk} risk · {approval.status}</p>
      </div>
      {approval.status === "pending" ? (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 rounded-md px-2 text-[11px]" disabled={busy} onClick={() => void act("approved")}>Approve</Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-md px-2 text-[11px] text-muted-foreground" disabled={busy} onClick={() => void act("declined")}>Decline</Button>
        </div>
      ) : (
        <span className="text-[10.5px] text-muted-foreground">{approval.status}</span>
      )}
    </div>
  );
};

export const PartRenderer = ({ part }: { part: Part }) => {
  switch (part.kind) {
    case "text":
      return (
        <div>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{part.text}</p>
          <EvidenceChips evidence={part.evidence} />
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-2 text-left text-muted-foreground">
                {part.columns.map((column) => <th key={column} className="px-2 py-1.5 font-medium">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {part.rows.map((row, index) => (
                <tr key={index} className="border-t border-border/60">
                  {row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-2 pb-1.5"><EvidenceChips evidence={part.evidence} /></div>
        </div>
      );
    case "kpi":
      return (
        <div className="inline-flex min-w-32 flex-col rounded-lg border border-border/70 bg-surface-1 px-3 py-2">
          <span className="eyebrow">{part.label}</span>
          <span className="num mt-1 text-[20px] font-semibold">{part.value}</span>
          {part.delta ? (
            <span className={cn("text-[11px]", part.direction === "down" ? "text-warn" : part.direction === "up" ? "text-run" : "text-muted-foreground")}>
              {part.delta}
            </span>
          ) : null}
        </div>
      );
    case "sparkline":
      return (
        <div className="inline-flex flex-col rounded-lg border border-border/70 bg-surface-1 px-3 py-2">
          <span className="eyebrow mb-1">{part.label}</span>
          <Sparkline values={part.series} width={160} height={36} />
        </div>
      );
    case "graph":
      return (
        <div className="inline-flex flex-col rounded-lg border border-border/70 bg-surface-1 p-2">
          <GraphSnippet part={part} />
          <EvidenceChips evidence={part.evidence} />
        </div>
      );
    case "timeline":
      return (
        <ol className="space-y-1.5 border-l border-border/70 pl-3">
          {part.entries.map((entry, index) => (
            <li key={index} className="text-[12px]">
              <span className="num mr-2 text-[10.5px] text-muted-foreground">{entry.at.slice(0, 10)}</span>
              <span className="font-medium">{entry.label}</span>
              {entry.detail ? <span className="ml-1.5 text-[11px] text-muted-foreground">{entry.detail}</span> : null}
            </li>
          ))}
        </ol>
      );
    case "proposal":
      return <ProposalPart part={part} />;
    case "approval":
      return <ApprovalPart part={part} />;
    case "actions":
      return <SessionActions actions={part.actions as CopilotAction[]} />;
    case "artifact":
      return <Artifact part={part} />;
    case "image":
      return <ImagePart part={part} />;
    case "mermaid":
      return <MermaidPart part={part} />;
    case "tree":
      return <TreePart part={part} />;
    default:
      return null;
  }
};

export const PartLink = ({ href, label }: { href: string; label: string }) => (
  <Link to={href} className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground">
    <ArrowRight className="h-3 w-3 text-primary/70" /> {label}
  </Link>
);
