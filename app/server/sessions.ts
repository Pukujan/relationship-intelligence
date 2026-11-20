/**
 * RI-0010 conversation storage in the Octo workspace SQL surface.
 *
 * Conversations are principal-private by default; reads return the caller's
 * own plus explicitly shared ones. Every write uses the signed-in principal's
 * token, so Octo enforces membership; the workspace key never appears here.
 */
import { randomUUID } from "node:crypto";
import {
  ConversationSchema,
  MessageSchema,
  sanitizeArtifactHtml,
} from "../shared/session-contracts.js";
import type { OctoClientConfig } from "./octo.js";
import { octoSql } from "./world.js";

type Json = Record<string, unknown>;

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

const owns = (workspaceId: string, principalId: string) =>
  `workspace_id = ${lit(workspaceId)} AND (principal_id = ${lit(principalId)} OR visibility = 'shared')`;

export async function listConversations(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
): Promise<Json[]> {
  // A workspace without the console schema (fresh personal workspace) has no
  // threads yet; read as empty rather than erroring.
  const present = await octoSql(
    config,
    token,
    octoContainerId,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ri_console' AND table_name = 'conversation'",
  );
  if (present.length === 0) return [];
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT id, workspace_id, scope_kind, scope_id, title, created_at, updated_at, archived_at
     FROM ri_console.conversation WHERE ${owns(workspaceId, principalId)}
     ORDER BY updated_at DESC`,
  );
  return rows.map((row) =>
    ConversationSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      scopeKind: row.scope_kind,
      scopeId: row.scope_id ?? null,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? null,
    }),
  );
}

export async function createConversation(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  input: { title: string; scopeKind: string; scopeId?: string | null },
): Promise<Json> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const conversation = ConversationSchema.parse({
    id,
    workspaceId,
    scopeKind: input.scopeKind,
    scopeId: input.scopeId ?? null,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.conversation
       (id, workspace_id, principal_id, visibility, scope_kind, scope_id, title, created_at, updated_at)
     VALUES (${lit(id)}, ${lit(workspaceId)}, ${lit(principalId)}, 'private',
             ${lit(conversation.scopeKind)}, ${lit(conversation.scopeId ?? "")}, ${lit(conversation.title)},
             ${lit(now)}, ${lit(now)})`,
  );
  return conversation;
}

async function assertOwned(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  conversationId: string,
): Promise<void> {
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT id FROM ri_console.conversation WHERE id = ${lit(conversationId)} AND ${owns(workspaceId, principalId)}`,
  );
  if (rows.length === 0) throw new Error("Unknown conversation");
}

export async function getMessages(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  conversationId: string,
): Promise<Json[]> {
  await assertOwned(
    config,
    token,
    octoContainerId,
    workspaceId,
    principalId,
    conversationId,
  );
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT id, role, parts, provider, model, reasoning, created_at
     FROM ri_console.message WHERE conversation_id = ${lit(conversationId)}
     ORDER BY created_at ASC`,
  );
  return rows.map((row) =>
    MessageSchema.parse({
      id: row.id,
      role: row.role,
      parts: row.parts,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      reasoning: row.reasoning ?? undefined,
      createdAt: row.created_at,
    }),
  );
}

export async function appendMessage(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  conversationId: string,
  message: unknown,
): Promise<Json> {
  await assertOwned(
    config,
    token,
    octoContainerId,
    workspaceId,
    principalId,
    conversationId,
  );
  const parsed = MessageSchema.parse(message);
  // Re-sanitize artifacts at the storage boundary, not only in the copilot.
  const parts = parsed.parts.map((part) =>
    part.kind === "artifact"
      ? { ...part, html: sanitizeArtifactHtml(part.html) }
      : part,
  );
  const stored = { ...parsed, parts };
  await octoSql(
    config,
    token,
    octoContainerId,
    `INSERT INTO ri_console.message (id, conversation_id, role, parts, provider, model, reasoning, created_at)
     VALUES (${lit(stored.id)}, ${lit(conversationId)}, ${lit(stored.role)}, ${lit(JSON.stringify(parts))}::jsonb,
             ${lit(stored.provider ?? "")}, ${lit(stored.model ?? "")}, ${lit(stored.reasoning ?? "")}, ${lit(stored.createdAt)})
     ON CONFLICT (id) DO NOTHING`,
  );
  await octoSql(
    config,
    token,
    octoContainerId,
    `UPDATE ri_console.conversation SET updated_at = ${lit(new Date().toISOString())}
     WHERE id = ${lit(conversationId)}`,
  );
  return stored;
}

export async function patchConversation(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  principalId: string,
  conversationId: string,
  patch: {
    title?: string | undefined;
    archived?: boolean | undefined;
    scopeKind?: string | undefined;
    scopeId?: string | null | undefined;
  },
): Promise<Json> {
  await assertOwned(
    config,
    token,
    octoContainerId,
    workspaceId,
    principalId,
    conversationId,
  );
  const sets: string[] = [`updated_at = ${lit(new Date().toISOString())}`];
  if (patch.title !== undefined) sets.push(`title = ${lit(patch.title)}`);
  if (patch.archived !== undefined) {
    sets.push(
      `archived_at = ${patch.archived ? lit(new Date().toISOString()) : "NULL"}`,
    );
  }
  if (patch.scopeKind !== undefined)
    sets.push(`scope_kind = ${lit(patch.scopeKind)}`);
  if (patch.scopeId !== undefined)
    sets.push(`scope_id = ${lit(patch.scopeId ?? "")}`);
  await octoSql(
    config,
    token,
    octoContainerId,
    `UPDATE ri_console.conversation SET ${sets.join(", ")} WHERE id = ${lit(conversationId)}`,
  );
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT id, workspace_id, scope_kind, scope_id, title, created_at, updated_at, archived_at
     FROM ri_console.conversation WHERE id = ${lit(conversationId)}`,
  );
  const row = rows[0];
  if (!row) throw new Error("Unknown conversation");
  return ConversationSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id ?? null,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
  });
}
