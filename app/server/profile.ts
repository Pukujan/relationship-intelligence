/**
 * RI-0010 task C: self/team profile and personal knowledge routes.
 *
 * Authority rules, same contract as world.ts and sessions.ts:
 *  - Every Octo call uses the signed-in principal's session token. The
 *    workspace key never appears here; Octo enforces memberships per person.
 *  - Principal-private by default: profile rows, new files and new notes are
 *    written with visibility 'private' and the caller's principal id. Reads
 *    return the caller's own rows plus explicitly shared ones.
 *  - Privacy rule for scopes: a private row may ONLY appear in the "mine"
 *    scope of its owner. "team" and "shared" scopes filter on
 *    visibility = 'shared', so another principal's private files/notes can
 *    never surface there, even if their id is guessed.
 *  - Octo Files stays canonical for bytes. POST /app-api/files records a
 *    metadata row only and returns an upload hint; nothing here proxies file
 *    content, and file_link rows reference graph entities without copying them.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { OctoClientConfig } from "./octo.js";
import { OctoError } from "./octo.js";
import { octoSql } from "./world.js";

type Json = Record<string, unknown>;

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

const MAX_BODY_BYTES = 8 * 1024;

export interface ProfileRouteContext {
  config: OctoClientConfig;
  /** The signed-in principal's Octo session token. Never the workspace key. */
  token: string;
  /** The app workspace the rows belong to (`workspace_id`). */
  workspaceId: string;
  /** The Octo container the SQL runs in. Every app workspace shares one. */
  octoContainerId: string;
  /**
   * The request body, when the caller has already read it. A request stream
   * can be read once: the adapter reads it to find the workspace, and a
   * second read here never finished, so every POST and PATCH hung.
   */
  body?: Record<string, unknown>;
  principalId: string;
  principal: { id: string; displayName: string };
  workspaces: { id: string; name: string; role?: string }[];
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** Reads and parses a JSON body with the same size cap as the adapter. */
function readJsonBody(req: IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let text = "";
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      text += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve(parsed as Json);
        } else {
          reject(new Error("body must be a JSON object"));
        }
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* Contracts (validated at the trust boundary)                         */
/* ------------------------------------------------------------------ */

const ProfileDocSchema = z.object({
  displayName: z.string().max(120),
  role: z.string().max(120),
  team: z.string().max(120),
  resumeFileId: z.string().max(60).nullable(),
  preferences: z.array(z.string().max(200)).max(24),
  goals: z.array(z.string().max(200)).max(24),
});

/** Only the person themselves may edit these fields, on their own row. */
const ProfilePatchSchema = ProfileDocSchema.partial();

const FileVisibilitySchema = z.enum(["private", "shared"]);
const DocKindSchema = z.enum(["doc", "sheet", "deck", "pdf"]);
const LinkEntityKindSchema = z.enum([
  "person",
  "company",
  "project",
  "event",
  "mission",
]);

const NewFileSchema = z.object({
  name: z.string().min(1).max(200),
  kind: DocKindSchema.default("doc"),
  folderId: z.string().max(60).optional(),
  summary: z.string().max(500).optional(),
  size: z.string().max(40).optional(),
  visibility: FileVisibilitySchema.default("private"),
  personIds: z.array(z.string().max(60)).max(24).default([]),
  projectId: z.string().max(60).optional(),
  /** Set when the bytes already live in Octo Files (upload_file/ingest). */
  octoFileId: z.string().max(120).optional(),
});

const NewLinkSchema = z.object({
  entityKind: LinkEntityKindSchema,
  entityId: z.string().min(1).max(120),
});

const NewNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
  kind: z.enum(["note", "meeting"]).default("note"),
  personIds: z.array(z.string().max(60)).max(24).default([]),
  projectId: z.string().max(60).optional(),
  eventId: z.string().max(60).optional(),
  visibility: FileVisibilitySchema.default("private"),
});

/* ------------------------------------------------------------------ */
/* SQL helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * A workspace without the console schema (fresh personal workspace) reads as
 * empty rather than erroring — same behaviour as sessions.ts. Writes fail
 * loudly so the operator knows to run the bootstrap.
 */
async function tablesPresent(
  ctx: ProfileRouteContext,
  names: string[],
): Promise<Set<string>> {
  const rows = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ri_console'",
  );
  const present = new Set(rows.map((row) => String(row.table_name)));
  return new Set(names.filter((name) => present.has(name)));
}

function requireTables(present: Set<string>, names: string[]): void {
  const missing = names.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `ri_console tables missing (${missing.join(", ")}) — run console/scripts/bootstrap-octo.mjs --apply`,
    );
  }
}

/** Own rows plus explicitly shared ones; never another principal's private. */
const owns = (ctx: ProfileRouteContext) =>
  `workspace_id = ${lit(ctx.workspaceId)} AND (principal_id = ${lit(ctx.principalId)} OR visibility = 'shared')`;

/* ------------------------------------------------------------------ */
/* Profile (self doc)                                                  */
/* ------------------------------------------------------------------ */

async function readProfile(ctx: ProfileRouteContext): Promise<Json> {
  const present = await tablesPresent(ctx, ["profile"]);
  if (!present.has("profile")) {
    // No schema yet: hand back an unsaved empty doc so the page can render.
    return emptyProfile(ctx);
  }
  const rows = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `SELECT doc FROM ri_console.profile
     WHERE workspace_id = ${lit(ctx.workspaceId)} AND principal_id = ${lit(ctx.principalId)}`,
  );
  const doc = rows[0]?.doc;
  if (doc && typeof doc === "object") return doc as Json;
  // First visit: create the empty self row, private to this principal.
  const fresh = emptyProfile(ctx);
  await upsertProfile(ctx, fresh);
  return fresh;
}

function emptyProfile(ctx: ProfileRouteContext): Json {
  return {
    id: `profile-${ctx.principalId}`,
    workspaceId: ctx.workspaceId,
    principalId: ctx.principalId,
    displayName: ctx.principal.displayName,
    role: "",
    team: "",
    resumeFileId: null,
    preferences: [],
    goals: [],
    updatedAt: new Date().toISOString(),
  };
}

async function upsertProfile(
  ctx: ProfileRouteContext,
  doc: Json,
): Promise<void> {
  await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `INSERT INTO ri_console.profile (id, workspace_id, principal_id, doc, updated_at)
     VALUES (${lit(doc.id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)},
             ${lit(JSON.stringify(doc))}::jsonb, ${lit(new Date().toISOString())})
     ON CONFLICT (workspace_id, principal_id)
     DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
  );
}

async function patchProfile(
  ctx: ProfileRouteContext,
  body: Json,
): Promise<Json> {
  const patch = ProfilePatchSchema.parse(body);
  const current = await readProfile(ctx);
  const present = await tablesPresent(ctx, ["profile"]);
  requireTables(present, ["profile"]);
  const next = ProfileDocSchema.parse({
    displayName:
      patch.displayName !== undefined ? patch.displayName : current.displayName,
    role: patch.role !== undefined ? patch.role : current.role,
    team: patch.team !== undefined ? patch.team : current.team,
    resumeFileId:
      patch.resumeFileId !== undefined
        ? patch.resumeFileId
        : current.resumeFileId,
    preferences:
      patch.preferences !== undefined ? patch.preferences : current.preferences,
    goals: patch.goals !== undefined ? patch.goals : current.goals,
  });
  const doc: Json = {
    ...current,
    ...next,
    id: `profile-${ctx.principalId}`,
    workspaceId: ctx.workspaceId,
    principalId: ctx.principalId,
    updatedAt: new Date().toISOString(),
  };
  await upsertProfile(ctx, doc);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Team directory (Octo principals + workspace roles)                  */
/* ------------------------------------------------------------------ */

interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isSelf: boolean;
}

/** octoFetch-style GET with the principal token; 404s are recoverable here. */
async function octoGet(
  ctx: ProfileRouteContext,
  path: string,
): Promise<unknown> {
  const response = await fetch(new URL(path, ctx.config.baseUrl), {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(ctx.config.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for ${path}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OctoError(response.status, `Octo returned non-JSON for ${path}`);
  }
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** Normalize the several shapes a members endpoint may answer with. */
function normalizeMembers(
  payload: unknown,
  ctx: ProfileRouteContext,
): TeamMember[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Array.isArray((payload as Json).members)
        ? ((payload as Json).members as unknown[])
        : Array.isArray((payload as Json).items)
          ? ((payload as Json).items as unknown[])
          : []
      : [];
  const members: TeamMember[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Json;
    const principal =
      row.principal && typeof row.principal === "object"
        ? (row.principal as Json)
        : row;
    const id = asString(principal.id, asString(row.principalId));
    if (!id) continue;
    members.push({
      id,
      displayName: asString(
        principal.displayName,
        asString(principal.name, asString(principal.email, "Teammate")),
      ),
      email: asString(principal.email),
      role: asString(row.role, asString(principal.role, "member")),
      isSelf: id === ctx.principalId,
    });
  }
  return members;
}

async function readTeam(ctx: ProfileRouteContext): Promise<TeamMember[]> {
  // Octo is authoritative for principals and roles. Try the workspace-scoped
  // members route first, then the flat one; if neither exists on this Octo
  // build, fall back to the caller's own membership (from /api/workspaces)
  // rather than inventing teammates.
  let members: TeamMember[] = [];
  for (const path of [
    `/api/workspaces/${ctx.workspaceId}/members`,
    `/api/members?workspaceId=${encodeURIComponent(ctx.workspaceId)}`,
  ]) {
    try {
      members = normalizeMembers(await octoGet(ctx, path), ctx);
      if (members.length > 0) break;
    } catch (error) {
      if (
        error instanceof OctoError &&
        (error.status === 404 || error.status === 405)
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!members.some((member) => member.isSelf)) {
    const own = ctx.workspaces.find((w) => w.id === ctx.workspaceId);
    members.unshift({
      id: ctx.principalId,
      displayName: ctx.principal.displayName,
      email: "",
      role: own?.role ?? "member",
      isSelf: true,
    });
  }
  return members;
}

/* ------------------------------------------------------------------ */
/* Files & folders (metadata; bytes stay canonical in Octo Files)      */
/* ------------------------------------------------------------------ */

type FileScope = "mine" | "team" | "shared";

/**
 * The privacy rule, in SQL:
 *  - mine:   the caller's own rows, private or shared.
 *  - team:   explicitly shared rows from anyone in the workspace.
 *  - shared: explicitly shared rows from OTHER principals.
 * Private rows never match team/shared, so they cannot leak across principals.
 */
function scopeFilter(ctx: ProfileRouteContext, scope: FileScope): string {
  if (scope === "mine") return `principal_id = ${lit(ctx.principalId)}`;
  if (scope === "shared") {
    return `visibility = 'shared' AND principal_id <> ${lit(ctx.principalId)}`;
  }
  return `visibility = 'shared'`;
}

async function readFiles(
  ctx: ProfileRouteContext,
  scope: FileScope,
): Promise<Json> {
  const present = await tablesPresent(ctx, ["folder", "file_doc", "file_link"]);
  if (!present.has("file_doc")) {
    return { scope, folders: [], files: [] };
  }
  const filter = scopeFilter(ctx, scope);
  const [folderRows, fileRows, linkRows] = await Promise.all([
    present.has("folder")
      ? octoSql(
          ctx.config,
          ctx.token,
          ctx.octoContainerId,
          `SELECT doc FROM ri_console.folder
           WHERE workspace_id = ${lit(ctx.workspaceId)} AND ${filter}
           ORDER BY updated_at DESC`,
        )
      : Promise.resolve([] as Json[]),
    octoSql(
      ctx.config,
      ctx.token,
      ctx.octoContainerId,
      `SELECT doc, principal_id, visibility FROM ri_console.file_doc
       WHERE workspace_id = ${lit(ctx.workspaceId)} AND ${filter}
       ORDER BY updated_at DESC`,
    ),
    present.has("file_link")
      ? octoSql(
          ctx.config,
          ctx.token,
          ctx.octoContainerId,
          `SELECT id, file_id, entity_kind, entity_id, principal_id
           FROM ri_console.file_link WHERE workspace_id = ${lit(ctx.workspaceId)}`,
        )
      : Promise.resolve([] as Json[]),
  ]);
  const linksByFile = new Map<string, Json[]>();
  for (const row of linkRows) {
    const fileId = String(row.file_id);
    const link: Json = {
      id: String(row.id),
      fileId,
      entityKind: String(row.entity_kind),
      entityId: String(row.entity_id),
      principalId: String(row.principal_id),
    };
    linksByFile.set(fileId, [...(linksByFile.get(fileId) ?? []), link]);
  }
  const files = fileRows.map((row) => {
    const doc = (row.doc ?? {}) as Json;
    return {
      ...doc,
      principalId: String(row.principal_id ?? ""),
      visibility: String(row.visibility ?? "private"),
      // Links only ride along on files the caller may see (filter above).
      links: linksByFile.get(String(doc.id)) ?? [],
    };
  });
  return {
    scope,
    folders: folderRows.map((row) => row.doc as Json),
    files,
  };
}

async function createFile(ctx: ProfileRouteContext, body: Json): Promise<Json> {
  const input = NewFileSchema.parse(body);
  const present = await tablesPresent(ctx, ["file_doc"]);
  requireTables(present, ["file_doc"]);
  const id = randomUUID();
  const now = new Date().toISOString();
  // Private by default: a new file is the caller's until they share it.
  const doc: Json = {
    id,
    folderId: input.folderId ?? "",
    name: input.name,
    kind: input.kind,
    size: input.size ?? "—",
    updatedAt: now,
    owner: ctx.principal.displayName,
    summary: input.summary ?? "",
    personIds: input.personIds,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.octoFileId !== undefined ? { octoFileId: input.octoFileId } : {}),
  };
  await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `INSERT INTO ri_console.file_doc (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)},
             ${lit(input.visibility)}, ${lit(JSON.stringify(doc))}::jsonb)`,
  );
  return {
    file: {
      ...doc,
      principalId: ctx.principalId,
      visibility: input.visibility,
      links: [],
    },
    // Metadata-only by design: Octo Files is canonical for bytes. The browser
    // cannot call Octo directly (the token is server-only), so this is a hint
    // for the operator/agent, not a usable upload endpoint for the page.
    uploadUrl: "/api/files",
    uploadNote:
      "Bytes live in Octo Files, not here. Upload via MCP upload_file / ingest_document (or Octo REST /api/files) with your principal token, then set octoFileId on this row.",
  };
}

async function linkFile(
  ctx: ProfileRouteContext,
  fileId: string,
  body: Json,
): Promise<Json> {
  const input = NewLinkSchema.parse(body);
  const present = await tablesPresent(ctx, ["file_doc", "file_link"]);
  requireTables(present, ["file_doc", "file_link"]);
  // The caller must be able to see the file (own or shared) before linking.
  const rows = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `SELECT id FROM ri_console.file_doc
     WHERE id = ${lit(fileId)} AND workspace_id = ${lit(ctx.workspaceId)}
       AND (principal_id = ${lit(ctx.principalId)} OR visibility = 'shared')`,
  );
  if (rows.length === 0) throw new Error("Unknown file");
  const existing = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `SELECT id, file_id, entity_kind, entity_id, principal_id
     FROM ri_console.file_link
     WHERE workspace_id = ${lit(ctx.workspaceId)} AND file_id = ${lit(fileId)}
       AND entity_kind = ${lit(input.entityKind)} AND entity_id = ${lit(input.entityId)}
       AND principal_id = ${lit(ctx.principalId)}`,
  );
  const found = existing[0];
  if (found) {
    return {
      link: {
        id: String(found.id),
        fileId: String(found.file_id),
        entityKind: String(found.entity_kind),
        entityId: String(found.entity_id),
        principalId: String(found.principal_id),
      },
    };
  }
  const id = randomUUID();
  await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `INSERT INTO ri_console.file_link (id, workspace_id, file_id, entity_kind, entity_id, principal_id)
     VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(fileId)},
             ${lit(input.entityKind)}, ${lit(input.entityId)}, ${lit(ctx.principalId)})`,
  );
  return {
    link: {
      id,
      fileId,
      entityKind: input.entityKind,
      entityId: input.entityId,
      principalId: ctx.principalId,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Notes & retrospectives                                              */
/* ------------------------------------------------------------------ */

async function readNotes(ctx: ProfileRouteContext): Promise<Json[]> {
  const present = await tablesPresent(ctx, ["note"]);
  if (!present.has("note")) return [];
  const rows = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `SELECT doc FROM ri_console.note WHERE ${owns(ctx)} ORDER BY updated_at DESC`,
  );
  return rows.map((row) => row.doc as Json);
}

async function createNote(ctx: ProfileRouteContext, body: Json): Promise<Json> {
  const input = NewNoteSchema.parse(body);
  const present = await tablesPresent(ctx, ["note"]);
  requireTables(present, ["note"]);
  const id = randomUUID();
  // Private by default: notes are the person's record until shared.
  const doc: Json = {
    id,
    title: input.title,
    kind: input.kind,
    at: new Date().toISOString(),
    body: input.body,
    personIds: input.personIds,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
  };
  await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `INSERT INTO ri_console.note (id, workspace_id, principal_id, visibility, doc)
     VALUES (${lit(id)}, ${lit(ctx.workspaceId)}, ${lit(ctx.principalId)},
             ${lit(input.visibility)}, ${lit(JSON.stringify(doc))}::jsonb)`,
  );
  return doc;
}

async function readRetros(ctx: ProfileRouteContext): Promise<Json[]> {
  const present = await tablesPresent(ctx, ["retrospective"]);
  if (!present.has("retrospective")) return [];
  const rows = await octoSql(
    ctx.config,
    ctx.token,
    ctx.octoContainerId,
    `SELECT doc FROM ri_console.retrospective WHERE ${owns(ctx)} ORDER BY updated_at DESC`,
  );
  return rows.map((row) => row.doc as Json);
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

const PROFILE_PATHS = new Set([
  "/app-api/profile",
  "/app-api/team",
  "/app-api/files",
  "/app-api/notes",
  "/app-api/retros",
]);

/**
 * Handles the task-C routes. Returns true when the request was answered.
 * Mount inside the adapter's authenticated world-route block; OctoError
 * 401/403 is re-thrown so the adapter's existing catch destroys the dead
 * session, exactly like the other world routes.
 */
export async function handleProfileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ProfileRouteContext,
): Promise<boolean> {
  const path = url.pathname;
  const linkMatch = path.match(/^\/app-api\/files\/([^/]+)\/link$/);
  if (!PROFILE_PATHS.has(path) && !linkMatch) return false;

  const method = req.method ?? "GET";
  try {
    let body: Json = {};
    if (method === "POST" || method === "PATCH") {
      body = (ctx.body as Json | undefined) ?? (await readJsonBody(req));
    }
    // The caller may target any workspace they are a member of; anything
    // else falls back to the adapter-resolved workspace. Membership is
    // checked here as well as by Octo on every query.
    const requested =
      (method === "GET"
        ? url.searchParams.get("workspaceId")
        : typeof body.workspaceId === "string"
          ? body.workspaceId
          : url.searchParams.get("workspaceId")) ?? ctx.workspaceId;
    if (ctx.workspaces.some((workspace) => workspace.id === requested)) {
      ctx = { ...ctx, workspaceId: requested };
    }

    if (path === "/app-api/profile") {
      if (method === "GET") {
        sendJson(res, 200, await readProfile(ctx));
        return true;
      }
      if (method === "PATCH") {
        sendJson(res, 200, await patchProfile(ctx, body));
        return true;
      }
    }
    if (path === "/app-api/team" && method === "GET") {
      sendJson(res, 200, await readTeam(ctx));
      return true;
    }
    if (path === "/app-api/files") {
      if (method === "GET") {
        const raw = url.searchParams.get("scope") ?? "mine";
        const scope: FileScope =
          raw === "team" || raw === "shared" ? raw : "mine";
        sendJson(res, 200, await readFiles(ctx, scope));
        return true;
      }
      if (method === "POST") {
        sendJson(res, 200, await createFile(ctx, body));
        return true;
      }
    }
    if (linkMatch && method === "POST") {
      sendJson(res, 200, await linkFile(ctx, linkMatch[1] ?? "", body));
      return true;
    }
    if (path === "/app-api/notes") {
      if (method === "GET") {
        sendJson(res, 200, await readNotes(ctx));
        return true;
      }
      if (method === "POST") {
        sendJson(res, 200, await createNote(ctx, body));
        return true;
      }
    }
    if (path === "/app-api/retros" && method === "GET") {
      sendJson(res, 200, await readRetros(ctx));
      return true;
    }
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(res, 400, {
        error: "BAD_REQUEST",
        detail: error.issues.map((issue) => issue.message).join("; "),
      });
      return true;
    }
    // Let the adapter's world-route catch handle dead sessions (401/403) so
    // the cookie is destroyed in exactly one place.
    if (
      error instanceof OctoError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error;
    }
    console.error(
      "profile route failed:",
      path,
      error instanceof Error ? error.message : "unknown",
    );
    sendJson(res, 502, {
      error: "PROFILE_ROUTE_FAILED",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return true;
  }
}
