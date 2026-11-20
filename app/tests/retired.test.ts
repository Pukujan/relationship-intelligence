import { describe, expect, it } from "vitest";
import { retiredEntityIds, strengthOf } from "../server/world.js";

const claim = (id: string, verb: string, superseded = false) => ({
  id,
  supersededAt: superseded ? "2026-11-20T00:00:00Z" : null,
  provenance: JSON.stringify({ verb }),
});

describe("retired records stay off the screen (#71)", () => {
  it("retires an entity whose only current claims are retirements", () => {
    const subjectOf = new Map([
      ["c1", "sample"],
      ["c2", "sample"],
      ["c3", "real"],
    ]);
    const retired = retiredEntityIds(
      [
        claim("c1", "WORKS_AT", true),
        claim("c2", "RETIRED"),
        claim("c3", "MET"),
      ],
      subjectOf,
    );
    expect([...retired]).toEqual(["sample"]);
  });

  it("keeps an entity that still has a live claim beside a retirement", () => {
    const subjectOf = new Map([
      ["c1", "person"],
      ["c2", "person"],
    ]);
    expect(
      retiredEntityIds([claim("c1", "RETIRED"), claim("c2", "FACT")], subjectOf)
        .size,
    ).toBe(0);
  });

  it("ignores a superseded retirement and claims with unreadable provenance", () => {
    const subjectOf = new Map([
      ["c1", "a"],
      ["c2", "b"],
    ]);
    const retired = retiredEntityIds(
      [
        claim("c1", "RETIRED", true),
        { id: "c2", supersededAt: null, provenance: "not json" },
      ],
      subjectOf,
    );
    expect(retired.size).toBe(0);
  });

  // Metamorphic: the answer must not depend on the order claims arrive in.
  it("(metamorphic) claim order does not change who is retired", () => {
    const subjectOf = new Map([
      ["c1", "x"],
      ["c2", "x"],
      ["c3", "y"],
      ["c4", "z"],
      ["c5", "z"],
    ]);
    const claims = [
      claim("c1", "RETIRED"),
      claim("c2", "MET", true),
      claim("c3", "RETIRED"),
      claim("c4", "RETIRED"),
      claim("c5", "WORKS_AT"),
    ];
    const expected = [...retiredEntityIds(claims, subjectOf)].sort();
    expect(expected).toEqual(["x", "y"]);
    for (const order of [
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
      [1, 4, 0, 3, 2],
    ]) {
      const shuffled = order
        .map((i) => claims[i])
        .filter((c) => c !== undefined);
      expect([...retiredEntityIds(shuffled, subjectOf)].sort()).toEqual(
        expected,
      );
    }
  });
});

describe("relationship strength (#71)", () => {
  it("scores every strength the loader accepts, in order", () => {
    expect(strengthOf("strong")).toBeGreaterThan(strengthOf("met-once"));
    expect(strengthOf("met-once")).toBeGreaterThan(strengthOf("weak"));
    expect(strengthOf("weak")).toBeGreaterThan(0);
    expect(strengthOf("something else")).toBe(0);
  });
});
