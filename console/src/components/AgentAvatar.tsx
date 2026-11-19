import { Megaphone, Radar, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@/data/types";

const toneClasses: Record<Agent["tone"], string> = {
  coral: "border-primary/25 bg-primary/10 text-primary",
  indigo: "border-agent-indigo/25 bg-agent-indigo/10 text-agent-indigo",
  teal: "border-run/25 bg-run/10 text-run",
};

const sizeClasses = {
  sm: "h-7 w-7 rounded-[9px] [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-10 w-10 rounded-[12px] [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-14 w-14 rounded-[16px] [&_svg]:h-6 [&_svg]:w-6",
  xl: "h-[72px] w-[72px] rounded-[20px] [&_svg]:h-8 [&_svg]:w-8",
} as const;

const icons = {
  sales: Target,
  marketing: Megaphone,
  research: Radar,
} as const;

export const AgentAvatar = ({
  agent,
  size = "md",
  className,
  showStatus = false,
}: {
  agent: Agent;
  size?: keyof typeof sizeClasses;
  className?: string;
  showStatus?: boolean;
}) => {
  const Icon = icons[agent.icon];
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center border",
          toneClasses[agent.tone],
          sizeClasses[size],
        )}
        aria-hidden="true"
      >
        <Icon strokeWidth={1.7} />
      </div>
      {showStatus ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
            agent.status === "running" && "bg-run animate-live-dot",
            agent.status === "needs_you" && "bg-warn",
            agent.status === "idle" && "bg-idle",
            agent.status === "paused" && "bg-idle/70",
          )}
        />
      ) : null}
    </div>
  );
};
