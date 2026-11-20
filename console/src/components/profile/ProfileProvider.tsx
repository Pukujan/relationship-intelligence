import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createLocalSeedSource, type MissionControlSource } from "@/data/source";
import { createOctoSource } from "@/data/octoSource";
import { useData } from "@/data/store";
import type {
  FileLink,
  FileScope,
  FilesView,
  FileUploadResult,
  LinkEntityKind,
  NewFileInput,
  NewNoteInput,
  ProfilePatch,
  SelfProfile,
  TeamMember,
} from "@/data/profileTypes";
import type { Note, Retrospective } from "@/data/types";

/**
 * RI-0010 task C: loads the signed-in person's own profile, their team, and
 * their knowledge (files & folders, notes, retros) through the same source
 * seam as the rest of the console — Octo adapter in owner mode, seed in the
 * demo.
 *
 * Privacy: the adapter writes principal-private by default and only returns
 * own + shared rows. The scope filter here is a view choice, not a security
 * boundary: private rows of other principals never reach this context because
 * the server never sends them.
 */

type LoadStatus = "loading" | "ready" | "error";

interface ProfileContextValue {
  profile: SelfProfile | null;
  team: TeamMember[];
  filesView: FilesView | null;
  notes: Note[];
  retros: Retrospective[];
  scope: FileScope;
  setScope: (scope: FileScope) => void;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
  patchProfile: (patch: ProfilePatch) => Promise<SelfProfile>;
  createFile: (input: NewFileInput) => Promise<FileUploadResult>;
  linkFile: (
    fileId: string,
    link: { entityKind: LinkEntityKind; entityId: string },
  ) => Promise<FileLink>;
  createNote: (input: NewNoteInput) => Promise<Note>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useData();
  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [filesView, setFilesView] = useState<FilesView | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [scope, setScope] = useState<FileScope>("mine");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Same source selection as the store: owner authority is the adapter
  // cookie; guests get the clearly-labelled demo.
  const seedSource = useMemo(() => createLocalSeedSource(), []);
  const octoSource = useMemo(
    () => createOctoSource(() => session?.workspaceId ?? ""),
    [session?.workspaceId],
  );
  const source: MissionControlSource =
    session?.mode === "owner" ? octoSource : seedSource;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);
    Promise.all([
      source.loadProfile(),
      source.loadTeam(),
      source.loadNotes(),
      source.loadRetros(),
    ])
      .then(([nextProfile, nextTeam, nextNotes, nextRetros]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setTeam(nextTeam);
        setNotes(nextNotes);
        setRetros(nextRetros);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load your profile.",
        );
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session, source, attempt]);

  // Files reload when the scope changes; the privacy filter lives server-side.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    source
      .loadFiles(scope)
      .then((view) => {
        if (!cancelled) setFilesView(view);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load your files.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, source, scope, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const patchProfile = useCallback(
    async (patch: ProfilePatch) => {
      const next = await source.patchProfile(patch);
      setProfile(next);
      return next;
    },
    [source],
  );

  const createFile = useCallback(
    async (input: NewFileInput) => {
      const result = await source.createFile(input);
      // Refetch so scope filtering stays authoritative (a new private file
      // must not appear in team/shared views).
      setFilesView(await source.loadFiles(scope));
      return result;
    },
    [source, scope],
  );

  const linkFile = useCallback(
    async (fileId: string, link: { entityKind: LinkEntityKind; entityId: string }) => {
      const entry = await source.linkFile(fileId, link);
      setFilesView((current) =>
        current
          ? {
              ...current,
              files: current.files.map((file) =>
                file.id === fileId
                  ? { ...file, links: [...file.links, entry] }
                  : file,
              ),
            }
          : current,
      );
      return entry;
    },
    [source],
  );

  const createNote = useCallback(
    async (input: NewNoteInput) => {
      const note = await source.createNote(input);
      setNotes((current) => [note, ...current]);
      return note;
    },
    [source],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      team,
      filesView,
      notes,
      retros,
      scope,
      setScope,
      status,
      error,
      reload,
      patchProfile,
      createFile,
      linkFile,
      createNote,
    }),
    [
      profile,
      team,
      filesView,
      notes,
      retros,
      scope,
      status,
      error,
      reload,
      patchProfile,
      createFile,
      linkFile,
      createNote,
    ],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
};

export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used inside <ProfileProvider>");
  }
  return context;
};
