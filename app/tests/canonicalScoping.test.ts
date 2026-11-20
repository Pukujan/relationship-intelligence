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
