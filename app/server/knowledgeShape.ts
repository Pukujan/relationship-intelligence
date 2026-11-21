/**
 * The shape the console needs from every knowledge row (files & notes).
 *
 * The Profile page loads /app-api/files and /app-api/notes and validates them
 * with zod (console/src/data/profileTypes.ts). Files and notes imported from
 * connectors (Google Drive, videos, meeting notes) were saved with only the
 * connector's own keys — `url`, `mimeType`, `title` — and no `folderId`,
 * `kind`, `size`, `owner`, `summary`, `personIds` or note `at`. The contract
 * is strict, so two such rows made the whole profile payload fail validation
 * and the page answered "Profile didn't load" with the raw zod issue list.
 *
 * `completeFileDoc` / `completeNoteDoc` fill the missing fields on read,
 * which also repairs rows saved before this existed — the same pattern as
 * completeAgentDoc in agentShape.ts.
 */

const text = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const KINDS = ["doc", "sheet", "deck", "pdf"] as const;
type DocKind = (typeof KINDS)[number];

const EXTENSION_KIND: Record<string, DocKind> = {
  pdf: "pdf",
  csv: "sheet",
  xls: "sheet",
  xlsx: "sheet",
  numbers: "sheet",
  ppt: "deck",
  pptx: "deck",
  key: "deck",
};

const isDocKind = (value: unknown): value is DocKind =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);

/** Best-effort doc kind from an explicit key, the stored extension, or MIME. */
function kindOf(doc: Record<string, unknown>): DocKind {
  if (isDocKind(doc.kind)) return doc.kind;
  const name = typeof doc.name === "string" ? doc.name : "";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = EXTENSION_KIND[extension];
  if (byExtension) return byExtension;
  const mime = typeof doc.mimeType === "string" ? doc.mimeType : "";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("spreadsheet")) return "sheet";
  if (mime.includes("presentation")) return "deck";
  return "doc";
}

export function completeFileDoc<T extends Record<string, unknown>>(
  doc: T,
  fallbackOwner: string,
): T & Record<string, unknown> {
  return {
    ...doc,
    // An imported folder-less file lands at the root, not in a phantom folder.
    folderId: typeof doc.folderId === "string" ? doc.folderId : "",
    kind: kindOf(doc),
    size: text(doc.size, "—"),
    owner: text(doc.owner, fallbackOwner),
    summary: text(doc.summary, text(doc.description, "")),
    personIds: Array.isArray(doc.personIds) ? doc.personIds : [],
    updatedAt: text(
      doc.updatedAt,
      text(doc.createdAt, new Date(0).toISOString()),
    ),
  };
}

export function completeNoteDoc<T extends Record<string, unknown>>(
  doc: T,
): T & Record<string, unknown> {
  return {
    ...doc,
    title: text(doc.title, text(doc.name, "Untitled note")),
    kind: doc.kind === "meeting" ? "meeting" : "note",
    at: text(doc.at, text(doc.updatedAt, new Date(0).toISOString())),
    body: typeof doc.body === "string" ? doc.body : "",
    personIds: Array.isArray(doc.personIds) ? doc.personIds : [],
  };
}
