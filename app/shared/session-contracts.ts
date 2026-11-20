/**
 * RI-0010 session contracts, adapter side. Mirrors
 * console/src/data/sessionTypes.ts; the adapter re-validates every part before
 * storage so a compromised or buggy client cannot persist unvalidated output.
 */
import { z } from "zod";

export const EvidenceSchema = z.object({
  label: z.string().max(120),
  detail: z.string().max(300),
});

export const PartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().max(4000),
    evidence: z.array(EvidenceSchema).max(6).optional(),
  }),
  z.object({
    kind: z.literal("table"),
    columns: z.array(z.string().max(60)).min(1).max(8),
    rows: z.array(z.array(z.string().max(200)).max(8)).max(20),
    evidence: z.array(EvidenceSchema).max(6).optional(),
  }),
  z.object({
    kind: z.literal("kpi"),
    label: z.string().max(80),
    value: z.string().max(40),
    delta: z.string().max(40).optional(),
    direction: z.enum(["up", "down", "flat"]).optional(),
  }),
  z.object({
    kind: z.literal("sparkline"),
    label: z.string().max(80),
    series: z.array(z.number()).min(2).max(40),
  }),
  z.object({
    kind: z.literal("graph"),
    nodes: z
      .array(
        z.object({
          id: z.string().max(60),
          label: z.string().max(80),
          kind: z.string().max(20),
        }),
      )
      .max(10),
    edges: z
      .array(
        z.object({
          from: z.string().max(60),
          to: z.string().max(60),
          label: z.string().max(60),
        }),
      )
      .max(12),
    evidence: z.array(EvidenceSchema).max(6).optional(),
  }),
  z.object({
    kind: z.literal("timeline"),
    entries: z
      .array(
        z.object({
          at: z.string().max(40),
          label: z.string().max(120),
          detail: z.string().max(200).optional(),
        }),
      )
      .max(12),
  }),
  z.object({
    kind: z.literal("proposal"),
    design: z.unknown(),
    evidence: z.array(EvidenceSchema).max(6).optional(),
  }),
  z.object({
    kind: z.literal("approval"),
    approvalId: z.string().max(60),
  }),
  z.object({
    kind: z.literal("actions"),
    actions: z.array(z.unknown()).max(8),
  }),
  z.object({
    kind: z.literal("artifact"),
    title: z.string().max(120),
    html: z.string().max(20000),
    sources: z.array(EvidenceSchema).max(8).optional(),
  }),
  z.object({
    kind: z.literal("image"),
    // https only: no javascript:, no data:, no http downgrade. The renderer
    // re-checks and sends no referrer, so third-party hosts learn nothing
    // about the console URL or the principal.
    url: z
      .string()
      .max(2000)
      .refine(
        (value) => {
          try {
            return new URL(value).protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: "image url must be a valid https URL" },
      ),
    alt: z.string().max(200),
    caption: z.string().max(300).optional(),
    sources: z.array(EvidenceSchema).max(8).optional(),
  }),
  z.object({
    kind: z.literal("mermaid"),
    title: z.string().max(120),
    source: z.string().max(4000),
    sources: z.array(EvidenceSchema).max(8).optional(),
  }),
  z.object({
    kind: z.literal("tree"),
    title: z.string().max(120),
    nodes: z
      .array(
        z.object({
          id: z.string().max(60),
          label: z.string().max(120),
          children: z.array(z.string().max(60)).max(20).optional(),
        }),
      )
      .max(60),
  }),
]);

export const MessageSchema = z.object({
  id: z.string().max(60),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(PartSchema).max(12),
  provider: z.string().max(40).optional(),
  model: z.string().max(80).optional(),
  reasoning: z.string().max(10).optional(),
  createdAt: z.string().max(40),
});

export const ConversationSchema = z.object({
  id: z.string().max(60),
  workspaceId: z.string().max(60),
  scopeKind: z.enum(["workspace", "project", "person", "mission"]),
  scopeId: z.string().max(60).nullable(),
  title: z.string().max(120),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  archivedAt: z.string().max(40).nullable().optional(),
});

export const sanitizeArtifactHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "");

/**
 * Strip active content from model-produced mermaid source before storage.
 * Backticks and script sequences are the obvious srcDoc-breakout vectors;
 * removing them keeps the stored source inert. Rendering still happens in an
 * opaque-origin sandbox (iframe sandbox="allow-scripts", NO allow-same-origin),
 * so even a bypass cannot reach console storage, cookies, or the parent DOM.
 * Mirrored in console/src/data/sessionTypes.ts — keep the two identical.
 */
export const sanitizeMermaidSource = (source: string): string =>
  source
    .replace(/`/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "")
    .replace(/-->/g, "");
