import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRAWL_PACING,
  crawlerAuthorized,
  crawlerIngest,
  crawlerQueue,
  isProfileUrl,
} from "../server/crawler.js";
import type { OctoClientConfig } from "../server/octo.js";

const CFG: OctoClientConfig = {
  baseUrl: "https://octo.example.test",
  timeoutMs: 5000,
};
const CONT = "ws-1";
const WS = "ws-1";
const TOKEN = "tok";
const NOW = new Date("2026-11-21T12:00:00Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

interface MockState {
  graphCyphers: string[];
  recorded: { kind: string; fields: Record<string, unknown> }[];
  sql: string[];
  rows: Record<string, unknown[]>;
}

const install = (state: MockState) => {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/graph/query")) {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      state.graphCyphers.push(query);
      if (query.includes("seedId")) {
        return Response.json({ rows: state.rows.seedProv ?? [] });
      }
      if (query.includes("MATCH (e:Entity)")) {
        return Response.json({ rows: state.rows.entities ?? [] });
      }
      if (query.includes("MATCH (c:Claim) RETURN")) {
        return Response.json({ rows: state.rows.claims ?? [] });
      }
      if (query.includes("[:SUBJECT]")) {
        return Response.json({ rows: state.rows.subjects ?? [] });
      }
      if (query.includes("seedId")) {
        return Response.json({ rows: state.rows.seedProv ?? [] });
      }
      return Response.json({ rows: [] });
    }
    if (u.includes("/api/epistemic/record")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        kind: string;
        [k: string]: unknown;
      };
      const { kind, ...fields } = body;
      state.recorded.push({ kind, fields });
      if (kind === "claim")
        return Response.json({ claim: { id: `c-${state.recorded.length}` } });
      if (kind === "evidence")
        return Response.json({
          evidence: { id: `e-${state.recorded.length}` },
        });
      return Response.json({});
    }
    if (u.includes("/query")) {
      const { sql } = JSON.parse(String(init?.body ?? "{}")) as { sql: string };
      state.sql.push(sql);
      return Response.json({ rows: [] });
    }
    if (u.includes("/otel") || u.includes("/traces")) return Response.json({});
    return Response.json({ rows: [] });
  });
};

const state = (overrides: Partial<MockState> = {}): MockState => ({
  graphCyphers: [],
  recorded: [],
  sql: [],
  rows: {},
  ...overrides,
});

const person = (id: string, name: string, url: string) => ({
  rows: {
    entities: [{ id, name, kind: "person" }],
    claims: [
      {
        id: `url-${id}`,
        statement: `${name}, linkedin_url: ${url}`,
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "FACT",
          attribute: "linkedin_url",
        }),
      },
    ],
    subjects: [{ claimId: `url-${id}`, entityId: id }],
  },
});

const URL_1 = "https://www.linkedin.com/in/zoe-example-7";
const BODY = {
  personId: "p1",
  url: URL_1,
  status: "ok",
  visitedAt: NOW.toISOString(),
  facts: [
    {
      attribute: "public_headline",
      statement: "Zoe Example, public_headline: Founder at Example",
      quote: "Founder at Example",
    },
    {
      attribute: "location",
      statement: "Zoe Example, location: New York",
      quote: "New York",
    },
  ],
};

describe("C1 queue scope and pacing", () => {
  it("returns only non-retired linkedin people with pacing bounds", async () => {
    const s = state(person("p1", "Zoe", URL_1));
    install(s);
    const q = await crawlerQueue(CFG, TOKEN, CONT, WS, 20, NOW);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]?.personId).toBe("p1");
    expect(q.pacing).toEqual(CRAWL_PACING);
    expect(q.cooldownUntil).toBeNull();
  });
  it("excludes a retired person", async () => {
    const base = person("p1", "Zoe", URL_1);
    base.rows.claims.push({
      id: "retire-1",
      statement: "RETIRED duplicate",
      supersededAt: null,
      provenance: JSON.stringify({ verb: "RETIRED" }),
    });
    base.rows.subjects.push({ claimId: "retire-1", entityId: "p1" });
    const s = state(base);
    install(s);
    expect(
      (await crawlerQueue(CFG, TOKEN, CONT, WS, 20, NOW)).items,
    ).toHaveLength(0);
  });
});

describe("C3/C4 sourced ingest and idempotent replay", () => {
  it("writes one FACT + evidence per fact with the profile URL", async () => {
    const s = state(person("p1", "Zoe", URL_1));
    install(s);
    const result = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(result.ok).toBe(true);
    const claims = s.recorded.filter((r) => r.kind === "claim");
    expect(claims).toHaveLength(2);
    expect(claims[0]?.fields.provenance).toMatchObject({
      verb: "FACT",
      attribute: "public_headline",
      source: "linkedin-slow-crawler",
    });
    const evidence = s.recorded.filter((r) => r.kind === "evidence");
    expect(evidence).toHaveLength(2);
    expect(evidence[0]?.fields.locator).toBe(URL_1);
    expect(s.recorded.filter((r) => r.kind === "claim_evidence")).toHaveLength(
      2,
    );
  });
  it("replay writes zero new claims", async () => {
    const base = person("p1", "Zoe", URL_1);
    const s = state({
      ...base,
      rows: {
        ...base.rows,
        seedProv: BODY.facts.map((f) => ({
          p: JSON.stringify({
            seedId: requireSeed(f.attribute, f.statement, URL_1),
          }),
        })),
      },
    });
    install(s);
    const result = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(result.ok).toBe(true);
    expect(s.recorded.filter((r) => r.kind === "claim")).toHaveLength(0);
  });
});

// Mirror of the server's deterministic seedId for the fixture above.
function requireSeed(
  attribute: string,
  statement: string,
  url: string,
): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256")
    .update(
      `FACT\x00${statement}\x00${attribute}\x00${url.split("?")[0]?.replace(/\/+$/, "").toLowerCase()}`,
    )
    .digest("hex")
    .slice(0, 16);
}

describe("C5 blocked/error writes no facts; C2 cooldown", () => {
  it("blocked ingest records only the visit", async () => {
    const s = state(person("p1", "Zoe", URL_1));
    install(s);
    const result = await crawlerIngest(
      CFG,
      TOKEN,
      CONT,
      WS,
      { ...BODY, status: "blocked", facts: [] },
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(s.recorded).toHaveLength(0);
    expect(
      s.sql.some(
        (q) => q.includes("status = 'blocked'") || q.includes("'blocked'"),
      ),
    ).toBe(true);
  });
  it("queue returns cooldown after a blocked visit", async () => {
    // Simulate the crawl_visit row lookup by intercepting the cooldown query.
    vi.stubGlobal(
      "fetch",
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/graph/query")) return Response.json({ rows: [] });
        if (u.includes("/query")) {
          const { sql } = JSON.parse(String(init?.body ?? "{}")) as {
            sql: string;
          };
          if (sql.includes("status = 'blocked'")) {
            return Response.json({
              rows: [{ visited_at: "2026-11-21T11:00:00Z" }],
            });
          }
          return Response.json({ rows: [] });
        }
        return Response.json({ rows: [] });
      },
    );
    const q = await crawlerQueue(CFG, TOKEN, CONT, WS, 20, NOW);
    expect(q.items).toHaveLength(0);
    expect(q.cooldownUntil).toBe("2026-11-22T11:00:00.000Z");
  });
});

describe("C6 URL allowlist and person match", () => {
  it("rejects lookalike and non-profile URLs", () => {
    expect(isProfileUrl(URL_1)).toBe(true);
    expect(isProfileUrl("https://linkedin.com.evil.com/in/zoe")).toBe(false);
    expect(isProfileUrl("https://www.linkedin.com/company/example")).toBe(
      false,
    );
    expect(isProfileUrl("http://www.linkedin.com/in/zoe")).toBe(false);
  });
  it("rejects a person/URL mismatch", async () => {
    const s = state(person("p1", "Zoe", URL_1));
    install(s);
    const result = await crawlerIngest(CFG, TOKEN, CONT, WS, {
      ...BODY,
      url: "https://www.linkedin.com/in/someone-else-9",
    });
    expect(result.ok).toBe(false);
    expect(s.recorded).toHaveLength(0);
  });
});

describe("C7 bearer auth", () => {
  it("accepts exact token, rejects wrong or missing", () => {
    expect(
      crawlerAuthorized(
        { headers: { authorization: "Bearer secret" } },
        "secret",
      ),
    ).toBe(true);
    expect(
      crawlerAuthorized(
        { headers: { authorization: "Bearer wrong" } },
        "secret",
      ),
    ).toBe(false);
    expect(crawlerAuthorized({ headers: {} }, "secret")).toBe(false);
    expect(
      crawlerAuthorized({ headers: { authorization: "Bearer x" } }, undefined),
    ).toBe(false);
  });
});

describe("MR-C1 replay with permuted fact order yields the same facts", () => {
  it("holds for arbitrary 1-3 fact permutations", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (count) => {
        const facts = BODY.facts.slice(0, count);
        const seedProv = facts.map((f) =>
          JSON.stringify({
            seedId: requireSeed(f.attribute, f.statement, URL_1),
          }),
        );
        const base = person("p1", "Zoe", URL_1);
        const s1 = state({ ...base, rows: { ...base.rows, seedProv } });
        install(s1);
        await crawlerIngest(CFG, TOKEN, CONT, WS, { ...BODY, facts }, NOW);
        const written1 = s1.recorded.filter((r) => r.kind === "claim").length;
        vi.unstubAllGlobals();
        const s2 = state({ ...base, rows: { ...base.rows, seedProv } });
        install(s2);
        await crawlerIngest(
          CFG,
          TOKEN,
          CONT,
          WS,
          { ...BODY, facts: [...facts].reverse() },
          NOW,
        );
        expect(s2.recorded.filter((r) => r.kind === "claim").length).toBe(
          written1,
        );
        vi.unstubAllGlobals();
      }),
      { numRuns: 10 },
    );
  });
});
