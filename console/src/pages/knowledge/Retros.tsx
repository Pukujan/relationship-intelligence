import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Scale,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/common";
import { Button } from "@/components/ui/button";

const Retrospectives = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();

  if (status === "loading") return <PageSkeleton rows={3} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Retrospectives didn't load"
        description={error ?? "Something went wrong reading the retrospectives."}
        onRetry={reload}
      />
    );
  }

  const currentMonth = format(new Date(), "MMMM yyyy");
  const endOfMonth = format(
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
    "d MMMM",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Knowledge"
        title="Retrospectives"
        description="One honest page a month: what moved, what broke, and which decisions changed the way the team works."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() =>
              openCopilot("Draft this month's retrospective from the activity log")
            }
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Draft this month
          </Button>
        }
      />

      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="eyebrow">In progress · {currentMonth}</p>
          <p className="mt-1 text-[13px] font-medium">
            This month closes on {endOfMonth}.
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {world.approvals.filter((a) => a.status !== "pending").length} decisions
            taken, {world.runs.length} runs logged, and{" "}
            {world.notes.filter((n) => n.kind === "meeting").length} meeting notes
            to draw from so far.
          </p>
        </div>
        <Button
          size="sm"
          className="h-9 gap-1.5 rounded-lg text-[12px]"
          onClick={() =>
            openCopilot("Draft this month's retrospective from the activity log")
          }
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Start the draft
        </Button>
      </div>

      {world.retrospectives.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={RotateCcw}
            title="No retrospectives yet"
            description="The first retro appears at the end of the month. It reads from approvals, runs, and notes — never from memory."
            action={
              <Button
                size="sm"
                className="rounded-lg"
                onClick={() =>
                  openCopilot("Draft a retrospective from last month's activity")
                }
              >
                Draft one now
              </Button>
            }
          />
        </div>
      ) : (
        world.retrospectives.map((retro) => (
          <article key={retro.id} className="panel space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">{retro.month}</p>
                <h2 className="mt-1 text-[18px] font-semibold leading-snug">
                  {retro.title}
                </h2>
                <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                  {retro.summary}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg text-[11.5px]"
                onClick={() =>
                  openCopilot(
                    `What did we learn from the ${retro.month} retrospective?`,
                  )
                }
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Discuss
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-4">
              {retro.metrics.map((metric) => (
                <div key={metric.label} className="bg-card p-3">
                  <p className="eyebrow">{metric.label}</p>
                  <p className="num mt-1 text-[20px] font-semibold leading-none">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    {metric.delta}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  title: "What worked",
                  icon: CheckCircle2,
                  tone: "text-run",
                  items: retro.wins,
                },
                {
                  title: "What didn't",
                  icon: XCircle,
                  tone: "text-warn",
                  items: retro.misses,
                },
                {
                  title: "Decisions",
                  icon: Scale,
                  tone: "text-primary",
                  items: retro.decisions,
                },
              ].map((column) => (
                <div
                  key={column.title}
                  className="rounded-xl border border-border/60 bg-background/40 p-3"
                >
                  <p
                    className={cn(
                      "flex items-center gap-1.5 text-[11.5px] font-semibold",
                      column.tone,
                    )}
                  >
                    <column.icon className="h-3.5 w-3.5" />
                    {column.title}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {column.items.map((item) => (
                      <li
                        key={item}
                        className="text-[11px] leading-relaxed text-muted-foreground"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[10.5px] text-muted-foreground">
              <span>
                Built from {world.approvals.length} approvals and{" "}
                {world.activity.length} activity entries.
              </span>
              <Link
                to="/activity"
                className="focus-ring inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
              >
                See the raw timeline
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </article>
        ))
      )}

      <div className="space-y-2">
        <SectionHeader title="How a retro is written" />
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              title: "Reads the record",
              detail:
                "Approvals, runs, and activity — the same record the copilot uses.",
            },
            {
              title: "Keeps the sources",
              detail:
                "Every claim in a retro points at an event, a call, or a decision.",
            },
            {
              title: "Changes one thing",
              detail:
                "Each retro ends with decisions that alter how the agents run.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-border/60 bg-surface-1/40 p-3"
            >
              <p className="text-[11.5px] font-medium">{item.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Retrospectives;
