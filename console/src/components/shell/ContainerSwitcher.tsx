import { useMemo } from "react";
import { Check, ChevronsUpDown, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
 * The tenancy boundary: organization ▸ workspace ▸ project. This is a context
 * switcher, not a nav tab — it scopes the work views below it.
 */
export const ContainerSwitcher = () => {
  const {
    world,
    session,
    activeProjectId,
    activeProject,
    setActiveProject,
  } = useData();

  const organization = world?.organization;
  const workspace = useMemo(() => {
    if (!world) return undefined;
    return (
      world.workspaces.find((item) => item.id === session?.workspaceId) ??
      world.workspaces[0]
    );
  }, [world, session]);

  if (!world || !organization || !workspace) {
    return (
      <div className="rounded-xl border border-border/70 bg-surface-1/60 p-2">
        <div className="h-8 animate-sheen rounded-md bg-surface-2" />
        <div className="mt-1 h-8 animate-sheen rounded-md bg-surface-2" />
      </div>
    );
  }

  return (
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
            {organization.domain} · every record stays inside this organization.
          </p>
        </DropdownMenuContent>
      </SwitcherRow>

      <SwitcherRow
        label="Workspace"
        value={workspace.name}
        hint={workspace.region}
      >
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Workspace
          </DropdownMenuLabel>
          {world.workspaces.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="gap-2 text-[12.5px]"
              disabled={item.id !== workspace.id}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  item.id === workspace.id
                    ? "text-primary"
                    : "text-transparent",
                )}
              />
              <span className="flex-1">{item.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {item.region}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            One workspace in this build. Projects live inside it.
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
                activeProjectId === "all" ? "text-primary" : "text-transparent",
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
  );
};
