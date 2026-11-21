import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { ApprovalKind, EvidenceRef, Risk } from "@/data/types";

export const PageHeader = ({
  eyebrow,
  title,
  description,
  actions,
  back,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; href: string };
  className?: string;
}) => (
  <header className={cn("flex flex-col gap-4", className)}>
    {back ? (
      <Link
        to={back.href}
        className="focus-ring inline-flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="h-3.5 w-3.5 rotate-180" />
        {back.label}
      </Link>
    ) : null}
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="text-balance text-[26px] font-semibold leading-tight sm:text-[30px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  </header>
);

export const SectionHeader = ({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number | string;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn("flex items-center justify-between gap-3", className)}>
    <div className="flex items-center gap-2">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
      {count !== undefined ? (
        <span className="num rounded-full border border-border/70 bg-surface-2 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          {count}
        </span>
      ) : null}
    </div>
    {action}
  </div>
);

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-surface-1/40 px-6 py-10 text-center",
      className,
    )}
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-2 text-muted-foreground">
      <Icon className="h-4 w-4" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
    {action}
  </div>
);

const personTones = [
  "border-primary/20 bg-primary/10 text-primary",
  "border-agent-indigo/20 bg-agent-indigo/10 text-agent-indigo",
  "border-run/20 bg-run/10 text-run",
  "border-warn/20 bg-warn/10 text-warn",
];

export const PersonAvatar = ({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) => {
  const tone =
    personTones[
      name.split("").reduce((total, char) => total + char.charCodeAt(0), 0) %
        personTones.length
    ];
  const sizes = {
    xs: "h-5 w-5 text-[9px]",
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-[11px]",
    lg: "h-14 w-14 text-base",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-wide",
        tone,
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
};

export const StrengthMeter = ({
  value,
  className,
  showLabel = false,
}: {
  value: number;
  className?: string;
  showLabel?: boolean;
}) => {
  const filled = Math.max(1, Math.round(value / 20));
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex items-end gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={cn(
              "w-[3px] rounded-full",
              index < filled ? "bg-foreground/70" : "bg-border",
            )}
            style={{ height: `${6 + index * 2}px` }}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="num text-[11px] font-medium text-muted-foreground">
          {value}
        </span>
      ) : null}
      <span className="sr-only">Relationship strength {value} out of 100</span>
    </span>
  );
};

const riskStyles: Record<Risk, string> = {
  low: "border-border bg-surface-2 text-muted-foreground",
  medium: "border-warn/30 bg-warn/10 text-warn",
  high: "border-primary/35 bg-primary/10 text-primary",
};

export const RiskBadge = ({ risk, className }: { risk: Risk; className?: string }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium capitalize",
      riskStyles[risk],
      className,
    )}
  >
    {risk} risk
  </span>
);

const kindLabels: Record<ApprovalKind, string> = {
  send: "Send",
  call: "Call",
  publish: "Publish",
  invite: "Invite",
  commit: "Commit",
  mission: "Milestone",
  replan: "Re-plan",
};

export const KindBadge = ({ kind, className }: { kind: ApprovalKind; className?: string }) => (
  <span
    className={cn(
      "inline-flex items-center rounded border border-border/80 bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground",
      className,
    )}
  >
    {kindLabels[kind]}
  </span>
);

export const EvidenceRow = ({
  evidence,
  className,
  limit,
}: {
  evidence: EvidenceRef[];
  className?: string;
  limit?: number;
}) => {
  const items = limit ? evidence.slice(0, limit) : evidence;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => (
        <span
          key={`${item.label}-${item.detail}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-surface-2/60 px-2 py-1 text-[10.5px] leading-4 text-muted-foreground"
        >
          <span className="font-medium text-foreground/75">{item.label}</span>
          <span className="text-border">/</span>
          <span className="truncate">{item.detail}</span>
        </span>
      ))}
      {limit && evidence.length > limit ? (
        <span className="inline-flex items-center rounded-md border border-border/70 px-2 py-1 text-[10.5px] text-muted-foreground">
          +{evidence.length - limit} more
        </span>
      ) : null}
    </div>
  );
};

export const LoadingRows = ({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) => (
  <div className={cn("space-y-2", className)} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className="animate-sheen h-16 rounded-xl border border-border/60 bg-gradient-to-r from-surface-1 via-surface-2 to-surface-1"
      />
    ))}
  </div>
);

export const PageSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="space-y-5" aria-busy="true" aria-live="polite">
    <div className="space-y-2">
      <div className="h-3 w-24 animate-sheen rounded bg-surface-2" />
      <div className="h-8 w-64 animate-sheen rounded bg-surface-2" />
      <div className="h-3 w-80 animate-sheen rounded bg-surface-2" />
    </div>
    <LoadingRows rows={rows} />
    <span className="sr-only">Loading</span>
  </div>
);

export const LoadError = ({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) => (
  <div className="panel p-6">
    <EmptyState
      icon={AlertTriangle}
      title={title}
      description={description}
      action={
        <Button size="sm" className="rounded-lg" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  </div>
);

