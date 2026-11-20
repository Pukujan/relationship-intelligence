import { z } from "zod";
import type { DocKind, FileDoc, Folder, Note, NoteKind, Retrospective } from "./types";
export type { DocKind, FileDoc, Folder, Note, NoteKind, Retrospective };

/**
 * RI-0010 task C contracts: the self profile, team directory, and personal
 * knowledge (files & folders, notes, retros).
 *
 * Same pattern as sessionTypes.ts: the console tsconfig is non-strict, which
 * collapses zod-inferred unions, so every schema is paired with an explicit
 * interface and cast to `z.ZodType<T>`. Validation still happens at runtime —
 * these payloads cross the adapter trust boundary.
 *
 * Privacy: `visibility` is enforced server-side. A private file or note only
 * ever appears in its owner's "mine" scope; the console must never offer a
 * control that lists another principal's private rows.
 */

/* ------------------------------------------------------------------ */
/* Self profile                                                        */
/* ------------------------------------------------------------------ */

const SelfProfileSchemaRaw = z.object({
  id: z.string().max(120),
  workspaceId: z.string().max(60),
  principalId: z.string().max(60),
  displayName: z.string().max(120),
  role: z.string().max(120),
  team: z.string().max(120),
  resumeFileId: z.string().max(60).nullable(),
  preferences: z.array(z.string().max(200)).max(24),
  goals: z.array(z.string().max(200)).max(24),
  updatedAt: z.string().max(40),
});
export const SelfProfileSchema = SelfProfileSchemaRaw as unknown as z.ZodType<SelfProfile>;

export interface SelfProfile {
  id: string;
  workspaceId: string;
  principalId: string;
  displayName: string;
  role: string;
  team: string;
  /** Metadata row id; the bytes themselves are canonical in Octo Files. */
  resumeFileId: string | null;
  preferences: string[];
  goals: string[];
  updatedAt: string;
}

const ProfilePatchSchemaRaw = z.object({
  displayName: z.string().max(120).optional(),
  role: z.string().max(120).optional(),
  team: z.string().max(120).optional(),
  resumeFileId: z.string().max(60).nullable().optional(),
  preferences: z.array(z.string().max(200)).max(24).optional(),
  goals: z.array(z.string().max(200)).max(24).optional(),
});
export const ProfilePatchSchema = ProfilePatchSchemaRaw as unknown as z.ZodType<ProfilePatch>;

export interface ProfilePatch {
  displayName?: string;
  role?: string;
  team?: string;
  resumeFileId?: string | null;
  preferences?: string[];
  goals?: string[];
}

/* ------------------------------------------------------------------ */
/* Team directory                                                      */
/* ------------------------------------------------------------------ */

const TeamMemberSchemaRaw = z.object({
  id: z.string().max(60),
  displayName: z.string().max(120),
  email: z.string().max(200),
  role: z.string().max(60),
  isSelf: z.boolean(),
});
export const TeamMemberSchema = TeamMemberSchemaRaw as unknown as z.ZodType<TeamMember>;

/** A real Octo principal with their workspace role — never a graph contact. */
export interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isSelf: boolean;
}

/* ------------------------------------------------------------------ */
/* Files & folders                                                     */
/* ------------------------------------------------------------------ */

export type FileScope = "mine" | "team" | "shared";
export type FileVisibility = "private" | "shared";
export type LinkEntityKind = "person" | "company" | "project" | "event" | "mission";

const FileLinkSchemaRaw = z.object({
  id: z.string().max(60),
  fileId: z.string().max(60),
  entityKind: z.enum(["person", "company", "project", "event", "mission"]),
  entityId: z.string().max(120),
  principalId: z.string().max(60),
});
export const FileLinkSchema = FileLinkSchemaRaw as unknown as z.ZodType<FileLink>;

/** A reference to a canonical graph entity; links never copy the entity. */
export interface FileLink {
  id: string;
  fileId: string;
  entityKind: LinkEntityKind;
  entityId: string;
  principalId: string;
}

const ProfileFileSchemaRaw = z.object({
  id: z.string().max(60),
  folderId: z.string().max(60),
  name: z.string().max(200),
  kind: z.enum(["doc", "sheet", "deck", "pdf"]),
  size: z.string().max(40),
  updatedAt: z.string().max(40),
  owner: z.string().max(120),
  summary: z.string().max(500),
  personIds: z.array(z.string().max(60)).max(24),
  projectId: z.string().max(60).optional(),
  octoFileId: z.string().max(120).optional(),
  principalId: z.string().max(60),
  visibility: z.enum(["private", "shared"]),
  links: z.array(FileLinkSchema).max(48),
});
export const ProfileFileSchema = ProfileFileSchemaRaw as unknown as z.ZodType<ProfileFile>;

/** A file metadata row plus its ownership, visibility, and entity links. */
export interface ProfileFile extends FileDoc {
  principalId: string;
  visibility: FileVisibility;
  links: FileLink[];
  /** Present once the bytes have been uploaded to Octo Files. */
  octoFileId?: string;
}

const FilesViewSchemaRaw = z.object({
  scope: z.enum(["mine", "team", "shared"]),
  folders: z.array(
    z.object({
      id: z.string().max(60),
      name: z.string().max(120),
      parentId: z.string().max(60).nullable(),
    }),
  ).max(200),
  files: z.array(ProfileFileSchema).max(500),
});
export const FilesViewSchema = FilesViewSchemaRaw as unknown as z.ZodType<FilesView>;

export interface FilesView {
  scope: FileScope;
  folders: Folder[];
  files: ProfileFile[];
}

const NewFileInputSchemaRaw = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["doc", "sheet", "deck", "pdf"]).optional(),
  folderId: z.string().max(60).optional(),
  summary: z.string().max(500).optional(),
  size: z.string().max(40).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  personIds: z.array(z.string().max(60)).max(24).optional(),
  projectId: z.string().max(60).optional(),
  octoFileId: z.string().max(120).optional(),
});
export const NewFileInputSchema = NewFileInputSchemaRaw as unknown as z.ZodType<NewFileInput>;

export interface NewFileInput {
  name: string;
  kind?: DocKind;
  folderId?: string;
  summary?: string;
  size?: string;
  /** Defaults to private server-side; sharing is an explicit choice. */
  visibility?: FileVisibility;
  personIds?: string[];
  projectId?: string;
  octoFileId?: string;
}

const FileUploadResultSchemaRaw = z.object({
  file: ProfileFileSchema,
  uploadUrl: z.string().max(300),
  uploadNote: z.string().max(500),
});
export const FileUploadResultSchema = FileUploadResultSchemaRaw as unknown as z.ZodType<FileUploadResult>;

/** Metadata row created; the note explains where the bytes must go (Octo). */
export interface FileUploadResult {
  file: ProfileFile;
  uploadUrl: string;
  uploadNote: string;
}

/* ------------------------------------------------------------------ */
/* Notes & retros                                                      */
/* ------------------------------------------------------------------ */

const NewNoteInputSchemaRaw = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
  kind: z.enum(["note", "meeting"]).optional(),
  personIds: z.array(z.string().max(60)).max(24).optional(),
  projectId: z.string().max(60).optional(),
  eventId: z.string().max(60).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});
export const NewNoteInputSchema = NewNoteInputSchemaRaw as unknown as z.ZodType<NewNoteInput>;

export interface NewNoteInput {
  title: string;
  body: string;
  kind?: NoteKind;
  personIds?: string[];
  projectId?: string;
  eventId?: string;
  /** Defaults to private server-side. */
  visibility?: FileVisibility;
}

const NoteSchemaRaw = z.object({
  id: z.string().max(60),
  title: z.string().max(200),
  kind: z.enum(["note", "meeting"]),
  at: z.string().max(40),
  body: z.string().max(20_000),
  personIds: z.array(z.string().max(60)).max(24),
  projectId: z.string().max(60).optional(),
  eventId: z.string().max(60).optional(),
  agentId: z.string().max(60).optional(),
});
export const NoteSchema = NoteSchemaRaw as unknown as z.ZodType<Note>;

const RetroSchemaRaw = z.object({
  id: z.string().max(60),
  month: z.string().max(40),
  title: z.string().max(200),
  summary: z.string().max(2000),
  wins: z.array(z.string().max(500)).max(24),
  misses: z.array(z.string().max(500)).max(24),
  decisions: z.array(z.string().max(500)).max(24),
  metrics: z.array(
    z.object({
      label: z.string().max(80),
      value: z.string().max(40),
      delta: z.string().max(80),
    }),
  ).max(12),
});
export const RetroSchema = RetroSchemaRaw as unknown as z.ZodType<Retrospective>;
