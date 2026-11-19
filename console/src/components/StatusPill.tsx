import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/data/types";

const config: Record<
  AgentStatus,
  { label: string; className: string; dot: string }
> = {
  running: {
    label: "Running",
    className: "border-run/25 bg-run/10 text-run",
    dot: "bg-run animate-live-dot",
  },
  needs_you: {
    label: "Needs you",
    className: "border-warn/30 bg-warn/10 text-warn",
    dot: "bg-warn animate-live-dot",
  },
  idle: {
    label: "Idle",
    className: "border-border bg-surface-2 text-muted-foreground",
    dot: "bg-idle",
  },
  paused: {
    label: "Paused",
    className: "border-border bg-transparent text-muted-foreground",
    dot: "bg-idle/60",
  },
};

export const StatusPill = ({
  status,
  className,
  withDot = true,
}: {
  status: AgentStatus;
  className?: string;
  withDot?: boolean;
}) => {
  const item = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        item.className,
        className,
      )}
    >
      {withDot ? (
        <span className={cn("h-1.5 w-1.5 rounded-full", item.dot)} />
      ) : null}
      {item.label}
    </span>
  );
};
