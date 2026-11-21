import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AudioLines,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Command,
  FolderKanban,
  FolderOpen,
  Inbox,
  LifeBuoy,
  ListChecks,
  LogOut,
  Menu,
  Mic,
  NotebookPen,
  Phone,
  Plug,
  Puzzle,
  RotateCcw,
  Server,
  Sparkles,
  Sun,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionChip } from "./SessionChip";
import { useData } from "@/data/store";
import { pendingApprovals } from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PersonAvatar } from "@/components/common";
import { ContainerSwitcher } from "./ContainerSwitcher";
import { CopilotDock } from "@/components/copilot/CopilotDock";
import { AgentCursorOverlay } from "@/components/copilot/AgentCursorOverlay";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Query params this item owns — used to disambiguate sibling routes. */
  query?: Record<string, string>;
  ownedParams?: string[];
  badge?: "approvals";
  nested?: boolean;
  action?: "add-agent";
}

const dailyItems: NavItem[] = [
  { to: "/today", label: "Today", icon: Sun },
  { to: "/approvals", label: "Approvals", icon: Inbox, badge: "approvals" },
  { to: "/copilot", label: "Copilot", icon: Sparkles },
  { to: "/people", label: "People & graph", icon: Users, ownedParams: ["tab"] },
  { to: "/voice", label: "Voice & call", icon: AudioLines },
];

const secondaryGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/objectives", label: "Objectives", icon: Target },
      { to: "/missions", label: "Missions", icon: CalendarRange },
      { to: "/plans", label: "Plans", icon: ListChecks },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/events", label: "Events", icon: CalendarDays },
      {
        to: "/people?tab=companies",
        label: "Companies",
        icon: Building2,
        query: { tab: "companies" },
        ownedParams: ["tab"],
      },
    ],
  },
  {
    label: "Agents & memory",
    items: [
      { to: "/agents", label: "Agents & templates", icon: Bot },
      { to: "/schedules", label: "Schedules", icon: CalendarClock },
      { to: "/activity", label: "Activity", icon: Activity },
      { to: "/knowledge/files", label: "Files", icon: FolderOpen },
      { to: "/knowledge/notes", label: "Notes", icon: NotebookPen },
      { to: "/knowledge/retros", label: "Retrospectives", icon: RotateCcw },
    ],
  },
  {
    label: "Integrations & team",
    items: [
      { to: "/integrations/connectors", label: "Connectors", icon: Plug },
      { to: "/integrations/mcp", label: "MCP servers", icon: Server },
      { to: "/integrations/plugins", label: "Plugins", icon: Puzzle },
      { to: "/profile", label: "Profile & team", icon: UserRound },
    ],
  },
];

const useItemActive = () => {
  const { pathname, search } = useLocation();
  return (item: NavItem) => {
    const [path] = item.to.split("?");
    const params = new URLSearchParams(search);
    const pathMatches =
      path === "/today"
        ? pathname === "/today" || pathname === "/"
        : pathname === path || pathname.startsWith(`${path}/`);
    if (!pathMatches) return false;
    const owned = item.ownedParams ?? Object.keys(item.query ?? {});
    return owned.every(
      (key) => (params.get(key) ?? null) === (item.query?.[key] ?? null),
    );
  };
};

const NavItems = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { world, session } = useData();
  const { call } = useOrchestrator();
  const isActive = useItemActive();
  const pendingCount = world ? pendingApprovals(world).length : 0;
  const onSecondaryRoute = secondaryGroups.some((group) =>
    group.items.some((item) => isActive(item)),
  );
  const [moreOpen, setMoreOpen] = useState(onSecondaryRoute);

  useEffect(() => {
    if (onSecondaryRoute) setMoreOpen(true);
  }, [onSecondaryRoute]);

  const renderLink = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={`${item.to}-${item.label}`}
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "focus-ring group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
          active
            ? "bg-surface-2 text-foreground"
            : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
        )}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground/80",
          )}
          strokeWidth={1.8}
        />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge === "approvals" && pendingCount > 0 ? (
          <span className="num rounded-full border border-warn/30 bg-warn/10 px-1.5 text-[10px] font-semibold leading-5 text-warn">
            {pendingCount}
          </span>
        ) : null}
        {item.to === "/voice" && call.state === "live" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav aria-label="Workspace" className="flex-1 space-y-4 overflow-y-auto pr-0.5">
      <div className="space-y-0.5">
        <p className="eyebrow px-2 pb-1 text-[9.5px] tracking-[0.18em]">
          Daily
        </p>
        {dailyItems.map(renderLink)}
      </div>

      <div className="space-y-1 border-t border-border/50 pt-3">
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((prev) => !prev)}
          className="focus-ring flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
        >
          {moreOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="eyebrow flex-1 text-[9.5px] tracking-[0.18em]">
            More views
          </span>
        </button>
        {moreOpen ? (
          <div className="space-y-3 pt-1">
            {secondaryGroups.map((group) => (
              <div key={group.label} className="space-y-0.5">
                <p className="px-2 pb-0.5 text-[10px] font-medium text-muted-foreground/70">
                  {group.label}
                </p>
                {group.items.map(renderLink)}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {session?.mode === "guest" ? (
        <p className="mx-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-warn/90">
          Demo workspace · decisions reset when you reload.
        </p>
      ) : null}
    </nav>
  );
};

const SidebarFooter = () => {
  const { session, signOut } = useData();
  const { openCopilot } = useOrchestrator();
  const navigate = useNavigate();
  const displayName =
    session?.mode === "guest"
      ? "Guest"
      : session?.name?.trim() || session?.email || "Account";

  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => openCopilot("What can the team do for me today?")}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
        >
          <LifeBuoy className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span className="flex-1">Help & shortcuts</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-1/60 px-2 py-1.5">
        <PersonAvatar name={displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-medium">
            {session?.mode === "guest" ? "Guest session" : displayName}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {session?.mode === "guest" ? "Demo · not signed in" : session?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            signOut();
            navigate("/signin", { replace: true });
          }}
          aria-label="Sign out"
          title="Sign out"
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

const Sidebar = () => (
  <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-border/70 bg-sidebar px-2.5 py-3.5 lg:flex">
    <Link
      to="/today"
      className="focus-ring mb-3 flex items-center gap-2.5 rounded-lg px-1.5 py-1"
    >
      <span className="relative flex h-7 w-7 items-center justify-center rounded-[9px] border border-primary/30 bg-primary/10 text-primary">
        <Command className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[12.5px] font-semibold tracking-[0.02em]">
          Mission Control
        </span>
        <span className="mt-0.5 text-[10px] text-muted-foreground">
          Agents for your relationships
        </span>
      </span>
    </Link>
    <div className="mb-3">
      <ContainerSwitcher />
    </div>
    <NavItems />
    <SidebarFooter />
  </aside>
);

const MobileNav = () => {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface-1 text-muted-foreground lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col border-border/70 bg-sidebar p-3"
      >
        <SheetTitle className="text-[12.5px] font-semibold">
          Mission Control
        </SheetTitle>
        <SheetDescription className="sr-only">
          Navigate between today, approvals, work, relationships, calendar,
          agents, knowledge, and integrations.
        </SheetDescription>
        <div className="mt-3">
          <ContainerSwitcher />
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <NavItems onNavigate={() => setOpen(false)} />
          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};

const routeTitles: Record<string, string> = {
  "/": "Today",
  "/today": "Today",
  "/approvals": "Approval inbox",
  "/projects": "Projects",
  "/objectives": "Objectives",
  "/missions": "Missions",
  "/plans": "Plans",
  "/calendar": "Calendar",
  "/agents": "Agents",
  "/people": "People & companies",
  "/events": "Events",
  "/activity": "Activity timeline",
  "/voice": "Voice & call",
  "/knowledge/files": "Files & folders",
  "/knowledge/notes": "Notes",
  "/knowledge/retros": "Retrospectives",
  "/integrations/connectors": "Connectors",
  "/integrations/mcp": "MCP servers",
  "/integrations/plugins": "Plugins",
};

const TopBar = () => {
  const { world, activeProject } = useData();
  const { openCopilot, call, startCall } = useOrchestrator();
  const location = useLocation();
  const navigate = useNavigate();

  // RI-0010: quick-ask opens the session workspace instead of a modal dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/copilot");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const title = useMemo(() => {
    if (location.pathname.startsWith("/projects/")) return "Project";
    if (location.pathname.startsWith("/missions/")) return "Mission";
    if (location.pathname.startsWith("/agents/")) return "Agent detail";
    if (location.pathname.startsWith("/people/")) return "Person profile";
    return routeTitles[location.pathname] ?? "Mission Control";
  }, [location.pathname]);

  const running =
    world?.agents.filter((agent) => agent.status === "running").length ?? 0;

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5 lg:px-7">
        <MobileNav />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{title}</span>
          {activeProject ? (
            <span className="hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary sm:inline-flex">
              {activeProject.name}
            </span>
          ) : null}
          <span className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-surface-1 px-2 py-0.5 text-[10.5px] text-muted-foreground md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
            {running} agents running
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <SessionChip />
          <button
            type="button"
            onClick={() => openCopilot()}
            className="focus-ring group inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-surface-1 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-border hover:bg-surface-2 hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Ask the copilot</span>
            <span className="ml-1 hidden items-center gap-0.5 sm:flex">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">K</kbd>
            </span>
          </button>
          {call.state === "live" || call.state === "ringing" ? (
            <Link
              to="/voice"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-run/30 bg-run/10 px-2.5 text-[11.5px] font-medium text-run"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-run animate-live-dot" />
              {call.state === "ringing"
                ? "Ringing"
                : call.queue.length
                  ? `On call ${Math.min(call.index + 1, call.queue.length)}/${call.queue.length}`
                  : "On call"}
            </Link>
          ) : (
            <Link
              to="/voice"
              aria-label="Open voice surface"
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Mic className="h-4 w-4" />
            </Link>
          )}
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-lg px-2.5 text-[12px]"
            onClick={() => {
              if (call.state === "idle" || call.state === "ended") startCall();
            }}
          >
            <Phone className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {call.state === "live" || call.state === "ringing"
                ? "In call"
                : "Call me"}
            </span>
          </Button>
        </div>
      </div>
    </header>
  );
};

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

export const AppShell = () => (
  <div className="min-h-screen bg-background">
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:bottom-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
    >
      Skip to main content
    </a>
    <ScrollToTop />
    <Sidebar />
    <div className="lg:pl-[252px]">
      <TopBar />
      <main
        id="main"
        tabIndex={-1}
        className="grid-warm min-h-[calc(100vh-3.5rem)] px-3 pb-24 pt-5 outline-none sm:px-5 sm:pt-6 lg:px-8"
      >
        <div className="mx-auto w-full max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
    <AgentCursorOverlay />
    <CopilotDock />
  </div>
);
