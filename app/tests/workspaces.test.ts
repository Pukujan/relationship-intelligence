import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleConnectorAuthUrl,
  buildZoomConnectorAuthUrl,
} from "../server/connectors.js";
import type { Env } from "../server/env.js";
import { matchConnectorRoute, syncUserConnector } from "../server/sync.js";
import {
  encodeOtlpTraceProtobuf,
  endSpan,
  scrubAttributes,
  startSpan,
} from "../server/telemetry.js";
import {
  createAppWorkspace,
  DDL_VERSION,
  provisionWorkspace,
  removeWorkspaceMember,
  resolveOrActivateGoogleMember,
} from "../server/workspaces.js";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const NEW_PID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseEnv: Env = {
  PORT: 4000,
  APP_ORIGIN: "http://localhost:4000",
  OCTO_API_URL: "https://octo.example.test",
  OCTO_API_KEY: "octo_live_ws_ownerkey",
  OCTO_WORKSPACE_ID: WS_ID,
  SESSION_PASSWORD: "0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  ZOOM_CLIENT_ID: "zoom-client-id",
  ZOOM_CLIENT_SECRET: "zoom-client-secret",
};

describe("single-Octo workspace lifecycle (RI-0018)", () => {
  it("creates an App Workspace inside the single Octo container without OCTO_ACCOUNT_KEY", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          sql?: string;
        };
        if (parsed.sql) queries.push(parsed.sql);
        if (parsed.sql?.includes("information_schema.tables")) {
          return new Response(
            JSON.stringify({
              rows: [
                { table_name: "workspace" },
                { table_name: "workspace_member" },
                { table_name: "ledger_event" },
                { table_name: "user_connector" },
                { table_name: "connector_route" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const res = await createAppWorkspace(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_ws_ownerkey",
        WS_ID,
        { id: NEW_PID, email: "owner@example.com", displayName: "Owner" },
        { name: "Design Bakery" },
      );
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Design Bakery");
      expect(res.body.role).toBe("owner");
      expect(
        queries.some((q) => q.includes("INSERT INTO ri_console.workspace ")),
      ).toBe(true);
      expect(
        queries.some((q) =>
          q.includes("INSERT INTO ri_console.workspace_member"),
        ),
      ).toBe(true);
      expect(
        queries.some((q) => q.includes("INSERT INTO ri_console.ledger_event")),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("provisions ri_console DDL idempotently with workspace, ledger, and connector tables", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          sql?: string;
        };
        if (parsed.sql) queries.push(parsed.sql);
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const result = await provisionWorkspace(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_ws_ownerkey",
        WS_ID,
      );
      expect(result.provisioned).toBe(true);
      expect(result.ddlVersion).toBe(DDL_VERSION);
      expect(queries.some((q) => q.includes("ri_console.workspace_meta"))).toBe(
        true,
      );
      expect(queries.some((q) => q.includes("ri_console.ledger_event"))).toBe(
        true,
      );
      expect(queries.some((q) => q.includes("ri_console.user_connector"))).toBe(
        true,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("activates a pending invite in ri_console.workspace_member during Google sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { sql?: string };
        if (body.sql?.includes("FROM ri_console.workspace_member")) {
          return new Response(
            JSON.stringify({
              rows: [
                {
                  workspace_id: WS_ID,
                  principal_id: NEW_PID,
                  role: "operator",
                  status: "pending",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const hit = await resolveOrActivateGoogleMember(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_ws_ownerkey",
        "invitee@example.com",
        baseEnv,
      );
      expect(hit).toEqual({
        principalId: NEW_PID,
        workspaceId: WS_ID,
        role: "operator",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks removing self from a workspace", async () => {
    const selfRes = await removeWorkspaceMember(
      { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
      "token",
      WS_ID,
      WS_ID,
      "admin@example.com",
      "admin@example.com",
      NEW_PID,
    );
    expect(selfRes.status).toBe(403);
    expect(selfRes.body.error).toBe("CANNOT_REMOVE_SELF");
  });
});

describe("Phoenix OTLP telemetry & scrubber (RI-0020)", () => {
  it("scrubs tokens, secrets, bearer headers, and raw email bodies", () => {
    const clean = scrubAttributes(
      {
        access_token: "secret-123",
        authorization: "Bearer abc.def.ghi",
        email_body: "private message content",
        note: "Call with Bearer tok_999",
        "ri.workspace_id": WS_ID,
      },
      false,
    );
    expect(clean.access_token).toBe("[REDACTED]");
    expect(clean.authorization).toBe("[REDACTED]");
    expect(clean.email_body).toBe("[REDACTED_CONTENT]");
    expect(clean.note).toBe("Call with Bearer [REDACTED]");
    expect(clean["ri.workspace_id"]).toBe(WS_ID);
  });

  it("gracefully no-ops when PHOENIX_COLLECTOR_ENDPOINT is unset", async () => {
    const span = startSpan({
      name: "test.span",
      kind: "AGENT",
      workspaceId: WS_ID,
    });
    expect(span.traceId).toHaveLength(32);
    const out = await endSpan(span, "OK", undefined, "");
    expect(out.exported).toBe(false);
    expect(out.traceId).toBe(span.traceId);
  });

  it("encodes valid OTLP/HTTP protobuf bytes and posts application/x-protobuf", async () => {
    const span = startSpan({
      name: "ri.otel.unit",
      kind: "CHAIN",
      workspaceId: WS_ID,
      attributes: { "ri.probe": true, "ri.count": 2 },
    });
    const payload = encodeOtlpTraceProtobuf({
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.startTimeUnixNano,
      attributes: span.attributes,
      status: "OK",
      project: "ri-prod",
    });
    expect(payload.byteLength).toBeGreaterThan(40);
    expect(Buffer.from(payload).includes(Buffer.from("ri.otel.unit"))).toBe(
      true,
    );
    let seenContentType = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenContentType = headers["Content-Type"] ?? "";
        return new Response("", { status: 200 });
      }),
    );
    try {
      const out = await endSpan(
        span,
        "OK",
        undefined,
        "https://octo.example.test/api/workspaces/ws/otel/v1/traces",
      );
      expect(out.exported).toBe(true);
      expect(seenContentType).toBe("application/x-protobuf");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("user connectors OAuth URLs & sync workers (RI-0019)", () => {
  it("builds incremental Google OAuth URLs for gmail, gcal, and gdrive", () => {
    const gmailUrl = buildGoogleConnectorAuthUrl(baseEnv, "gmail", "st1");
    const gcalUrl = buildGoogleConnectorAuthUrl(baseEnv, "gcal", "st2");
    const gdriveUrl = buildGoogleConnectorAuthUrl(baseEnv, "gdrive", "st3");
    expect(gmailUrl).toContain("gmail.readonly");
    expect(gcalUrl).toContain("calendar.readonly");
    expect(gdriveUrl).toContain("drive.readonly");
  });

  it("builds Zoom OAuth authorize URL when ZOOM_CLIENT_ID/SECRET are set", () => {
    const zoomUrl = buildZoomConnectorAuthUrl(baseEnv, "zstate");
    expect(zoomUrl).toContain("https://zoom.us/oauth/authorize");
    expect(zoomUrl).toContain("state=zstate");
  });

  it("matches connector routing rules to workspace/project with fallback", () => {
    const routes = [
      {
        id: "r1",
        provider: "gmail",
        matchExpr: "mta.info, SMART Grant",
        targetWorkspaceId: "ws-design-bakery",
        targetProjectId: "proj-mta",
        cadence: "signal" as const,
        createdAt: "",
      },
    ];
    expect(
      matchConnectorRoute(
        routes,
        "gmail",
        "From lead@mta.info Re: SMART Grant",
        "ws-personal",
      ),
    ).toEqual({
      workspaceId: "ws-design-bakery",
      projectId: "proj-mta",
      cadence: "signal",
    });
    expect(
      matchConnectorRoute(routes, "gmail", "Weekend catchup", "ws-personal")
        .workspaceId,
    ).toBe("ws-personal");
  });

  it("syncs Gmail messages idempotently with routing and ledger event", async () => {
    const sqlLog: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/query")) {
          const sql =
            (JSON.parse(String(init?.body ?? "{}")) as { sql?: string }).sql ??
            "";
          sqlLog.push(sql);
          if (sql.includes("information_schema.tables")) {
            return new Response(
              JSON.stringify({
                rows: [
                  { table_name: "workspace" },
                  { table_name: "workspace_member" },
                  { table_name: "ledger_event" },
                  { table_name: "user_connector" },
                  { table_name: "connector_route" },
                ],
              }),
              { status: 200 },
            );
          }
          if (sql.includes("FROM ri_console.user_connector")) {
            return new Response(
              JSON.stringify({
                rows: [
                  {
                    status: "connected",
                    access_token: "test-google-token",
                    refresh_token: null,
                    expires_at: null,
                  },
                ],
              }),
              { status: 200 },
            );
          }
          if (sql.includes("FROM ri_console.connector_route")) {
            return new Response(
              JSON.stringify({
                rows: [
                  {
                    id: "r1",
                    provider: "gmail",
                    match_expr: "mta.info",
                    target_workspace_id: "ws-db",
                    target_project_id: "proj-mta",
                    cadence: "signal",
                    created_at: "",
                  },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ rows: [] }), { status: 200 });
        }
        if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return new Response(
            JSON.stringify({ messages: [{ id: "msg-101" }] }),
            { status: 200 },
          );
        }
        if (
          url.includes(
            "gmail.googleapis.com/gmail/v1/users/me/messages/msg-101",
          )
        ) {
          return new Response(
            JSON.stringify({
              id: "msg-101",
              snippet: "Next steps on the $2M SMART Grant",
              payload: {
                headers: [
                  { name: "Subject", value: "MTA NaviLens Pilot" },
                  { name: "From", value: "lead@mta.info" },
                ],
              },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    try {
      const res = await syncUserConnector(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_ws_ownerkey",
        WS_ID,
        WS_ID,
        NEW_PID,
        "gmail",
        baseEnv,
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.syncedCount).toBe(1);
        expect(res.routedWorkspaces).toEqual(["ws-db"]);
        expect(res.items[0]?.id).toBe("sync-gmail-msg-101");
      }
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.activity")),
      ).toBe(true);
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.ledger_event")),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
