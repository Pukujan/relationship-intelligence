import { describe, expect, it, vi } from "vitest";
import { completeFileDoc, completeNoteDoc } from "../server/knowledgeShape.js";
import { handleProfileRoutes } from "../server/profile.js";

/**
 * Regression: the Profile page answered "Profile didn't load" with a raw zod
 * issue list because two connector-imported file rows (a Drive folder and an
 * mp4) and one meeting note carried none of the contract's keys. These are
 * the real production shapes; every field must be filled on read.
 */

const CONTRACT_FIELDS = [
  "folderId",
  "kind",
  "size",
  "owner",
  "summary",
  "personIds",
  "updatedAt",
  "name",
  "id",
] as const;

const driveFolder = {
  id: "file-geoai-2026-submission",
  url: "https://drive.google.com/drive/folders/1Id75VLFw7vYk8KeZ6zeajGQ6Ubjiymry",
  name: "GeoAI-2026-submission (Google Drive)",
  mimeType: "application/vnd.google-apps.folder",
  projectId: "proj-nyc-map-mta-navilens",
  updatedAt: "2026-11-14T20:25:43.000Z",
  workspaceId: "ws-1",
};

const video = {
  id: "file-level5-walk-blurred",
  name: "Level5_walk_faces_blurred.mp4 (14th St Station)",
  mimeType: "video/mp4",
  projectId: "proj-nyc-map-mta-navilens",
  updatedAt: "2026-11-18T14:25:00.000Z",
  workspaceId: "ws-1",
};

const meetingNote = {
  id: "note-jenny-mta-navilens-2026-11-19",
  body: "Sources: Discord DM, Gmail, Google Drive.",
  title: "NYU GIS Day, MTA NaviLens & LinkedIn Signals",
  projectId: "proj-nyc-map-mta-navilens",
  updatedAt: "2026-11-20T15:47:00.000Z",
  workspaceId: "ws-1",
};

describe("knowledge rows are completed to the console contract", () => {
  it("fills every contract field on a connector-imported file", () => {
    const file = completeFileDoc(driveFolder, "Pujan Bajracharya");
    for (const field of CONTRACT_FIELDS) expect(file).toHaveProperty(field);
    expect(file.folderId).toBe("");
    expect(file.kind).toBe("doc");
    expect(file.size).toBe("—");
    expect(file.owner).toBe("Pujan Bajracharya");
    expect(file.personIds).toEqual([]);
    expect(file.summary).toBe("");
    // Connector keys survive so the row still points at its source.
    expect(file.url).toBe(driveFolder.url);
    expect(file.mimeType).toBe(driveFolder.mimeType);
  });

  it("keeps an explicit kind and derives none from a video", () => {
    const file = completeFileDoc(video, "Owner");
    expect(file.kind).toBe("doc");
    expect(completeFileDoc({ kind: "pdf" }, "Owner").kind).toBe("pdf");
    expect(completeFileDoc({ name: "a.xlsx" }, "Owner").kind).toBe("sheet");
    expect(completeFileDoc({ name: "a.pptx" }, "Owner").kind).toBe("deck");
    expect(completeFileDoc({ mimeType: "application/pdf" }, "Owner").kind).toBe(
      "pdf",
    );
  });

  it("fills a note's kind, at, and personIds from its updatedAt", () => {
    const note = completeNoteDoc(meetingNote);
    expect(note.kind).toBe("note");
    expect(note.at).toBe(meetingNote.updatedAt);
    expect(note.personIds).toEqual([]);
    expect(note.body).toBe(meetingNote.body);
    expect(completeNoteDoc({ kind: "meeting" }).kind).toBe("meeting");
  });

  it("serves a payload the console accepts over /app-api/files and /app-api/notes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const sql = String(
          (JSON.parse(String(init?.body ?? "{}")) as { sql?: string }).sql ??
            "",
        );
        const rows = sql.includes("information_schema.tables")
          ? [
              { table_name: "folder" },
              { table_name: "file_doc" },
              { table_name: "file_link" },
              { table_name: "note" },
            ]
          : sql.includes("ri_console.file_doc")
            ? [
                { doc: driveFolder, principal_id: "p1", visibility: "shared" },
                { doc: video, principal_id: "p1", visibility: "shared" },
              ]
            : sql.includes("ri_console.note")
              ? [{ doc: meetingNote }]
              : [];
        return new Response(JSON.stringify({ rows }), { status: 200 });
      }),
    );
    try {
      const ctx = {
        config: { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        token: "principal-token",
        workspaceId: "ws-1",
        octoContainerId: "ws-1",
        principalId: "p1",
        principal: { id: "p1", displayName: "Pujan Bajracharya" },
        workspaces: [{ id: "ws-1", name: "Design Bakery" }],
      };
      const call = async (path: string) => {
        const sent: { status: number; body: string } = {
          status: 0,
          body: "",
        };
        const res = {
          writeHead: (status: number) => {
            sent.status = status;
          },
          end: (body: string) => {
            sent.body = body;
          },
        } as unknown as Parameters<typeof handleProfileRoutes>[1];
        const handled = await handleProfileRoutes(
          { method: "GET", headers: {} } as Parameters<
            typeof handleProfileRoutes
          >[0],
          res,
          new URL(`https://app.example.test${path}`),
          ctx,
        );
        expect(handled).toBe(true);
        expect(sent.status).toBe(200);
        return JSON.parse(sent.body) as Record<string, unknown>;
      };

      const files = (await call("/app-api/files?scope=shared")) as unknown as {
        files: Record<string, unknown>[];
      };
      expect(files.files).toHaveLength(2);
      for (const file of files.files) {
        for (const field of CONTRACT_FIELDS) expect(file).toHaveProperty(field);
      }

      const notes = (await call("/app-api/notes")) as unknown as Record<
        string,
        unknown
      >[];
      expect(notes[0]).toMatchObject({ kind: "note", personIds: [] });
      expect(typeof notes[0]?.at).toBe("string");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops a row that cannot be completed instead of failing the page", async () => {
    // A doc with no id at all cannot be rendered. It must cost one row, not
    // the whole Files view — the exact failure mode that caused the incident.
    const unrenderable = { name: "nameless", mimeType: "video/mp4" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const sql = String(
          (JSON.parse(String(init?.body ?? "{}")) as { sql?: string }).sql ??
            "",
        );
        const rows = sql.includes("information_schema.tables")
          ? [{ table_name: "file_doc" }, { table_name: "file_link" }]
          : sql.includes("ri_console.file_link")
            ? [
                {
                  id: "bad-link",
                  file_id: "x",
                  entity_kind: "nonsense",
                  entity_id: "",
                  principal_id: "",
                },
              ]
            : [
                { doc: driveFolder, principal_id: "p1", visibility: "shared" },
                { doc: unrenderable, principal_id: "p1", visibility: "shared" },
              ];
        return new Response(JSON.stringify({ rows }), { status: 200 });
      }),
    );
    try {
      const ctx = {
        config: { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        token: "principal-token",
        workspaceId: "ws-1",
        octoContainerId: "ws-1",
        principalId: "p1",
        principal: { id: "p1", displayName: "Pujan Bajracharya" },
        workspaces: [{ id: "ws-1", name: "Design Bakery" }],
      };
      let sent = { status: 0, body: "" };
      const res = {
        writeHead: (status: number) => {
          sent = { ...sent, status };
        },
        end: (body: string) => {
          sent = { ...sent, body };
        },
      } as unknown as Parameters<typeof handleProfileRoutes>[1];
      await handleProfileRoutes(
        { method: "GET", headers: {} } as Parameters<
          typeof handleProfileRoutes
        >[0],
        res,
        new URL("https://app.example.test/app-api/files?scope=shared"),
        ctx,
      );
      expect(sent.status).toBe(200);
      const view = JSON.parse(sent.body) as {
        files: Record<string, unknown>[];
        dropped?: { id: string; reason: string }[];
      };
      // The good row still serves; the bad one is reported, not fatal.
      expect(view.files.map((f) => f.id)).toEqual([
        "file-geoai-2026-submission",
      ]);
      expect(view.dropped).toHaveLength(1);
      expect(view.dropped?.[0]?.reason).toContain("id");
      // The malformed link never reached its file.
      expect(view.files[0]?.links).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
