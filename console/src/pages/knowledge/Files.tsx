import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Presentation,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import {
  childFolders,
  filesInFolder,
  folderPath,
  projectById,
  relativeTime,
} from "@/data/derive";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  PersonAvatar,
  SectionHeader,
} from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocKind, World } from "@/data/types";

const docIcon: Record<DocKind, typeof FileText> = {
  doc: FileText,
  sheet: FileSpreadsheet,
  deck: Presentation,
  pdf: FileType,
};

const docLabel: Record<DocKind, string> = {
  doc: "Document",
  sheet: "Sheet",
  deck: "Deck",
  pdf: "PDF",
};

const FolderTree = ({
  world,
  parentId,
  depth,
  selected,
  onSelect,
}: {
  world: World;
  parentId: string | null;
  depth: number;
  selected: string | "all";
  onSelect: (id: string) => void;
}) =>
  childFolders(world, parentId).map((folder) => {
    const children = childFolders(world, folder.id);
    const count = world.files.filter((file) => file.folderId === folder.id).length;
    return (
      <div key={folder.id}>
        <button
          type="button"
          onClick={() => onSelect(folder.id)}
          aria-pressed={selected === folder.id}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={cn(
            "focus-ring flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[12px] transition-colors",
            selected === folder.id
              ? "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
          )}
        >
          {selected === folder.id ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1 truncate">{folder.name}</span>
          {count > 0 ? (
            <span className="num text-[10px] text-muted-foreground">{count}</span>
          ) : null}
        </button>
        {children.length ? (
          <FolderTree
            world={world}
            parentId={folder.id}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        ) : null}
      </div>
    );
  });

const Files = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  const [selected, setSelected] = useState<string | "all">("fd4");
  const [query, setQuery] = useState("");

  const files = useMemo(() => {
    if (!world) return [];
    const text = query.trim().toLowerCase();
    return world.files
      .filter((file) => selected === "all" || file.folderId === selected)
      .filter(
        (file) =>
          !text ||
          `${file.name} ${file.summary} ${file.owner}`
            .toLowerCase()
            .includes(text),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [world, selected, query]);

  if (status === "loading") return <PageSkeleton rows={5} />;
  if (status === "error" || !world) {
    return (
      <LoadError
        title="Files didn't load"
        description={error ?? "Something went wrong reading the knowledge folder."}
        onRetry={reload}
      />
    );
  }

  const path = selected === "all" ? [] : folderPath(world, selected);
  const folder = selected === "all" ? undefined : world.folders.find((f) => f.id === selected);
  const directFiles = folder ? filesInFolder(world, folder.id).length : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Knowledge"
        title="Files & folders"
        description="The documents the team works from. Files stay linked to the people and projects they belong to — the folder is just where they live."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            onClick={() => openCopilot("Summarise the Halcyon renewal plan")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask about a file
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="panel h-fit p-2">
          <p className="eyebrow px-2 pb-1 pt-1">Folders</p>
          <button
            type="button"
            onClick={() => setSelected("all")}
            aria-pressed={selected === "all"}
            className={cn(
              "focus-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
              selected === "all"
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate">All files</span>
            <span className="num text-[10px] text-muted-foreground">
              {world.files.length}
            </span>
          </button>
          <FolderTree
            world={world}
            parentId={null}
            depth={0}
            selected={selected}
            onSelect={setSelected}
          />
          <div className="mt-2 border-t border-border/60 px-2 py-2">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Folders organise documents only. People and projects stay in the
              graph.
            </p>
          </div>
        </aside>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setSelected("all")}
                className="focus-ring rounded transition-colors hover:text-foreground"
              >
                Files
              </button>
              {path.map((item) => (
                <span key={item.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    className={cn(
                      "focus-ring rounded transition-colors hover:text-foreground",
                      item.id === selected && "text-foreground",
                    )}
                  >
                    {item.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files…"
                aria-label="Search files"
                className="h-8 rounded-lg border-border/70 bg-surface-1 pl-8 text-[11.5px]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>

          <SectionHeader
            title={selected === "all" ? "All files" : (folder?.name ?? "Folder")}
            count={files.length}
          />

          {files.length === 0 ? (
            <div className="panel p-5">
              <EmptyState
                icon={FolderOpen}
                title={query ? "No files match that search" : "This folder is empty"}
                description={
                  query
                    ? "Try a different name or clear the search to see everything in this folder."
                    : "Documents land here as agents produce them. Nothing is generated silently — every file has an owner."
                }
                action={
                  query ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => setSelected("all")}
                    >
                      Show all files
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((file) => {
                const Icon = docIcon[file.kind];
                const project = projectById(world, file.projectId);
                return (
                  <div
                    key={file.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-2/30"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{file.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {file.summary}
                      </p>
                    </div>
                    <div className="hidden items-center gap-1 sm:flex">
                      {file.personIds.slice(0, 3).map((id) => {
                        const person = world.people.find((item) => item.id === id);
                        if (!person) return null;
                        return (
                          <Link
                            key={id}
                            to={`/people/${person.id}`}
                            className="focus-ring rounded-full"
                            aria-label={person.name}
                            title={person.name}
                          >
                            <PersonAvatar
                              name={person.name}
                              size="xs"
                              className="ring-2 ring-card"
                            />
                          </Link>
                        );
                      })}
                    </div>
                    <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                      {project ? (
                        <Link
                          to={`/projects/${project.id}`}
                          className="focus-ring hidden truncate rounded text-[10.5px] text-muted-foreground transition-colors hover:text-foreground lg:block"
                        >
                          {project.name}
                        </Link>
                      ) : null}
                      <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
                        {docLabel[file.kind]}
                      </Pill>
                      <span className="num text-[10px] text-muted-foreground">
                        {file.size}
                      </span>
                      <span className="num ml-auto text-[10px] text-muted-foreground sm:ml-0">
                        {relativeTime(file.updatedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-1/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
            <span>
              {directFiles} file{directFiles === 1 ? "" : "s"} in{" "}
              {folder?.name ?? "this folder"} · owned by a named teammate or agent
            </span>
            <Link
              to="/knowledge/notes"
              className="focus-ring inline-flex items-center gap-1 rounded text-primary transition-colors hover:text-primary/80"
            >
              Meeting notes
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Files;
