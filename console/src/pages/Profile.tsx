import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Link2,
  Plus,
  Presentation,
  Save,
  Target,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { relativeTime } from "@/data/derive";
import {
  ProfileProvider,
  useProfile,
} from "@/components/profile/ProfileProvider";
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
import type {
  DocKind,
  FileScope,
  LinkEntityKind,
  ProfileFile,
  SelfProfile,
} from "@/data/profileTypes";
import type { World } from "@/data/types";

/**
 * RI-0010 task C: the signed-in person's own surface — about me, team
 * directory, personal files & folders, and goals met.
 *
 * Privacy: everything here is principal-private by default. The team/shared
 * file scopes only ever show explicitly shared rows; the server enforces that
 * rule, this page just renders what the source returns.
 */

const docIcon: Record<DocKind, typeof FileText> = {
  doc: FileText,
  sheet: FileSpreadsheet,
  deck: Presentation,
  pdf: FileType,
};

/* ------------------------------------------------------------------ */
/* About me                                                            */
/* ------------------------------------------------------------------ */

const ChipEditor = ({
  label,
  items,
  placeholder,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) => {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px]"
          >
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onRemove(index)}
              className="focus-ring rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {items.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">None yet.</span>
        ) : null}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (!value) return;
          onAdd(value);
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={`Add ${label}`}
          className="h-8 rounded-lg border-border/70 bg-surface-1 text-[11.5px]"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 rounded-lg px-2 text-[11px]"
          disabled={!draft.trim()}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </form>
    </div>
  );
};

const AboutMe = ({ profile }: { profile: SelfProfile }) => {
  const { patchProfile } = useProfile();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [role, setRole] = useState(profile.role);
  const [team, setTeam] = useState(profile.team);
  const [preferences, setPreferences] = useState<string[]>(profile.preferences);
  const [goals, setGoals] = useState<string[]>(profile.goals);
  const [saving, setSaving] = useState(false);

  // Adopt server truth whenever the profile reloads (e.g. after résumé link).
  useEffect(() => {
    setDisplayName(profile.displayName);
    setRole(profile.role);
    setTeam(profile.team);
    setPreferences(profile.preferences);
    setGoals(profile.goals);
  }, [profile]);

  const dirty =
    displayName !== profile.displayName ||
    role !== profile.role ||
    team !== profile.team ||
    JSON.stringify(preferences) !== JSON.stringify(profile.preferences) ||
    JSON.stringify(goals) !== JSON.stringify(profile.goals);

  const save = async () => {
    setSaving(true);
    try {
      await patchProfile({ displayName, role, team, preferences, goals });
      toast.success("Profile saved — private to you.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel space-y-4 p-4 sm:p-5">
      <SectionHeader
        title="About me"
        action={
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-lg text-[11.5px]"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            <Save className="h-3 w-3" />
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name" className="text-[11px] text-muted-foreground">
            Display name
          </Label>
          <Input
            id="profile-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-9 rounded-lg border-border/70 bg-surface-1 text-[12px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-role" className="text-[11px] text-muted-foreground">
            Role
          </Label>
          <Input
            id="profile-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="What you do"
            className="h-9 rounded-lg border-border/70 bg-surface-1 text-[12px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-team" className="text-[11px] text-muted-foreground">
            Team
          </Label>
          <Input
            id="profile-team"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            placeholder="Which team"
            className="h-9 rounded-lg border-border/70 bg-surface-1 text-[12px]"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChipEditor
          label="Preferences"
          items={preferences}
          placeholder="How you like to work…"
          onAdd={(value) => setPreferences((current) => [...current, value])}
          onRemove={(index) =>
            setPreferences((current) => current.filter((_, i) => i !== index))
          }
        />
        <ChipEditor
          label="Goals"
          items={goals}
          placeholder="What you're working toward…"
          onAdd={(value) => setGoals((current) => [...current, value])}
          onRemove={(index) =>
            setGoals((current) => current.filter((_, i) => i !== index))
          }
        />
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        This record is yours alone — it is stored principal-private and never
        listed to the team. The contact graph holds other people; this is the
        self entity the ledger doesn't have.
      </p>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Résumé (metadata row; bytes canonical in Octo Files)                */
/* ------------------------------------------------------------------ */

const ResumeEntry = ({ profile }: { profile: SelfProfile }) => {
  const { filesView, createFile, patchProfile } = useProfile();
  const [busy, setBusy] = useState(false);
  const resumeFile = filesView?.files.find(
    (file) => file.id === profile.resumeFileId,
  );

  const addResume = async () => {
    setBusy(true);
    try {
      // Metadata only, private by default. The bytes themselves must go to
      // Octo Files — the result's uploadNote says exactly how.
      const result = await createFile({
        name: `Résumé — ${profile.displayName}`,
        kind: "pdf",
        summary: "Personal résumé (metadata row)",
        visibility: "private",
      });
      await patchProfile({ resumeFileId: result.file.id });
      toast.success("Résumé row created", { description: result.uploadNote });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not add résumé.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <SectionHeader title="Résumé" />
      {profile.resumeFileId ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
            <FileType className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium">
              {resumeFile?.name ?? "Résumé"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {resumeFile
                ? `Updated ${relativeTime(resumeFile.updatedAt)} · private to you`
                : "Linked file is outside the current scope."}
            </p>
          </div>
          <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
            Metadata only
          </Pill>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Add a résumé row so agents can reference it. The bytes live in Octo
            Files — upload via MCP upload_file / ingest_document, then link the
            file here.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 rounded-lg text-[12px]"
            disabled={busy}
            onClick={() => void addResume()}
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? "Adding…" : "Add résumé"}
          </Button>
        </div>
      )}
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Team directory                                                      */
/* ------------------------------------------------------------------ */

const TeamDirectory = () => {
  const { team } = useProfile();
  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <SectionHeader title="Team directory" count={team.length} />
      <div className="space-y-1">
        {team.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-2.5 rounded-md px-1 py-1.5"
          >
            <PersonAvatar name={member.displayName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium">
                {member.displayName}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {member.email || "Octo principal"}
              </span>
            </span>
            <Pill className="border-border/70 bg-surface-2 text-muted-foreground">
              {member.role}
            </Pill>
            {member.isSelf ? (
              <Pill className="border-primary/30 bg-primary/10 text-primary">
                You
              </Pill>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Real Octo principals and their workspace roles — not contacts from the
        graph. Memberships are enforced by Octo on every request.
      </p>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Files & folders                                                     */
/* ------------------------------------------------------------------ */

const FolderTree = ({
  folders,
  parentId,
  depth,
  selected,
  counts,
  onSelect,
}: {
  folders: { id: string; name: string; parentId: string | null }[];
  parentId: string | null;
  depth: number;
  selected: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}) => (
  <>
    {folders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => {
        const children = folders.filter((item) => item.parentId === folder.id);
        const count = counts[folder.id] ?? 0;
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
                folders={folders}
                parentId={folder.id}
                depth={depth + 1}
                selected={selected}
                counts={counts}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
  </>
);

/** Link chips resolve against the canonical graph — they never copy it. */
const LinkChips = ({ file, world }: { file: ProfileFile; world: World | null }) => {
  const chips = new Map<string, { kind: LinkEntityKind; id: string }>();
  for (const link of file.links) {
    chips.set(`${link.entityKind}:${link.entityId}`, {
      kind: link.entityKind,
      id: link.entityId,
    });
  }
  for (const personId of file.personIds) {
    chips.set(`person:${personId}`, { kind: "person", id: personId });
  }
  if (file.projectId) {
    chips.set(`project:${file.projectId}`, { kind: "project", id: file.projectId });
  }
  if (!world) return null;
  return (
    <>
      {[...chips.values()].slice(0, 5).map((chip) => {
        const key = `${chip.kind}:${chip.id}`;
        if (chip.kind === "person") {
          const person = world.people.find((item) => item.id === chip.id);
          if (!person) return null;
          return (
            <Link
              key={key}
              to={`/people/${person.id}`}
              className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <PersonAvatar name={person.name} size="xs" className="h-3.5 w-3.5 text-[7px]" />
              {person.name}
            </Link>
          );
        }
        if (chip.kind === "project") {
          const project = world.projects.find((item) => item.id === chip.id);
          if (!project) return null;
          return (
            <Link
              key={key}
              to={`/projects/${project.id}`}
              className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Target className="h-2.5 w-2.5" />
              {project.name}
            </Link>
          );
        }
        if (chip.kind === "company") {
          const company = world.companies.find((item) => item.id === chip.id);
          if (!company) return null;
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {company.name}
            </span>
          );
        }
        if (chip.kind === "event") {
          const event = world.events.find((item) => item.id === chip.id);
          if (!event) return null;
          return (
            <Link
              key={key}
              to={`/events?focus=${event.id}`}
              className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {event.name}
            </Link>
          );
        }
        const milestone = world.milestones.find((item) => item.id === chip.id);
        if (!milestone) return null;
        return (
          <Link
            key={key}
            to={`/milestones/${milestone.id}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {milestone.name}
          </Link>
        );
      })}
    </>
  );
};

const NewFileDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { createFile } = useProfile();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocKind>("doc");
  const [summary, setSummary] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await createFile({
        name: name.trim(),
        kind,
        summary: summary.trim(),
        // Private unless the person explicitly shares — same default as the
        // adapter.
        visibility: shared ? "shared" : "private",
      });
      toast.success("File row created", { description: result.uploadNote });
      setName("");
      setSummary("");
      setShared(false);
      onOpenChange(false);
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
            Records a metadata row. The bytes themselves go to Octo Files —
            upload via MCP upload_file / ingest_document or Octo REST /api/files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-file-name" className="text-[11px]">Name</Label>
            <Input
              id="new-file-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Renewal plan v4"
              className="h-9 rounded-lg text-[12px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-file-kind" className="text-[11px]">Kind</Label>
            <select
              id="new-file-kind"
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
            <Label htmlFor="new-file-summary" className="text-[11px]">Summary</Label>
            <Textarea
              id="new-file-summary"
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

const LinkFileDialog = ({
  fileId,
  world,
  onClose,
}: {
  fileId: string | null;
  world: World | null;
  onClose: () => void;
}) => {
  const { linkFile } = useProfile();
  const [entityKind, setEntityKind] = useState<LinkEntityKind>("person");
  const [entityId, setEntityId] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    if (!world) return [];
    if (entityKind === "person") {
      return world.people.map((item) => ({ id: item.id, label: item.name }));
    }
    if (entityKind === "company") {
      return world.companies.map((item) => ({ id: item.id, label: item.name }));
    }
    if (entityKind === "project") {
      return world.projects.map((item) => ({ id: item.id, label: item.name }));
    }
    if (entityKind === "event") {
      return world.events.map((item) => ({ id: item.id, label: item.name }));
    }
    return world.milestones.map((item) => ({ id: item.id, label: item.name }));
  }, [world, entityKind]);

  const submit = async () => {
    if (!fileId || !entityId) return;
    setBusy(true);
    try {
      await linkFile(fileId, { entityKind, entityId });
      toast.success("Linked to the graph entity.");
      setEntityId("");
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not link file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(fileId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link file to an entity</DialogTitle>
          <DialogDescription>
            Links reference the canonical graph — the person, company, project,
            event, or milestone stays where it lives.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-kind" className="text-[11px]">Entity kind</Label>
            <select
              id="link-kind"
              value={entityKind}
              onChange={(event) => {
                setEntityKind(event.target.value as LinkEntityKind);
                setEntityId("");
              }}
              className="focus-ring h-9 w-full rounded-lg border border-border/70 bg-surface-1 px-2 text-[12px]"
            >
              <option value="person">Person</option>
              <option value="company">Company</option>
              <option value="project">Project</option>
              <option value="event">Event</option>
              <option value="mission">Milestone</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-entity" className="text-[11px]">Entity</Label>
            <select
              id="link-entity"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              className="focus-ring h-9 w-full rounded-lg border border-border/70 bg-surface-1 px-2 text-[12px]"
            >
              <option value="">Choose…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            className="rounded-lg"
            disabled={!entityId || busy}
            onClick={() => void submit()}
          >
            {busy ? "Linking…" : "Add link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MyFiles = () => {
  const { world } = useData();
  const { filesView, scope, setScope } = useProfile();
  const [selected, setSelected] = useState<string>("all");
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);

  const folders = useMemo(() => filesView?.folders ?? [], [filesView]);
  const files = useMemo(() => filesView?.files ?? [], [filesView]);
  // A folder selected in another scope may not exist here; fall back to all.
  const effective =
    selected !== "all" &&
    selected !== "unfiled" &&
    !folders.some((folder) => folder.id === selected)
      ? "all"
      : selected;

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const file of files) {
      result[file.folderId] = (result[file.folderId] ?? 0) + 1;
    }
    return result;
  }, [files]);

  const visible = files.filter((file) => {
    if (effective === "all") return true;
    if (effective === "unfiled") {
      return !file.folderId || !folders.some((folder) => folder.id === file.folderId);
    }
    return file.folderId === effective;
  });

  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <SectionHeader
        title="My files & folders"
        count={files.length}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg text-[11.5px]"
            onClick={() => setNewFileOpen(true)}
          >
            <Plus className="h-3 w-3" />
            New file
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface-1 p-0.5">
          {(
            [
              ["mine", "Mine"],
              ["team", "Team"],
              ["shared", "Shared"],
            ] as [FileScope, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              aria-pressed={scope === id}
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                scope === id
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          Private files stay with you — Team and Shared only show explicitly
          shared rows.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-border/60 bg-surface-1/40 p-1.5">
          <button
            type="button"
            onClick={() => setSelected("all")}
            aria-pressed={effective === "all"}
            className={cn(
              "focus-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
              effective === "all"
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate">All files</span>
            <span className="num text-[10px] text-muted-foreground">{files.length}</span>
          </button>
          <FolderTree
            folders={folders}
            parentId={null}
            depth={0}
            selected={effective}
            counts={counts}
            onSelect={setSelected}
          />
          <button
            type="button"
            onClick={() => setSelected("unfiled")}
            aria-pressed={effective === "unfiled"}
            className={cn(
              "focus-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
              effective === "unfiled"
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
            )}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">Unfiled</span>
          </button>
        </aside>

        <div className="space-y-1.5">
          {visible.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={scope === "mine" ? "No files of your own yet" : "Nothing shared in this view"}
              description={
                scope === "mine"
                  ? "Create a metadata row here; upload the bytes to Octo Files so they stay canonical."
                  : "Only explicitly shared files appear here. Private files never cross principals."
              }
              action={
                scope === "mine" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => setNewFileOpen(true)}
                  >
                    New file
                  </Button>
                ) : undefined
              }
            />
          ) : (
            visible.map((file) => {
              const Icon = docIcon[file.kind] ?? FileText;
              return (
                <div
                  key={file.id}
                  className="space-y-1.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{file.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {file.summary || "No summary"} · {file.owner}
                      </p>
                    </div>
                    <Pill
                      className={
                        file.visibility === "private"
                          ? "border-warn/30 bg-warn/10 text-warn"
                          : "border-run/30 bg-run/10 text-run"
                      }
                    >
                      {file.visibility === "private" ? "Private" : "Shared"}
                    </Pill>
                    <span className="num text-[10px] text-muted-foreground">
                      {relativeTime(file.updatedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLinkTarget(file.id)}
                      className="focus-ring inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Link2 className="h-2.5 w-2.5" />
                      Link
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-11">
                    <LinkChips file={file} world={world} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <NewFileDialog open={newFileOpen} onOpenChange={setNewFileOpen} />
      <LinkFileDialog
        fileId={linkTarget}
        world={world}
        onClose={() => setLinkTarget(null)}
      />
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Goals met (from objectives + retros — never from memory)            */
/* ------------------------------------------------------------------ */

const GoalsMet = () => {
  const { world } = useData();
  const { retros } = useProfile();
  const met = (world?.objectives ?? []).filter(
    (objective) => objective.status === "met",
  );
  const wins = retros.flatMap((retro) =>
    retro.wins.map((win) => ({ month: retro.month, win })),
  );

  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <SectionHeader title="Goals met" count={met.length + wins.length} />
      {met.length === 0 && wins.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Nothing recorded as met yet. This list reads objectives marked
          &ldquo;met&rdquo; and wins from retrospectives — it never invents
          progress.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {met.map((objective) => (
            <li
              key={objective.id}
              className="flex items-start gap-2 text-[11.5px] leading-relaxed"
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-run" />
              <span>
                <span className="font-medium">{objective.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {objective.targetLabel}
                </span>
              </span>
            </li>
          ))}
          {wins.map((entry, index) => (
            <li
              key={`${entry.month}-${index}`}
              className="flex items-start gap-2 text-[11.5px] leading-relaxed"
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                {entry.win}
                <span className="text-muted-foreground"> · {entry.month} retro</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const ProfilePage = () => {
  const { profile, status, error, reload } = useProfile();

  if (status === "loading") return <PageSkeleton rows={5} />;
  if (status === "error" || !profile) {
    return (
      <LoadError
        title="Profile didn't load"
        description={error ?? "Something went wrong reading your profile."}
        onRetry={reload}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="You"
        title="Profile"
        description="Your own record in this workspace: who you are, your team, and the files and goals that belong to you. Private by default — sharing is always an explicit choice."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <AboutMe profile={profile} />
          <MyFiles />
        </div>
        <div className="space-y-4">
          <ResumeEntry profile={profile} />
          <TeamDirectory />
          <GoalsMet />
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <User className="h-3 w-3" />
        Signed in as {profile.displayName}
        <Users className="ml-2 h-3 w-3" />
        Team roles come from Octo memberships.
      </p>
    </div>
  );
};

const Profile = () => (
  <ProfileProvider>
    <ProfilePage />
  </ProfileProvider>
);

export default Profile;
