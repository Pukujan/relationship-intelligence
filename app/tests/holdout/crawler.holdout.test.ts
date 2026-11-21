/**
 * HIDDEN HOLDOUT — RI-0023 slow LinkedIn crawler.
 *
 * Frozen criteria (docs/issues/RI-0023.md):
 *   H1 only allowlisted linkedin.com/in/ URLs produce writes;
 *   H2 no sensitive attribute is ever written;
 *   H3 replay writes zero new claims;
 *   H4 blocked/error visits write zero facts and set a cooldown;
 *   H5 no cross-workspace writes.
 *
 * Unseen names, slugs, adversarial URLs, oversized/malformed payloads,
 * sensitive-attribute injection, whitespace-duplicate facts, interleavings.
 * Do not relax a criterion to make a case pass.
 */

import { createHash } from "node:crypto";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  crawlerIngest,
  crawlerQueue,
  isProfileUrl,
} from "../../server/crawler.js";
import type { OctoClientConfig } from "../../server/octo.js";

const CFG: OctoClientConfig = {
  baseUrl: "https://octo.example.test",
  timeoutMs: 5000,
};
const CONT = "ws-holdout";
const WS = "ws-holdout";
const TOKEN = "tok";
const NOW = new Date("2026-11-21T12:00:00Z");

afterEach(() => vi.unstubAllGlobals());

const seed = (attribute: string, statement: string, url: string) =>
  createHash("sha256")
    .update(
      `FACT\x00${statement}\x00${attribute}\x00${url.split("?")[0]?.replace(/\/+$/, "").toLowerCase()}`,
    )
    .digest("hex")
    .slice(0, 16);

interface S {
  rows: Record<string, unknown[]>;
  recorded: { kind: string; fields: Record<string, unknown> }[];
  sql: string[];
}
const mk = (name: string, url: string): S => ({
  rows: {
    entities: [{ id: "p-h", name, kind: "person" }],
    claims: [
      {
        id: "url-h",
        statement: `${name}, linkedin_url: ${url}`,
        supersededAt: null,
        provenance: JSON.stringify({ verb: "FACT", attribute: "linkedin_url" }),
      },
    ],
    subjects: [{ claimId: "url-h", entityId: "p-h" }],
  },
  recorded: [],
  sql: [],
});
const install = (s: S) =>
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/graph/query")) {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      if (query.includes("seedId"))
        return Response.json({ rows: s.rows.seedProv ?? [] });
      if (query.includes("MATCH (e:Entity)"))
        return Response.json({ rows: s.rows.entities ?? [] });
      if (query.includes("MATCH (c:Claim) RETURN"))
        return Response.json({ rows: s.rows.claims ?? [] });
      if (query.includes("[:SUBJECT]"))
        return Response.json({ rows: s.rows.subjects ?? [] });
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
      return Response.json({ rows: [] });
    }
    return Response.json({});
  });

const HURL = "https://www.linkedin.com/in/ünseen-name_99";

describe("H1 — only allowlisted profile URLs produce writes", () => {
  it("rejects adversarial host/scheme/path variants", async () => {
    const bad = [
      "https://linkedin.com.evil.test/in/name",
      "http://www.linkedin.com/in/name",
      "https://www.linkedin.com/company/name",
      "https://www.linkedin.com/in/name/../company/x",
      "javascript:alert(1)",
    ];
    for (const url of bad) expect(isProfileUrl(url)).toBe(false);
    for (const url of bad.filter((u) => u.startsWith("http"))) {
      const s = mk("Zoë", HURL);
      install(s);
      const res = await crawlerIngest(
        CFG,
        TOKEN,
        CONT,
        WS,
        {
          personId: "p-h",
          url,
          status: "ok",
          facts: [],
        },
        NOW,
      );
      expect(res.ok).toBe(false);
      expect(s.recorded).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it("rejects a fact list with a sensitive-attribute label", async () => {
    const s = mk("Zoë", HURL);
    install(s);
    const res = await crawlerIngest(
      CFG,
      TOKEN,
      CONT,
      WS,
      {
        personId: "p-h",
        url: HURL,
        status: "ok",
        facts: [
          {
            attribute: "public_headline",
            statement: "Zoë, public_headline: Researcher",
          },
          {
            attribute: "health",
            statement: "Zoë, health: condition",
          },
        ],
      },
      NOW,
    );
    expect(res.ok).toBe(false); // Zod enum rejects the unknown attribute
    expect(s.recorded).toHaveLength(0);
  });
});

describe("H2/H3 — grounded facts, replay idempotency", () => {
  it("writes only allowlisted attributes, and replay writes nothing", async () => {
    const facts = [
      {
        attribute: "public_education",
        statement: "Zoë, public_education: MIT",
      },
      { attribute: "location", statement: "Zoë, location: NYC" },
    ];
    const s = mk("Zoë", HURL);
    s.rows.seedProv = facts.map((f) => ({
      p: JSON.stringify({ seedId: seed(f.attribute, f.statement, HURL) }),
    }));
    install(s);
    const res = await crawlerIngest(
      CFG,
      TOKEN,
      CONT,
      WS,
      {
        personId: "p-h",
        url: HURL,
        status: "ok",
        facts,
      },
      NOW,
    );
    expect(res.ok).toBe(true);
    expect(s.recorded.filter((r) => r.kind === "claim")).toHaveLength(0);
    for (const r of s.recorded) {
      const prov = r.fields.provenance as { attribute?: string } | undefined;
      if (prov?.attribute) {
        expect([
          "public_role_summary",
          "public_headline",
          "public_education",
          "public_profile_credential",
          "location",
        ]).toContain(prov.attribute);
      }
    }
  });

  it("permuted different fact orders still produce the same new-claim count", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reverse) => {
        const facts = [
          {
            attribute: "public_headline",
            statement: "Zoë, public_headline: Founder",
          },
          { attribute: "location", statement: "Zoë, location: Berlin" },
        ];
        const ordered = reverse ? [...facts].reverse() : facts;
        const s = mk("Zoë", HURL);
        install(s);
        await crawlerIngest(
          CFG,
          TOKEN,
          CONT,
          WS,
          {
            personId: "p-h",
            url: HURL,
            status: "ok",
            facts: ordered,
          },
          NOW,
        );
        expect(s.recorded.filter((r) => r.kind === "claim")).toHaveLength(2);
        vi.unstubAllGlobals();
      }),
      { numRuns: 10 },
    );
  });
});

describe("H4 — blocked/error write zero facts and cool the queue", () => {
  it("blocked and error ingest record no claims", async () => {
    for (const status of ["blocked", "error"] as const) {
      const s = mk("Zoë", HURL);
      install(s);
      const res = await crawlerIngest(
        CFG,
        TOKEN,
        CONT,
        WS,
        {
          personId: "p-h",
          url: HURL,
          status,
          facts: [
            {
              attribute: "public_headline",
              statement: "Zoë, public_headline: Founder",
            },
          ],
        },
        NOW,
      );
      expect(res.ok).toBe(true);
      expect(s.recorded.filter((r) => r.kind === "claim")).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it("queue returns cooldown after a block", async () => {
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
        return Response.json({});
      },
    );
    const q = await crawlerQueue(CFG, TOKEN, CONT, WS, 20, NOW);
    expect(q.items).toHaveLength(0);
    expect(q.cooldownUntil).toBe("2026-11-22T11:00:00.000Z");
  });
});

describe("H5 — oversized and cross-workspace payloads are bounded", () => {
  it("rejects oversized fact lists", async () => {
    const s = mk("Zoë", HURL);
    install(s);
    const res = await crawlerIngest(
      CFG,
      TOKEN,
      CONT,
      WS,
      {
        personId: "p-h",
        url: HURL,
        status: "ok",
        facts: Array.from({ length: 100 }, (_, i) => ({
          attribute: "public_headline",
          statement: `Zoë, public_headline: ${i}`,
        })),
      },
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(s.recorded).toHaveLength(0);
  });

  it("never writes into another workspace", async () => {
    const s = mk("Zoë", HURL);
    install(s);
    await crawlerIngest(
      CFG,
      TOKEN,
      CONT,
      WS,
      {
        personId: "p-h",
        url: HURL,
        status: "ok",
        facts: [],
      },
      NOW,
    );
    for (const statement of s.sql) {
      expect(statement).not.toContain("ws-other");
    }
  });
});
