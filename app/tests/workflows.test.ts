import { describe, expect, it } from "vitest";
import { evaluateCondition, resolveTemplate } from "../server/workflows.js";
import { WORKFLOW_NODE_DEFS } from "../shared/contracts.js";

describe("workflow template resolution", () => {
  const ctx = {
    input: { price: 42, nested: { name: "acme" } },
    payload: { value: 7 },
    now: "2026-01-01",
  };
  it("preserves type for a whole-value template", () => {
    expect(resolveTemplate("{{input.price}}", ctx)).toBe(42);
  });
  it("interpolates into a string", () => {
    expect(resolveTemplate("price is {{input.price}} today", ctx)).toBe(
      "price is 42 today",
    );
  });
  it("reads nested paths and payload", () => {
    expect(
      resolveTemplate("{{input.nested.name}}/{{payload.value}}", ctx),
    ).toBe("acme/7");
  });
  it("renders missing paths as empty", () => {
    expect(resolveTemplate("x{{input.missing}}y", ctx)).toBe("xy");
  });
  it("passes non-strings through", () => {
    expect(resolveTemplate(5, ctx)).toBe(5);
  });
});

describe("workflow condition evaluator", () => {
  it("compares equality as strings", () => {
    expect(evaluateCondition(42, "eq", "42")).toBe(true);
    expect(evaluateCondition("a", "neq", "b")).toBe(true);
  });
  it("compares numbers", () => {
    expect(evaluateCondition(10, "gt", 5)).toBe(true);
    expect(evaluateCondition(5, "gte", 5)).toBe(true);
    expect(evaluateCondition(3, "lt", 2)).toBe(false);
  });
  it("contains is case-insensitive", () => {
    expect(evaluateCondition("Hello World", "contains", "world")).toBe(true);
  });
  it("truthy / empty handle arrays and objects", () => {
    expect(evaluateCondition([], "truthy", null)).toBe(false);
    expect(evaluateCondition([1], "truthy", null)).toBe(true);
    expect(evaluateCondition({}, "truthy", null)).toBe(false);
    expect(evaluateCondition("", "empty", null)).toBe(true);
    expect(evaluateCondition("x", "empty", null)).toBe(false);
  });
  it("unknown operator is false", () => {
    expect(evaluateCondition(1, "bogus", 1)).toBe(false);
  });
});

describe("workflow node catalog", () => {
  it("has a trigger and a branching condition", () => {
    expect(WORKFLOW_NODE_DEFS.some((d) => d.category === "trigger")).toBe(true);
    const cond = WORKFLOW_NODE_DEFS.find((d) => d.type === "action.condition");
    expect(cond?.outputs).toEqual(["true", "false"]);
  });
  it("every node type is unique", () => {
    const types = WORKFLOW_NODE_DEFS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
