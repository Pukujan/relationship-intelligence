import { describe, expect, it, vi } from "vitest";
import { completeAgentDoc } from "../server/agentShape.js";
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

  it("stages a mutable Draft Plan without creating milestones, then locks it into Objective + Milestone", async () => {
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

describe("installed agents appear on the Agents page (#49)", () => {
  const TABLES = [
    "workspace",
    "workspace_member",
    "ledger_event",
    "user_connector",
    "connector_route",
  ].map((table_name) => ({ table_name }));

  const stubOcto = (existingAgentDoc: Record<string, unknown> | null) => {
    const sqlLog: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const sql =
          (JSON.parse(String(init?.body ?? "{}")) as { sql?: string }).sql ??
          "";
        sqlLog.push(sql);
        if (sql.includes("information_schema.tables")) {
          return new Response(JSON.stringify({ rows: TABLES }), {
            status: 200,
          });
        }
        if (sql.includes("SELECT doc FROM ri_console.agent")) {
          return new Response(
            JSON.stringify({
              rows: existingAgentDoc ? [{ doc: existingAgentDoc }] : [],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    return sqlLog;
  };

  const install = (templateId: string) => {
    const tpl = AGENT_TEMPLATES.find((item) => item.id === templateId);
    if (!tpl) throw new Error(`no template ${templateId}`);
    return createCustomAgent(
      CONFIG,
      "octo_live_ws_ownerkey",
      WS_ID,
      WS_ID,
      PID,
      {
        name: tpl.name,
        role: tpl.role,
        cadence: tpl.cadence,
        autonomyZone: tpl.autonomyZone,
        connectors: tpl.connectors,
        instructions: tpl.instructions,
        templateId: tpl.id,
      },
    );
  };

  it("saves a template install with the team and card fields the page reads", async () => {
    stubOcto(null);
    try {
      const res = await install("tpl-relationship-outreach");
      const agent = res.body.agent as Record<string, unknown>;
      expect(agent.icon).toBe("sales");
      expect(agent.tone).toBe("coral");
      expect(agent.autonomy).toBe("approve");
      expect(agent.sparkline).toEqual([]);
      expect(agent.kpis).toEqual([]);
      expect(agent.currentTask).toBeNull();
      expect(agent.joinedAt).toBe(agent.createdAt);
      expect(agent.templateId).toBe("tpl-relationship-outreach");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns the existing agent instead of a copy when a template is installed twice", async () => {
    const sqlLog = stubOcto({
      id: "agent-old",
      name: "Relationship Outreach",
      templateId: "tpl-relationship-outreach",
      createdAt: "2026-11-20T00:00:00.000Z",
    });
    try {
      const res = await install("tpl-relationship-outreach");
      expect(res.body.alreadyInstalled).toBe(true);
      expect((res.body.agent as Record<string, unknown>).id).toBe("agent-old");
      expect(
        sqlLog.some((q) => q.includes("INSERT INTO ri_console.agent")),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives every starter template a team", () => {
    for (const tpl of AGENT_TEMPLATES) {
      expect(["sales", "marketing", "research"]).toContain(tpl.domain);
    }
  });

  // Metamorphic checks on the shape filler: what it returns must not depend
  // on how many times it runs or on which optional fields were present.
  const samples: Record<string, unknown>[] = [
    {},
    { id: "a", instructions: "Watch the inbox.", autonomyZone: "prep" },
    { id: "b", createdAt: "2026-11-01T00:00:00.000Z", domain: "marketing" },
    { id: "c", icon: "sales", tone: "teal", autonomy: "draft", kpis: [1] },
    { id: "d", icon: "not-a-team", sparkline: "oops", status: "" },
  ];

  it("(metamorphic) filling the shape twice equals filling it once", () => {
    for (const sample of samples) {
      const once = completeAgentDoc(sample);
      expect(completeAgentDoc(once)).toEqual(once);
    }
  });

  it("(metamorphic) always yields a renderable card and never overwrites valid fields", () => {
    for (const sample of samples) {
      const done = completeAgentDoc(sample);
      expect(["sales", "marketing", "research"]).toContain(done.icon);
      expect(["coral", "indigo", "teal"]).toContain(done.tone);
      expect(["draft", "approve", "full"]).toContain(done.autonomy);
      expect(Array.isArray(done.sparkline)).toBe(true);
      expect(Array.isArray(done.kpis)).toBe(true);
      expect(typeof done.joinedAt).toBe("string");
      for (const [key, value] of Object.entries(sample)) {
        if (key === "icon" && value === "not-a-team") continue;
        if (key === "sparkline" && value === "oops") continue;
        if (key === "status" && value === "") continue;
        expect(done[key]).toEqual(value);
      }
    }
  });
});
