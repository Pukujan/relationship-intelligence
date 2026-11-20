import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  FolderKanban,
  Plus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

const ROLE_HINTS: Record<"admin" | "operator" | "member", string> = {
  admin: "Full workspace access, project deletes, and teammate invites.",
  operator: "Can decide workspace approvals and manage agent/connector runs.",
  member: "Can read shared work, create items, and decide their own proposals.",
};

const SwitcherRow = ({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
        aria-label={`${label}: ${value}. Switch ${label.toLowerCase()}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
            {label}
          </span>
          <span className="block truncate text-[12px] font-medium leading-tight text-foreground">
            {value}
          </span>
          {hint ? (
            <span className="block truncate text-[10px] leading-tight text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
    </DropdownMenuTrigger>
    {children}
  </DropdownMenu>
);

/**
 * The tenancy boundary: organization ▸ workspace ▸ project. Includes RI-0013
 * (#38) workspace creation (disabled-with-explanation unless OCTO_ACCOUNT_KEY
 * is configured) and teammate invite flows.
 */
export const ContainerSwitcher = () => {
  const {
    world,
    session,
    activeProjectId,
    activeProject,
    setActiveProject,
    setActiveWorkspace,
    reload,
  } = useData();

  const [createOpen, setCreateOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsSummary, setWsSummary] = useState("");
  const [wsCreateEnabled, setWsCreateEnabled] = useState<boolean | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "operator" | "member">(
    "member",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (session?.mode !== "owner") return;
    fetch("/app-api/config", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { workspaceCreateEnabled?: boolean } | null) => {
        if (d) setWsCreateEnabled(Boolean(d.workspaceCreateEnabled));
      })
      .catch(() => setWsCreateEnabled(false));
  }, [session?.mode]);

  const organization = world?.organization;
  const workspace = useMemo(() => {
    if (!world) return undefined;
    return (
      world.workspaces.find((item) => item.id === session?.workspaceId) ??
      world.workspaces[0]
    );
  }, [world, session]);

  const submitCreateWorkspace = async () => {
    if (!wsName.trim() || !wsCreateEnabled) return;
    setSubmitting(true);
    try {
      const res = await fetch("/app-api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: wsName.trim(),
          description: wsSummary.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        detail?: string;
      };
      if (!res.ok) throw new Error(body.detail ?? `Answered ${res.status}`);
      toast.success("Workspace created", {
        description: `${wsName.trim()} is provisioned and ready.`,
      });
      setWsName("");
      setWsSummary("");
      setCreateOpen(false);
      if (body.id) setActiveWorkspace(body.id);
      else reload();
    } catch (err) {
      toast.error("Could not create workspace", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitInvite = async () => {
    if (!inviteEmail.trim() || !workspace) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/app-api/workspaces/${encodeURIComponent(workspace.id)}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            email: inviteEmail.trim(),
            role: inviteRole,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        detail?: string;
        error?: string;
      };
      if (!res.ok)
        throw new Error(body.detail ?? body.error ?? `Answered ${res.status}`);
      toast.success("Invite recorded", {
        description: `${inviteEmail.trim()} (${inviteRole}) can join by signing in with Google at business.design-bakery.com.`,
      });
      setInviteEmail("");
      setInviteOpen(false);
    } catch (err) {
      toast.error("Could not invite teammate", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!world || !organization || !workspace) {
    return (
      <div className="rounded-xl border border-border/70 bg-surface-1/60 p-2">
        <div className="h-8 animate-sheen rounded-md bg-surface-2" />
        <div className="mt-1 h-8 animate-sheen rounded-md bg-surface-2" />
      </div>
    );
  }

  const isOwnerMode = session?.mode === "owner";

  return (
    <>
      <div className="rounded-xl border border-border/70 bg-surface-1/60 p-1">
        <SwitcherRow
          label="Organization"
          value={organization.name}
          hint={organization.plan}
        >
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Organization
            </DropdownMenuLabel>
            <DropdownMenuItem className="gap-2 text-[12.5px]">
              <Check className="h-3.5 w-3.5 text-primary" />
              <span className="flex-1">{organization.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {world.workspaces.length} workspace
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {organization.domain} · every record stays inside this
              organization.
            </p>
          </DropdownMenuContent>
        </SwitcherRow>

        <SwitcherRow
          label="Workspace"
          value={workspace.name}
          hint={workspace.role ? `${workspace.role} · ${workspace.region}` : workspace.region}
        >
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            {world.workspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="gap-2 text-[12.5px]"
                onSelect={() => setActiveWorkspace(item.id)}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    item.id === workspace.id
                      ? "text-primary"
                      : "text-transparent",
                  )}
                />
                <span className="flex-1 truncate">{item.name}</span>
                <span className="rounded-full border border-border/70 bg-surface-2 px-1.5 py-px text-[9.5px] capitalize text-muted-foreground">
                  {item.role ?? item.region}
                </span>
              </DropdownMenuItem>
            ))}
            {isOwnerMode ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-[12px]"
                  onSelect={() => setCreateOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  <span>New workspace…</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-[12px]"
                  onSelect={() => setInviteOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  <span>Invite teammate…</span>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {isOwnerMode
                ? "Workspaces you belong to in Octo. Switching rescopes every view."
                : "One workspace in this demo. Projects live inside it."}
            </p>
          </DropdownMenuContent>
        </SwitcherRow>

        <SwitcherRow
          label="Project"
          value={activeProject?.name ?? "All projects"}
          hint={
            activeProject
              ? `${world.objectives.filter((o) => o.projectId === activeProject.id).length} objectives in scope`
              : `${world.projects.length} projects`
          }
        >
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Scope work to
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="gap-2 text-[12.5px]"
              onSelect={() => setActiveProject("all")}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  activeProjectId === "all"
                    ? "text-primary"
                    : "text-transparent",
                )}
              />
              <span className="flex-1">All projects</span>
              <span className="num text-[10px] text-muted-foreground">
                {world.projects.length}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {world.projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                className="gap-2 text-[12.5px]"
                onSelect={() => setActiveProject(project.id)}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    activeProjectId === project.id
                      ? "text-primary"
                      : "text-transparent",
                  )}
                />
                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{project.name}</span>
                <span className="text-[10px] capitalize text-muted-foreground">
                  {project.status === "at_risk" ? "at risk" : project.status}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </SwitcherRow>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md border-border/80 bg-popover sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[15px]">New workspace</DialogTitle>
            <DialogDescription className="text-[12px]">
              Creates an isolated Octo workspace and provisions the console
              schema idempotently.
            </DialogDescription>
          </DialogHeader>
          {wsCreateEnabled === false ? (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-[12px] leading-relaxed text-foreground/90">
              Workspace creation is currently disabled because{" "}
              <code className="font-mono text-[11px]">OCTO_ACCOUNT_KEY</code> is
              not configured on this server. Supply an account-scoped Octo key
              to enable minting new workspaces from the console.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium">Name</label>
                <Input
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="e.g. Design Bakery Q1"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium">
                  Description (optional)
                </label>
                <Input
                  value={wsSummary}
                  onChange={(e) => setWsSummary(e.target.value)}
                  placeholder="Team deals and relationship graph"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Close
            </Button>
            <Button
              size="sm"
              disabled={!wsCreateEnabled || !wsName.trim() || submitting}
              onClick={submitCreateWorkspace}
            >
              Create workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md border-border/80 bg-popover sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              Invite teammate to {workspace.name}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              They join by opening business.design-bakery.com and signing in
              with this Google address. Nothing else to install.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11.5px] font-medium">Google email</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11.5px] font-medium">Role</label>
              <div className="flex gap-1.5">
                {(["member", "operator", "admin"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInviteRole(r)}
                    className={cn(
                      "focus-ring flex-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium capitalize transition-colors",
                      inviteRole === r
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 bg-surface-1 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {ROLE_HINTS[inviteRole]}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!inviteEmail.trim() || submitting}
              onClick={submitInvite}
            >
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
