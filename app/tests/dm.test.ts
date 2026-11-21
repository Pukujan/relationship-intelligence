import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DmThread,
  dayClaims,
  daySeedId,
  dmAuthorized,
  dmIngest,
  dmLink,
  matchThread,
  messageId,
} from "../server/dm.js";

const JANE = {
  personId: "p-jane",
  name: "Jane Doe",
  handle: "https://www.linkedin.com/in/jane-doe",
};
const NOW = new Date("2026-11-21T15:00:00.000Z");

const thread = (overrides: Partial<DmThread> = {}): DmThread => ({
  threadId: "t-1",
  threadUrl: "https://www.linkedin.com/messaging/thread/t-1/",
  counterpart: {
    name: "Jane Doe",
    handle: "https://linkedin.com/in/Jane-Doe/?miniProfile=x",
  },
  messages: [
    {
      direction: "in",
      sentAt: "2026-11-19T14:00:00.000Z",
      text: "Great meeting you at GIS Day!",
    },
    {
      direction: "out",
      sentAt: "2026-11-19T15:30:00.000Z",
      text: "Likewise, sending the deck.",
    },
    {
      direction: "in",
      sentAt: "2026-11-20T09:00:00.000Z",
      text: "Got it, thanks.",
    },
    {
      direction: "out",
      sentAt: "2026-11-21T10:00:00.000Z",
      text: "Today's message waits.",
    },
  ],
  ...overrides,
});

describe("DM matching (#120)", () => {
  it("matches a LinkedIn thread by profile link, ignoring case, slash and query", () => {
    expect(matchThread("linkedin", thread(), [JANE])?.personId).toBe("p-jane");
  });

  it("never matches on name alone", () => {
    const sameNameOtherPerson = thread({
      counterpart: {
        name: "Jane Doe",
        handle: "https://www.linkedin.com/in/another-jane",
      },
    });
    expect(matchThread("linkedin", sameNameOtherPerson, [JANE])).toBeNull();
    expect(
      matchThread("linkedin", thread({ counterpart: { name: "Jane Doe" } }), [
        JANE,
      ]),
    ).toBeNull();
  });

  it("leaves other channels unmatched until contacts carry their handles", () => {
    expect(matchThread("telegram", thread(), [JANE])).toBeNull();
  });
});

describe("DM day claims", () => {
  it("writes one private claim per completed day and leaves today for later", () => {
    const claims = dayClaims("linkedin", thread(), JANE, new Set(), NOW);
    expect(claims.map((c) => c.day)).toEqual(["2026-11-19", "2026-11-20"]);
    const [first] = claims;
    expect(first?.provenance).toMatchObject({
      verb: "MESSAGED",
      channel: "linkedin",
      messageCount: 2,
      fromThem: 1,
      fromMe: 1,
      visibility: "private",
    });
    expect(first?.provenance).not.toHaveProperty("principalId");
    expect(first?.statement).toContain(
      "Messaged Jane Doe on LinkedIn: 2 messages",
    );
    expect(first?.statement).toContain(
      'Last, You: "Likewise, sending the deck."',
    );
  });

  it("skips a day already in the ledger", () => {
    const seen = new Set([daySeedId("linkedin", "t-1", "2026-11-19")]);
    expect(
      dayClaims("linkedin", thread(), JANE, seen, NOW).map((c) => c.day),
    ).toEqual(["2026-11-20"]);
  });

  it("gives the same message the same id and different messages different ids", () => {
    const [a, b] = thread().messages;
    if (!a || !b) throw new Error("fixture");
    expect(messageId("linkedin", "t-1", a)).toBe(
      messageId("linkedin", "t-1", { ...a }),
    );
    expect(messageId("linkedin", "t-1", a)).not.toBe(
      messageId("linkedin", "t-1", b),
    );
    expect(messageId("linkedin", "t-1", a)).not.toBe(
      messageId("linkedin", "t-2", a),
    );
  });
});

describe("DM ingest auth", () => {
  it("refuses a missing or wrong bearer, and everything when the token is unset", () => {
    const req = (auth?: string) => ({
      headers: auth ? { authorization: auth } : {},
    });
    expect(dmAuthorized(req("Bearer secret"), "secret")).toBe(true);
    expect(dmAuthorized(req("Bearer nope"), "secret")).toBe(false);
    expect(dmAuthorized(req(), "secret")).toBe(false);
    expect(dmAuthorized(req("Bearer secret"), undefined)).toBe(false);
  });
});

describe("dmIngest against a mocked Octo", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockOcto(existingMessaged: string[] = []) {
    const claimsWritten: Record<string, unknown>[] = [];
    const sql: string[] = [];
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        const json = (data: unknown) =>
          new Response(JSON.stringify(data), { status: 200 });
        if (path.includes("/api/graph/query")) {
          const q = String(body.query);
          if (q.includes("MATCH (e:Entity)"))
            return json({
              rows: [{ id: "p-jane", name: "Jane Doe", kind: "person" }],
            });
          if (q.includes('"MESSAGED"'))
            return json({
              rows: existingMessaged.map((seedId) => ({
                p: JSON.stringify({ verb: "MESSAGED", seedId }),
              })),
            });
          if (q.includes("[:SUBJECT]"))
            return json({ rows: [{ claimId: "c-url", entityId: "p-jane" }] });
          if (q.includes("MATCH (c:Claim)"))
            return json({
              rows: [
                {
                  id: "c-url",
                  statement:
                    "Jane Doe's LinkedIn profile is https://www.linkedin.com/in/jane-doe",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "FACT",
                    attribute: "linkedin_url",
                  }),
                },
              ],
            });
          return json({ rows: [] });
        }
        if (path.includes("/api/epistemic/record")) {
          if (body.kind === "claim") {
            claimsWritten.push(body);
            return json({ claim: { id: `c-${claimsWritten.length}` } });
          }
          if (body.kind === "evidence")
            return json({ evidence: { id: "e-1" } });
          return json({});
        }
        if (path.includes("/query")) {
          sql.push(String(body.sql));
          return json({
            rows:
              String(body.sql).includes("dm_message") &&
              String(body.sql).startsWith("INSERT")
                ? [{ inserted: true }]
                : [],
          });
        }
        return json({});
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return { claimsWritten, sql };
  }

  const config = { baseUrl: "https://octo.example.test", timeoutMs: 5000 };

  it("stores every message, matches by link, and writes private claims for completed days", async () => {
    const { claimsWritten, sql } = mockOcto();
    const stranger = thread({
      threadId: "t-2",
      counterpart: {
        name: "Jane Doe",
        handle: "https://www.linkedin.com/in/someone-else",
      },
    });
    const result = await dmIngest(
      config,
      "tok",
      "ws",
      "ws",
      { channel: "linkedin", threads: [thread(), stranger] },
      NOW,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      threads: 2,
      matched: 1,
      unmatched: 1,
      claims: 2,
      failed: 0,
    });
    expect(
      sql.filter((s) => s.startsWith("INSERT INTO ri_console.dm_message")),
    ).toHaveLength(8);
    expect(
      claimsWritten.map((c) => (c.provenance as Record<string, unknown>).day),
    ).toEqual(["2026-11-19", "2026-11-20"]);
    expect(claimsWritten.every((c) => c.subjectEntityId === "p-jane")).toBe(
      true,
    );
  });

  it("adds no claim on a second run for days already recorded", async () => {
    const { claimsWritten } = mockOcto([
      daySeedId("linkedin", "t-1", "2026-11-19"),
      daySeedId("linkedin", "t-1", "2026-11-20"),
    ]);
    const result = await dmIngest(
      config,
      "tok",
      "ws",
      "ws",
      { channel: "linkedin", threads: [thread()] },
      NOW,
    );
    expect(result.body).toMatchObject({ matched: 1, claims: 0 });
    expect(claimsWritten).toHaveLength(0);
  });

  it("rejects a malformed payload without touching Octo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dmIngest(
      config,
      "tok",
      "ws",
      "ws",
      { channel: "sms", threads: [] },
      NOW,
    );
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("linked accounts (#120 Telegram slice)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches a Telegram chat only by the linked account id", () => {
    const linked = [
      { personId: "p-jane", name: "Jane Doe", handle: "tg:4242" },
    ];
    const chat = (handle?: string) =>
      thread({
        threadId: "tg-4242",
        counterpart: { name: "Jane Doe", ...(handle ? { handle } : {}) },
      });
    expect(matchThread("telegram", chat(" TG:4242 "), linked)?.personId).toBe(
      "p-jane",
    );
    expect(matchThread("telegram", chat("tg:9999"), linked)).toBeNull();
    expect(matchThread("telegram", chat(), linked)).toBeNull();
  });

  function mockLinkOcto(accountAlreadyLinked: boolean) {
    const claims: Record<string, unknown>[] = [];
    const sql: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        const json = (data: unknown) =>
          new Response(JSON.stringify(data), { status: 200 });
        if (path.includes("/api/graph/query")) {
          const q = String(body.query);
          if (q.includes("MATCH (e:Entity)"))
            return json({
              rows: [{ id: "p-jane", name: "Jane Doe", kind: "person" }],
            });
          if (q.includes("[:SUBJECT]"))
            return json({ rows: [{ claimId: "c-acct", entityId: "p-jane" }] });
          if (q.includes('"telegram_account"') && accountAlreadyLinked)
            return json({
              rows: [
                {
                  id: "c-acct",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "FACT",
                    attribute: "telegram_account",
                    handle: "tg:4242",
                  }),
                },
              ],
            });
          return json({ rows: [] });
        }
        if (path.includes("/api/epistemic/record")) {
          if (body.kind === "claim") claims.push(body);
          return json({ claim: { id: `c-${claims.length}` } });
        }
        if (path.includes("/query")) {
          const text = String(body.sql);
          sql.push(text);
          if (text.startsWith("SELECT thread_url"))
            return json({
              rows: [
                {
                  thread_url: null,
                  counterpart_name: "Jane",
                  counterpart_handle: "tg:4242",
                  direction: "in",
                  sent_at: "2026-11-19T14:00:00Z",
                  body: "Hi!",
                },
                {
                  thread_url: null,
                  counterpart_name: "Jane",
                  counterpart_handle: "tg:4242",
                  direction: "out",
                  sent_at: "2026-11-21T09:00:00Z",
                  body: "Today waits.",
                },
              ],
            });
          return json({ rows: [] });
        }
        return json({});
      }),
    );
    return { claims, sql };
  }

  const config = { baseUrl: "https://octo.example.test", timeoutMs: 5000 };
  const link = { channel: "telegram", threadId: "tg-4242", personId: "p-jane" };

  it("records the account privately, attaches the stored messages and writes completed days", async () => {
    const { claims, sql } = mockLinkOcto(false);
    const result = await dmLink(config, "tok", "ws", "ws", link, NOW);
    expect(result.body).toMatchObject({ linked: true, messages: 2, claims: 1 });
    const account = claims.find(
      (c) =>
        (c.provenance as Record<string, unknown>).attribute ===
        "telegram_account",
    );
    expect(account?.provenance).toMatchObject({
      verb: "FACT",
      handle: "tg:4242",
      visibility: "private",
    });
    expect(
      claims.filter(
        (c) => (c.provenance as Record<string, unknown>).verb === "MESSAGED",
      ),
    ).toHaveLength(1);
    expect(
      sql.some((q) =>
        q.startsWith("UPDATE ri_console.dm_message SET person_id = 'p-jane'"),
      ),
    ).toBe(true);
  });

  it("doesn't record the same account twice", async () => {
    const { claims } = mockLinkOcto(true);
    await dmLink(config, "tok", "ws", "ws", link, NOW);
    expect(
      claims.some(
        (c) =>
          (c.provenance as Record<string, unknown>).attribute ===
          "telegram_account",
      ),
    ).toBe(false);
  });

  it("refuses an unknown contact", async () => {
    mockLinkOcto(false);
    const result = await dmLink(
      config,
      "tok",
      "ws",
      "ws",
      { ...link, personId: "p-nobody" },
      NOW,
    );
    expect(result.status).toBe(404);
  });
});
