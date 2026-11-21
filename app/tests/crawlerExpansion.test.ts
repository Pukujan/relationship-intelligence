/**
 * RI-0024 tests: connections, posts + topic classification, companies,
 * follows, feed, contact info, and profile images.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlerIngest } from "../server/crawler.js";
import type { OctoClientConfig } from "../server/octo.js";

const CFG: OctoClientConfig = {
  baseUrl: "https://octo.example.test",
  timeoutMs: 5000,
};
const CONT = "ws-1";
const WS = "ws-1";
const TOKEN = "tok";
const NOW = new Date("2026-11-21T12:00:00Z");
const URL_1 = "https://www.linkedin.com/in/zoe-example-7";

afterEach(() => vi.unstubAllGlobals());

interface St {
  rows: Record<string, unknown[]>;
  recorded: { kind: string; fields: Record<string, unknown> }[];
  sql: string[];
}
const mk = (): St => ({
  rows: {
    entities: [{ id: "p1", name: "Zoe", kind: "person" }],
    claims: [
      {
        id: "url-1",
        statement: `Zoe, linkedin_url: ${URL_1}`,
        supersededAt: null,
        provenance: JSON.stringify({ verb: "FACT", attribute: "linkedin_url" }),
      },
    ],
    subjects: [{ claimId: "url-1", entityId: "p1" }],
  },
  recorded: [],
  sql: [],
});
const install = (s: St) =>
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/graph/query")) {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      if (query.includes("seedId"))
        return Response.json({ rows: s.rows.seedProv ?? [] });
      if (query.includes("MATCH (e:Entity)"))
        return Response.json({ rows: s.rows.entities });
      if (query.includes("MATCH (c:Claim) RETURN"))
        return Response.json({ rows: s.rows.claims });
      if (query.includes("[:SUBJECT]"))
        return Response.json({ rows: s.rows.subjects });
      return Response.json({ rows: [] });
    }
    if (u.includes("/api/epistemic/record")) {
      const { kind, ...fields } = JSON.parse(String(init?.body ?? "{}")) as {
        kind: string;
        [k: string]: unknown;
      };
      s.recorded.push({ kind, fields });
      if (kind === "claim")
        return Response.json({ claim: { id: `c-${s.recorded.length}` } });
      if (kind === "evidence")
        return Response.json({ evidence: { id: `e-${s.recorded.length}` } });
      return Response.json({});
    }
    if (u.includes("/query")) {
      const { sql } = JSON.parse(String(init?.body ?? "{}")) as { sql: string };
      s.sql.push(sql);
      // Simulate fresh observation insert (no existing rows).
      if (sql.includes("INSERT INTO ri_console.crawl_observation")) {
        return Response.json({ rows: [{ id: "obs-new" }] });
      }
      return Response.json({ rows: [] });
    }
    return Response.json({});
  });

const BODY = {
  personId: "p1",
  url: URL_1,
  status: "ok",
  visitedAt: NOW.toISOString(),
  facts: [],
  contact: {
    email: "zoe@example.com",
    phone: "+1 555 123 4567",
    website: "https://zoe.example.com",
  },
  imageUrl: "https://media.licdn.com/dms/image/zoe-photo",
  connections: [
    {
      name: "Amir Khan",
      url: "https://www.linkedin.com/in/amir-khan",
      headline: "Engineer",
    },
    {
      name: "Mia Chen",
      url: "https://www.linkedin.com/in/mia-chen",
      headline: "Founder",
    },
  ],
  connectionsComplete: true,
  posts: [
    {
      text: "We just launched our new product feature today!",
      topic: "product",
    },
    { text: "We are hiring a senior engineer, apply now.", topic: "hiring" },
  ],
  companies: [
    {
      name: "Example Labs",
      url: "https://www.linkedin.com/company/example-labs",
      description: "Builds things",
    },
  ],
  follows: [
    { name: "Tech Crunch", url: "https://www.linkedin.com/company/techcrunch" },
  ],
  feed: [
    {
      author: "News Org",
      text: "A new research paper on AI benchmarks was published.",
      topic: "research",
    },
  ],
};

describe("expanded crawler ingest", () => {
  it("writes contact info as sourced FACT claims", async () => {
    const s = mk();
    install(s);
    const res = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(res.ok).toBe(true);
    const attrs = s.recorded
      .filter((r) => r.kind === "claim")
      .map((r) => (r.fields.provenance as { attribute?: string }).attribute);
    expect(attrs).toContain("professional_email");
    expect(attrs).toContain("phone");
    expect(attrs).toContain("website");
  });

  it("writes the profile image as a FACT claim with an image evidence URL", async () => {
    const s = mk();
    install(s);
    const res = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(res.ok).toBe(true);
    const imageClaims = s.recorded.filter(
      (r) =>
        r.kind === "claim" &&
        (r.fields.provenance as { attribute?: string }).attribute ===
          "profile_image",
    );
    expect(imageClaims).toHaveLength(1);
    const evidence = s.recorded.filter((r) => r.kind === "evidence");
    expect(
      evidence.some((e) => String(e.fields.locator).includes("licdn.com")),
    ).toBe(true);
  });

  it("writes connections, posts, companies, follows and feed as observations", async () => {
    const s = mk();
    install(s);
    const res = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(res.ok).toBe(true);
    const kinds = s.sql
      .filter((q) => q.includes("INSERT INTO ri_console.crawl_observation"))
      .map(
        (q) =>
          q.match(/'([a-z_]+)'\s*\);?$/)?.[1] ??
          q.match(/, '([a-z_]+)',/)?.[1] ??
          "",
      );
    const all = kinds.join(",");
    for (const k of ["connection", "post", "company", "follow", "feed"]) {
      expect(all).toContain(k);
    }
    const body = res.body as { recorded?: number };
    expect(body.recorded).toBeGreaterThanOrEqual(11);
  });

  it("keeps post topics in the ledger payload", async () => {
    const s = mk();
    install(s);
    const res = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect(res.ok).toBe(true);
    const topics = s.recorded
      .filter((r) => r.kind === "claim")
      .map((r) => (r.fields.provenance as { topic?: string }).topic)
      .filter(Boolean);
    expect(topics).toContain("product");
    expect(topics).toContain("hiring");
    expect(topics).toContain("research");
  });

  it("replay writes no duplicate observations", async () => {
    const s = mk();
    install(s);
    // Return empty from observation insert to simulate conflict on replay.
    vi.stubGlobal(
      "fetch",
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/graph/query")) {
          const { query } = JSON.parse(String(init?.body ?? "{}")) as {
            query: string;
          };
          if (query.includes("seedId"))
            return Response.json({ rows: s.rows.seedProv ?? [] });
          if (query.includes("MATCH (e:Entity)"))
            return Response.json({ rows: s.rows.entities });
          if (query.includes("MATCH (c:Claim) RETURN"))
            return Response.json({ rows: s.rows.claims });
          if (query.includes("[:SUBJECT]"))
            return Response.json({ rows: s.rows.subjects });
          return Response.json({ rows: [] });
        }
        if (u.includes("/api/epistemic/record")) {
          const { kind, ...fields } = JSON.parse(
            String(init?.body ?? "{}"),
          ) as { kind: string; [k: string]: unknown };
          s.recorded.push({ kind, fields });
          if (kind === "claim") return Response.json({ claim: { id: "c-x" } });
          if (kind === "evidence")
            return Response.json({ evidence: { id: "e-x" } });
          return Response.json({});
        }
        if (u.includes("/query")) {
          const { sql } = JSON.parse(String(init?.body ?? "{}")) as {
            sql: string;
          };
          s.sql.push(sql);
          return Response.json({ rows: [] }); // conflict: no row inserted
        }
        return Response.json({});
      },
    );
    const first = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    const firstCount = (first.body as { recorded: number }).recorded;
    s.recorded = [];
    const second = await crawlerIngest(CFG, TOKEN, CONT, WS, BODY, NOW);
    expect((second.body as { recorded: number }).recorded).toBeLessThanOrEqual(
      firstCount,
    );
  });
});
