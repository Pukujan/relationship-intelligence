import { describe, expect, it, vi } from "vitest";
import {
  AGENT_TEMPLATES,
  createCustomAgent,
  createDraftPlan,
  lockDraftPlan,
} from "../server/agents.js";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const PID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONFIG = { baseUrl: "https://octo.example.test", timeoutMs: 5000 };

describe("agent templates, custom builder & Draft Plan -> Lock (RI-0019 / #49)", () => {
  it("ships 4 starter agent templates covering daily, pre-event, and signal cadences", () => {
    expect(AGENT_TEMPLATES).toHaveLength(4);
    expect(AGENT_TEMPLATES.map((t) => t.cadence)).toEqual(
      expect.arrayContaining(["daily", "pre_event", "signal"]),
    );
  });

  it("creates a custom workspace agent and records a ledger event", async () => {
    const sqlLog: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
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
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const res = await createCustomAgent(
        CONFIG,
        "octo_live_ws_ownerkey",
        WS_ID,
        WS_ID,
        PID,
        {
          name: "Grant Scout",
          role: "Track NYC DOT SMART Grants",
          instructions: "Watch Drive & Gmail for MTA SMART Grant updates.",
          cadence: "signal",
          autonomyZone: "co_design",
          connectors: ["gmail", "gdrive"],
        },
      );
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.agent")),
      ).toBe(true);
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.ledger_event")),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stages a mutable Draft Plan without creating missions, then locks it into Objective + Mission", async () => {
    const sqlLog: string[] = [];
    let savedDraft: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
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
        if (sql.includes("SELECT doc FROM ri_console.plan")) {
          return new Response(
            JSON.stringify({ rows: savedDraft ? [{ doc: savedDraft }] : [] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const draftRes = await createDraftPlan(
        CONFIG,
        "octo_live_ws_ownerkey",
        WS_ID,
        WS_ID,
        PID,
        {
          title: "MTA NaviLens Pilot",
          objectiveName: "Book MTA accessibility demo",
          steps: [
            { label: "Pull SMART Grant notes from Drive" },
            { label: "Draft intro email via Jenny" },
          ],
        },
      );
      expect(draftRes.ok).toBe(true);
      savedDraft = draftRes.body.draftPlan as Record<string, unknown>;
      expect(savedDraft.status).toBe("draft");
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.mission")),
      ).toBe(false);

      const lockRes = await lockDraftPlan(
        CONFIG,
        "octo_live_ws_ownerkey",
        WS_ID,
        WS_ID,
        PID,
        String(savedDraft.id),
      );
      expect(lockRes.ok).toBe(true);
      expect(lockRes.status).toBe(200);
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.objective")),
      ).toBe(true);
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.mission")),
      ).toBe(true);

      // Re-locking returns 409 ALREADY_LOCKED
      savedDraft = lockRes.body.draftPlan as Record<string, unknown>;
      const secondLock = await lockDraftPlan(
        CONFIG,
        "octo_live_ws_ownerkey",
        WS_ID,
        WS_ID,
        PID,
        String(savedDraft.id),
      );
      expect(secondLock.ok).toBe(false);
      expect(secondLock.status).toBe(409);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
