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
  Plus,
  Presentation,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { createLocalSeedSource } from "@/data/source";
import { createOctoSource } from "@/data/octoSource";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/**
 * RI-0010 task C: metadata-only file creation through the source seam. In
 * owner mode this writes a principal-private ri_console.file_doc row via the
 * adapter; the bytes stay canonical in Octo Files (the toast explains how).
 */
const NewFileDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) => {
  const { session } = useData();
  const source = useMemo(
    () =>
      session?.mode === "owner"
        ? createOctoSource(() => session.workspaceId)
        : createLocalSeedSource(),
    [session?.mode, session?.workspaceId],
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocKind>("doc");
  const [summary, setSummary] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await source.createFile({
        name: name.trim(),
        kind,
        summary: summary.trim(),
        // Private by default; sharing is an explicit choice.
        visibility: shared ? "shared" : "private",
      });
      toast.success("File row created", { description: result.uploadNote });
      setName("");
      setSummary("");
      setShared(false);
      onOpenChange(false);
      onCreated();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not create file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
          <DialogDescription>
            Records a metadata row owned by you. The bytes themselves go to
            Octo Files — upload via MCP upload_file / ingest_document or Octo
            REST /api/files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-file-name" className="text-[11px]">Name</Label>
            <Input
              id="knowledge-file-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Renewal plan v4"
              className="h-9 rounded-lg text-[12px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-file-kind" className="text-[11px]">Kind</Label>
            <select
              id="knowledge-file-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as DocKind)}
              className="focus-ring h-9 w-full rounded-lg border border-border/70 bg-surface-1 px-2 text-[12px]"
            >
              <option value="doc">Document</option>
              <option value="sheet">Sheet</option>
              <option value="deck">Deck</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-file-summary" className="text-[11px]">Summary</Label>
            <Textarea
              id="knowledge-file-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What this file is for…"
              className="min-h-[64px] rounded-lg text-[12px]"
            />
          </div>
          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <input
              type="checkbox"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
              className="focus-ring h-3.5 w-3.5 rounded border-border"
            />
            Share with the team (otherwise private to you)
          </label>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            className="rounded-lg"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? "Creating…" : "Create file row"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Files = () => {
  const { world, status, error, reload } = useData();
  const { openCopilot } = useOrchestrator();
  // "all" works in both modes: owner workspaces start with no folders, so a
  // seed-specific default folder would render an empty, confusing view.
  const [selected, setSelected] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [newFileOpen, setNewFileOpen] = useState(false);

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
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => setNewFileOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New file
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg text-[12px]"
              onClick={() => openCopilot("Summarise my files — what's recent, what's stale, and what's worth reading first?")}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Ask about a file
            </Button>
          </>
        }
      />
      <NewFileDialog
        open={newFileOpen}
        onOpenChange={setNewFileOpen}
        onCreated={reload}
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
