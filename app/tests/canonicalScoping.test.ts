import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalScope,
  isClaimVisibleToScope,
  readCanonical,
} from "../server/world.js";

const CONTAINER = "fb94977c-695a-422f-a706-6554d8389cf7";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "owner-principal";
const MEMBER_ID = "member-principal";

describe("canonical people & private note scoping (#73)", () => {
  it("keeps legacy untagged imported claims visible only to the container owner", () => {
    const ownerScope: CanonicalScope = {
      workspaceId: CONTAINER,
      octoContainerId: CONTAINER,
      principalId: OWNER_ID,
      isContainerOwner: true,
    };
    const memberScope: CanonicalScope = {
      workspaceId: CONTAINER,
      octoContainerId: CONTAINER,
      principalId: MEMBER_ID,
      isContainerOwner: false,
    };
    const otherWsOwnerScope: CanonicalScope = {
      workspaceId: OTHER_WS,
      octoContainerId: CONTAINER,
      principalId: OWNER_ID,
      isContainerOwner: false,
    };

    // Legacy imported claim with no workspaceId / visibility
    expect(isClaimVisibleToScope({ verb: "NOTE" }, ownerScope)).toBe(true);
    expect(isClaimVisibleToScope({ verb: "NOTE" }, memberScope)).toBe(false);
    expect(isClaimVisibleToScope({ verb: "NOTE" }, otherWsOwnerScope)).toBe(
      false,
    );

    // Explicitly shared claim on container workspace is visible to member too
    expect(
      isClaimVisibleToScope(
        { verb: "WORKS_AT", workspaceId: CONTAINER, visibility: "shared" },
        memberScope,
      ),
    ).toBe(true);
    expect(
      isClaimVisibleToScope(
        { verb: "WORKS_AT", workspaceId: CONTAINER, visibility: "shared" },
        otherWsOwnerScope,
      ),
    ).toBe(false);

    // Private claim owned by a specific principal stays with that author only
    expect(
      isClaimVisibleToScope(
        {
          verb: "NOTE",
          workspaceId: OTHER_WS,
          visibility: "private",
          principalId: MEMBER_ID,
        },
        {
          workspaceId: OTHER_WS,
          octoContainerId: CONTAINER,
          principalId: MEMBER_ID,
          isContainerOwner: false,
        },
      ),
    ).toBe(true);
    expect(
      isClaimVisibleToScope(
        {
          verb: "NOTE",
          workspaceId: OTHER_WS,
          visibility: "private",
          principalId: MEMBER_ID,
        },
        otherWsOwnerScope,
      ),
    ).toBe(false);
  });

  it("prunes private people, private notes, and unreferenced companies for invited members and other workspaces", async () => {
    const mockFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const { query } = JSON.parse(String(init?.body ?? "{}")) as {
          query: string;
        };
        if (query.includes("MATCH (e:Entity)")) {
          return new Response(
            JSON.stringify({
              rows: [
                { id: "p-private", name: "Private Contact", kind: "person" },
                { id: "p-shared", name: "Shared Contact", kind: "person" },
                { id: "org-priv", name: "Secret Co", kind: "org:secret-co" },
                { id: "org-shared", name: "Shared Co", kind: "org:shared-co" },
              ],
            }),
            { status: 200 },
          );
        }
        if (query.includes("MATCH (c:Claim) RETURN")) {
          return new Response(
            JSON.stringify({
              rows: [
                {
                  id: "c-priv-1",
                  statement: "Private imported note about Private Contact",
                  validFrom: "2026-11-19",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "WORKS_AT",
                    org: "secret-co",
                    title: "Founder",
                  }),
                },
                {
                  id: "c-shared-1",
                  statement: "Shared Contact works at Shared Co",
                  validFrom: "2026-11-19",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "WORKS_AT",
                    org: "shared-co",
                    title: "Partner",
                    workspaceId: CONTAINER,
                    visibility: "shared",
                  }),
                },
                {
                  id: "c-shared-priv-note",
                  statement: "Owner private note on Shared Contact",
                  validFrom: "2026-11-20",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "NOTE",
                    workspaceId: CONTAINER,
                    visibility: "private",
                    principalId: OWNER_ID,
                  }),
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (query.includes("[:SUBJECT]")) {
          return new Response(
            JSON.stringify({
              rows: [
                { claimId: "c-priv-1", entityId: "p-private" },
                { claimId: "c-shared-1", entityId: "p-shared" },
                { claimId: "c-shared-priv-note", entityId: "p-shared" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      },
    );

    vi.stubGlobal("fetch", mockFetch);
    try {
      const cfg = { baseUrl: "https://octo.example.test", timeoutMs: 5000 };

      // 1. Container owner sees both people, both companies, and the private note
      const ownerView = await readCanonical(cfg, "tok", CONTAINER, {
        workspaceId: CONTAINER,
        octoContainerId: CONTAINER,
        principalId: OWNER_ID,
        isContainerOwner: true,
      });
      expect(ownerView.people.map((p) => p.id).sort()).toEqual([
        "p-private",
        "p-shared",
      ]);
      expect(ownerView.companies.map((c) => c.id).sort()).toEqual([
        "org-priv",
        "org-shared",
      ]);
      expect(
        ownerView.people.find((p) => p.id === "p-shared")?.claims.length,
      ).toBe(2);

      // 2. Invited member on the same container workspace sees ONLY the shared
      // person, ONLY the shared claim, and ONLY the shared company
      const memberView = await readCanonical(cfg, "tok", CONTAINER, {
        workspaceId: CONTAINER,
        octoContainerId: CONTAINER,
        principalId: MEMBER_ID,
        isContainerOwner: false,
      });
      expect(memberView.people.map((p) => p.id)).toEqual(["p-shared"]);
      expect(memberView.people[0]?.claims.map((c) => c.id)).toEqual([
        "c-shared-1",
      ]);
      expect(memberView.companies.map((c) => c.id)).toEqual(["org-shared"]);

      // 3. Another workspace sees 0 people and 0 companies from CONTAINER
      const otherView = await readCanonical(cfg, "tok", CONTAINER, {
        workspaceId: OTHER_WS,
        octoContainerId: CONTAINER,
        principalId: OWNER_ID,
        isContainerOwner: false,
      });
      expect(otherView.people).toEqual([]);
      expect(otherView.companies).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("imported fact fields populate the people directory (#71)", () => {
  it("derives role, email, tags and summary from sourced FACT attributes", async () => {
    const mockFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const { query } = JSON.parse(String(init?.body ?? "{}")) as {
          query: string;
        };
        if (query.includes("MATCH (e:Entity)")) {
          return new Response(
            JSON.stringify({
              rows: [{ id: "p-1", name: "Amber Atkins", kind: "person" }],
            }),
            { status: 200 },
          );
        }
        if (query.includes("MATCH (c:Claim) RETURN")) {
          return new Response(
            JSON.stringify({
              rows: [
                {
                  id: "c-role",
                  statement:
                    "Amber Atkins, public role summary: Community + Partnerships at Knapsack",
                  validFrom: "2026-10-16",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "FACT",
                    attribute: "public_role_summary",
                    seedId: "role",
                  }),
                },
                {
                  id: "c-email",
                  statement:
                    "Amber Atkins, professional email: amber@knapsack.cloud",
                  validFrom: "2026-10-16",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "FACT",
                    attribute: "professional_email",
                    seedId: "email",
                  }),
                },
                {
                  id: "c-edu",
                  statement:
                    "Amber Atkins, public education: Hofstra University (profile lists)",
                  validFrom: "2026-10-16",
                  supersededAt: null,
                  provenance: JSON.stringify({
                    verb: "FACT",
                    attribute: "public_education",
                    seedId: "edu",
                  }),
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (query.includes("[:SUBJECT]")) {
          return new Response(
            JSON.stringify({
              rows: [
                { claimId: "c-role", entityId: "p-1" },
                { claimId: "c-email", entityId: "p-1" },
                { claimId: "c-edu", entityId: "p-1" },
              ],
            }),
            { status: 200 },
          );
        }
        if (query.includes("[:CITES]")) {
          return new Response(
            JSON.stringify({
              rows: [
                {
                  claimId: "c-role",
                  locator: "https://www.linkedin.com/in/amber",
                  excerpt: "Community + Partnerships at Knapsack",
                },
                {
                  claimId: "c-email",
                  locator: "https://www.linkedin.com/in/amber",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", mockFetch);
    try {
      const view = await readCanonical(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        {
          workspaceId: CONTAINER,
          octoContainerId: CONTAINER,
          principalId: OWNER_ID,
          isContainerOwner: true,
        } satisfies CanonicalScope,
      );
      expect(view.people).toHaveLength(1);
      const person = view.people[0];
      if (!person)
        throw new Error("expected the imported person to be returned");
      expect(person.role).toBe("Community + Partnerships at Knapsack");
      expect(person.email).toBe("amber@knapsack.cloud");
      expect(person.summary).toContain("Community + Partnerships");
      expect(person.tags).toContain("Hofstra University (profile lists)");
      expect(person.claims).toHaveLength(3);
      const roleClaim = person.claims.find((c) => c.id === "c-role");
      expect(roleClaim?.source.locator).toBe(
        "https://www.linkedin.com/in/amber",
      );
      expect(roleClaim?.source.excerpt).toBe(
        "Community + Partnerships at Knapsack",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("events and where-we-met from the ledger (#71)", () => {
  const mockLedger = () =>
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
      };
      if (query.includes("MATCH (e:Entity)")) {
        return new Response(
          JSON.stringify({
            rows: [
              { id: "p-1", name: "Amber Atkins", kind: "person" },
              {
                id: "ev-1",
                name: "Daytona HackSprint",
                kind: "event:daytona-hacksprint-2020-05-05",
              },
              {
                id: "ev-2",
                name: "All City AI Training Tour",
                kind: "event:luma-all-city-ai-2030-01-15",
              },
              {
                id: "ev-3",
                name: "Mystery Luma Event",
                kind: "event:luma-3jtm4813",
              },
              {
                id: "ev-4",
                name: "Compact Dated Event",
                kind: "event:nycdesign-10000year-20201008",
              },
              {
                id: "ev-5",
                name: "Impossible Date Event",
                kind: "event:bad-2026-13-40",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (query.includes("MATCH (c:Claim) RETURN")) {
        return new Response(
          JSON.stringify({
            rows: [
              {
                id: "c-met",
                statement:
                  "[UNVERIFIED] Amber Atkins: (self reported) met at Daytona HackSprint",
                validFrom: "2020-05-06",
                supersededAt: null,
                provenance: JSON.stringify({ verb: "UNVERIFIED" }),
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (query.includes("[:SUBJECT]")) {
        return new Response(
          JSON.stringify({
            rows: [{ claimId: "c-met", entityId: "p-1" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });

  it("reads dated events, derives attendees from met-at notes, skips undated slugs", async () => {
    vi.stubGlobal("fetch", mockLedger());
    try {
      const view = await readCanonical(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        {
          workspaceId: CONTAINER,
          octoContainerId: CONTAINER,
          principalId: OWNER_ID,
          isContainerOwner: true,
        } satisfies CanonicalScope,
      );
      // ev-3 has no day in its slug and ev-5's day is not a real date:
      // neither may be emitted, because the console formats date unguarded.
      expect(view.events.map((e) => e.id)).toEqual(["ev-1", "ev-4", "ev-2"]);
      const hack = view.events.find((e) => e.id === "ev-1");
      expect(hack?.attendeeIds).toEqual(["p-1"]);
      expect(hack?.status).toBe("past");
      expect(hack?.date).toBe("2020-05-05T00:00:00.000Z");
      const compact = view.events.find((e) => e.id === "ev-4");
      expect(compact?.date).toBe("2020-10-08T00:00:00.000Z");
      const upcoming = view.events.find((e) => e.id === "ev-2");
      expect(upcoming?.status).toBe("upcoming");
      expect(upcoming?.attendeeIds).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides legacy private meeting history from non-owner members", async () => {
    vi.stubGlobal("fetch", mockLedger());
    try {
      const view = await readCanonical(
        { baseUrl: "https://octo.example.test", timeoutMs: 5000 },
        "tok",
        CONTAINER,
        {
          workspaceId: CONTAINER,
          octoContainerId: CONTAINER,
          principalId: MEMBER_ID,
          isContainerOwner: false,
        } satisfies CanonicalScope,
      );
      // The untagged met-at note is owner-only, so the member sees neither
      // the person nor any event tied to that private history.
      expect(view.people).toHaveLength(0);
      expect(view.events).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
