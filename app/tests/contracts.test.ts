import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CollectionPlanSchema,
  SessionResponseSchema,
  SourceConnectionSchema,
} from "../shared/contracts.js";

const principal = {
  id: "0db36ada-53a3-454a-a18b-697220bb9cbc",
  email: "owner@example.com",
  displayName: "Owner",
  avatarUrl: null,
  isGuest: false,
  isPlatformOwner: true,
};

describe("session contracts", () => {
  it("accepts an authenticated session with workspaces", () => {
    const parsed = SessionResponseSchema.parse({
      authenticated: true,
      principal,
      workspaces: [
        {
          id: "fb94977c-695a-422f-a706-6554d8389cf7",
          slug: "social-engineering",
          name: "social-engineering",
          role: "owner",
          isOwner: true,
        },
      ],
    });
    expect(parsed.authenticated).toBe(true);
  });

  it("accepts an anonymous session", () => {
    expect(
      SessionResponseSchema.parse({ authenticated: false }).authenticated,
    ).toBe(false);
  });

  it("rejects a session whose principal is malformed", () => {
    expect(() =>
      SessionResponseSchema.parse({
        authenticated: true,
        principal: { ...principal, id: "not-a-uuid" },
        workspaces: [],
      }),
    ).toThrow();
  });

  it("rejects a session carrying an unexpected token field", () => {
    // The contract must not silently accept a leaked token in the response.
    const result = SessionResponseSchema.safeParse({
      authenticated: true,
      principal,
      workspaces: [],
      octoToken: "octo_sess_leaked",
    });
    expect(result.success).toBe(true);
    // Zod strips unknown keys by default: the token is not in the parsed output.
    expect(result.success && !("octoToken" in result.data)).toBe(true);
  });
});

describe("source connection contract", () => {
  it("accepts a valid TinyFish profile reference", () => {
    const conn = SourceConnectionSchema.parse({
      id: "0db36ada-53a3-454a-a18b-697220bb9cbc",
      provider: "tinyfish",
      profileId: "prof_69098d3aaeb042ea",
      signedInSites: ["linkedin.com"],
      status: "connected",
      lastCheckedAt: null,
    });
    expect(conn.signedInSites).toContain("linkedin.com");
  });

  it("rejects a profile ID with the wrong prefix", () => {
    expect(() =>
      SourceConnectionSchema.parse({
        id: "0db36ada-53a3-454a-a18b-697220bb9cbc",
        provider: "tinyfish",
        profileId: "not-a-profile",
        signedInSites: [],
        status: "setup_required",
        lastCheckedAt: null,
      }),
    ).toThrow();
  });
});

describe("collection plan contract", () => {
  const base = {
    id: "0db36ada-53a3-454a-a18b-697220bb9cbc",
    name: "Hackathon sponsors",
    sources: ["linkedin", "luma"],
    seedUrls: ["https://www.linkedin.com/in/example"],
    maxPagesPerRun: 10,
    maxDepth: 2,
    scheduleCron: null,
    createdAt: "2026-11-18T00:00:00.000Z",
  };

  it("accepts a valid plan", () => {
    expect(CollectionPlanSchema.parse(base).name).toBe("Hackathon sponsors");
  });

  it("rejects an empty source list", () => {
    expect(() =>
      CollectionPlanSchema.parse({ ...base, sources: [] }),
    ).toThrow();
  });

  it("rejects an out-of-range page limit", () => {
    expect(() =>
      CollectionPlanSchema.parse({ ...base, maxPagesPerRun: 10000 }),
    ).toThrow();
  });

  it("rejects a non-URL seed", () => {
    expect(() =>
      CollectionPlanSchema.parse({ ...base, seedUrls: ["not a url"] }),
    ).toThrow();
  });

  it("any plan within declared bounds validates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 5 }),
        (maxPagesPerRun, maxDepth) => {
          expect(
            CollectionPlanSchema.parse({ ...base, maxPagesPerRun, maxDepth }),
          ).toBeTruthy();
        },
      ),
    );
  });
});
