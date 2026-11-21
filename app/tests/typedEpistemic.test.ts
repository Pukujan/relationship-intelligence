import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalScope,
  parseProvenance,
  readCanonical,
  readClaimsAsOf,
  readWorldAsOf,
  retiredEntityIds,
} from "../server/world.js";
import {
  ClaimSchema,
  EvidenceSchema,
  ProvenanceSchema,
  RelationshipVerbSchema,
  SourceRecordIdSchema,
  SupersedesRelationSchema,
} from "../shared/contracts.js";

const CONTAINER = "fb94977c-695a-422f-a706-6554d8389cf7";
const OWNER_ID = "owner-principal";
const MEMBER_ID = "member-principal";

describe("typed epistemic contracts", () => {
  it("accepts a controlled verb and preserves legacy verbs in provenance", () => {
    expect(RelationshipVerbSchema.parse("WORKS_AT")).toBe("WORKS_AT");
    expect(RelationshipVerbSchema.safeParse("RETIRED").success).toBe(false);
    expect(ProvenanceSchema.parse({ verb: "FACT", seedId: "x" }).verb).toBe(
      "FACT",
    );
    expect(parseProvenance("not json")).toEqual({});
    expect(parseProvenance({ verb: "SAME_AS", status: "SOURCED" }).verb).toBe(
      "SAME_AS",
    );
  });

  it("validates source record ids, evidence, claims and supersession", () => {
    expect(
      SourceRecordIdSchema.parse({
        source_system: "linkedin",
        source_record_id: "prof_123",
      }).source_system,
    ).toBe("linkedin");
    expect(() =>
      SourceRecordIdSchema.parse({ source_system: "linkedin" }),
    ).toThrow();
    expect(
      EvidenceSchema.safeParse({ locator: "https://x.test" }).success,
    ).toBe(true);
    const claim = ClaimSchema.parse({
      id: "c1",
      statement: "x works at y",
      provenance: { verb: "WORKS_AT", status: "SOURCED" },
    });
    expect(claim.provenance.status).toBe("SOURCED");
    expect(
      SupersedesRelationSchema.safeParse({
        id: "r1",
        fromClaimId: "c2",
        toClaimId: "c1",
        relation: "SUPERSEDES",
      }).success,
    ).toBe(true);
    expect(
      SupersedesRelationSchema.safeParse({
        id: "r1",
        fromClaimId: "c2",
        toClaimId: "c1",
        relation: "SUPPORTS",
      }).success,
    ).toBe(false);
  });
});

describe("scope-first retirement", () => {
  const memberScope: CanonicalScope = {
    workspaceId: CONTAINER,
    octoContainerId: CONTAINER,
    principalId: MEMBER_ID,
    isContainerOwner: false,
  };

  it("does not let a private RETIRED claim hide a shared entity for another principal", () => {
    const claims = [
      {
        id: "c-retired-private",
        statement: "[RETIRED] shared person",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "RETIRED",
          workspaceId: CONTAINER,
          visibility: "private",
          principalId: OWNER_ID,
        }),
      },
      {
        id: "c-shared",
        statement: "Shared person works at Shared Co",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "WORKS_AT",
          workspaceId: CONTAINER,
          visibility: "shared",
        }),
      },
    ];
    const subjectOf = new Map([
      ["c-retired-private", "p-shared"],
      ["c-shared", "p-shared"],
    ]);
    // Unscoped, the retirement and the shared claim cancel out: the entity is not retired.
    expect([...retiredEntityIds(claims, subjectOf)]).toEqual([]);
    // Only retirement claims on an entity retire it (legacy behavior preserved).
    expect([...retiredEntityIds(claims.slice(0, 1), subjectOf)]).toEqual([
      "p-shared",
    ]);
    // Scoped to a member, the private retirement is invisible; the shared claim keeps the entity.
    expect([...retiredEntityIds(claims, subjectOf, [], memberScope)]).toEqual(
      [],
    );
  });
});

describe("typed claim status and evidence in readCanonical", () => {
  const ownerScope: CanonicalScope = {
    workspaceId: CONTAINER,
    octoContainerId: CONTAINER,
    principalId: OWNER_ID,
    isContainerOwner: true,
  };

  function mockGraph(claimRows: Record<string, unknown>[]) {
    return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      if (query.includes("MATCH (e:Entity)")) {
        return new Response(
          JSON.stringify({
            rows: [{ id: "p1", name: "A Person", kind: "person" }],
          }),
          { status: 200 },
        );
      }
      if (query.includes("MATCH (c:Claim) RETURN")) {
        return new Response(JSON.stringify({ rows: claimRows }), {
          status: 200,
        });
      }
      if (query.includes("[:SUBJECT]")) {
        return new Response(
          JSON.stringify({
            rows: claimRows.map((c) => ({ claimId: c.id, entityId: "p1" })),
          }),
          { status: 200 },
        );
      }
      if (query.includes("[:CITES]")) {
        return new Response(
          JSON.stringify({
            rows: [
              {
                claimId: "c-src",
                evidenceId: "e1",
                locator: "https://site.test/a",
                quote: "a verbatim quote",
                contentHash: "sha256:abc",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (query.includes("[:ABOUT]")) {
        return new Response(
          JSON.stringify({
            rows: [
              {
                claimId: "c-src",
                beliefId: "b1",
                stance: "believes",
                confidence: 0.9,
                perspective: "researcher",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });
  }

  it("marks typed SOURCED claims with evidence as sourced, and UNVERIFIED as unverified with no summary", async () => {
    const rows = [
      {
        id: "c-src",
        statement: "Sourced public role: Engineer",
        validFrom: "2026-01-01",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "FACT",
          attribute: "public_role_summary",
          status: "SOURCED",
        }),
      },
      {
        id: "c-unverified",
        statement: "Unverified rumor about this person",
        validFrom: "2026-02-01",
        supersededAt: null,
        provenance: JSON.stringify({ verb: "NOTE", status: "UNVERIFIED" }),
      },
    ];
    vi.stubGlobal("fetch", mockGraph(rows));
    try {
      const view = await readCanonical(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        ownerScope,
      );
      const person = view.people[0];
      if (!person) throw new Error("expected person");
      const sourced = person.claims.find((c) => c.id === "c-src");
      const unverified = person.claims.find((c) => c.id === "c-unverified");
      expect(sourced?.status).toBe("sourced");
      expect(sourced?.claimStatus).toBe("SOURCED");
      expect(sourced?.contentHash).toBe("sha256:abc");
      expect(sourced?.beliefs).toEqual([
        { stance: "believes", perspective: "researcher", confidence: 0.9 },
      ]);
      expect(unverified?.status).toBe("unverified");
      expect(unverified?.claimStatus).toBe("UNVERIFIED");
      expect(person.summary).not.toContain("Unverified rumor");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes each claim's verb, attribute and how-we-met basis through for the profile page", async () => {
    const rows = [
      {
        id: "c-src",
        statement: "A Person, public education: NYU",
        validFrom: "2026-01-01",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "FACT",
          attribute: "public_education",
          status: "SOURCED",
        }),
      },
      {
        id: "c-met",
        statement: "A Person knows The Owner (met-once)",
        validFrom: "2026-03-01",
        supersededAt: null,
        provenance: JSON.stringify({
          verb: "MET",
          strength: "met-once",
          basis: "Met at GIS Day after the panel",
        }),
      },
    ];
    vi.stubGlobal("fetch", mockGraph(rows));
    try {
      const view = await readCanonical(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        ownerScope,
      );
      const claims = view.people[0]?.claims ?? [];
      const fact = claims.find((c) => c.id === "c-src");
      const met = claims.find((c) => c.id === "c-met");
      expect(fact?.verb).toBe("FACT");
      expect(fact?.attribute).toBe("public_education");
      expect(met?.verb).toBe("MET");
      expect(met?.basis).toBe("Met at GIS Day after the panel");
      expect(met?.attribute).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("bitemporal claims-as-of", () => {
  it("validates the response contract and sends the session token", async () => {
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const url = new URL(String(_input));
        expect(url.pathname).toBe("/api/epistemic/claims-as-of");
        expect(url.searchParams.get("workspaceId")).toBe(CONTAINER);
        expect(url.searchParams.get("asOfRecorded")).toBe(
          "2026-01-01T00:00:00Z",
        );
        expect(url.searchParams.get("asOfValid")).toBe("2025-12-01T00:00:00Z");
        return new Response(
          JSON.stringify({
            asOfRecorded: "2026-01-01T00:00:00Z",
            asOfValid: "2025-12-01T00:00:00Z",
            claims: [
              {
                id: "c1",
                statement: "old role",
                provenance: { verb: "WORKS_AT", status: "SOURCED" },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", mockFetch);
    try {
      const rows = await readClaimsAsOf(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "session-token",
        CONTAINER,
        "2026-01-01T00:00:00Z",
        "2025-12-01T00:00:00Z",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("c1");
      const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(
        ((init?.headers ?? {}) as Record<string, string>).Authorization,
      ).toBe("Bearer session-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a malformed claims-as-of response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ claims: [{ id: 123 }] }), {
            status: 200,
          }),
      ),
    );
    try {
      await expect(
        readClaimsAsOf(
          { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
          "tok",
          CONTAINER,
          "2026-01-01T00:00:00Z",
        ),
      ).rejects.toThrow(/contract validation/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses as-of claims in readWorldAsOf projection", async () => {
    const mockFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const text = String(init?.body ?? "");
        const url = String(_url);
        if (url.includes("claims-as-of")) {
          return new Response(
            JSON.stringify({
              asOfRecorded: "2026-01-01T00:00:00Z",
              asOfValid: null,
              claims: [
                {
                  id: "c-asof",
                  statement: "As-of role: Engineer",
                  provenance: {
                    verb: "FACT",
                    attribute: "public_role_summary",
                    status: "SOURCED",
                    visibility: "shared",
                    workspaceId: "fb94977c-695a-422f-a706-6554d8389cf7",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        const parsed = text
          ? (JSON.parse(text) as { query?: string; sql?: string })
          : {};
        if (parsed.query?.includes("MATCH (e:Entity)")) {
          return new Response(
            JSON.stringify({
              rows: [{ id: "p1", name: "As Of Person", kind: "person" }],
            }),
            { status: 200 },
          );
        }
        if (parsed.query?.includes("[:SUBJECT]")) {
          return new Response(
            JSON.stringify({ rows: [{ claimId: "c-asof", entityId: "p1" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", mockFetch);
    try {
      const world = await readWorldAsOf(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        { id: OWNER_ID, displayName: "Owner" },
        [{ id: CONTAINER, name: "Workspace" }],
        "2026-01-01T00:00:00Z",
      );
      expect(world.people).toHaveLength(1);
      expect(world.people[0]?.summary).toContain("As-of role");
      expect(
        mockFetch.mock.calls.some((call) =>
          String(call[0]).includes("claims-as-of"),
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
