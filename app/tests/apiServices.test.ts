import { describe, expect, it } from "vitest";
import { serviceView } from "../server/apiServices.js";
import { deriveApiServiceChip, type ApiServiceView } from "../shared/contracts.js";

const row = (over: Record<string, unknown> = {}) => ({
  id: "svc-1", provider: "tinyfish", name: "TinyFish", base_url: "",
  cred_json: JSON.stringify({ apiKey: "tf_super_secret_key_123456" }),
  status: "connected", last_test: JSON.stringify({ ok: true, message: "Connected", at: "2026-01-01" }),
  ...over,
});

describe("api service browser view", () => {
  it("never exposes the raw key", () => {
    const v = serviceView(row() as never);
    expect(JSON.stringify(v)).not.toContain("tf_super_secret_key_123456");
    expect(v.keyHint).toContain("…");
    expect(v.provider).toBe("tinyfish");
  });
  it("reports rest headers without leaking them", () => {
    const v = serviceView(row({ provider: "rest", base_url: "https://api.x.com", cred_json: JSON.stringify({ headers: { Authorization: "Bearer SECRET_TOKEN_VALUE" } }) }) as never);
    expect(v.hasHeaders).toBe(true);
    expect(JSON.stringify(v)).not.toContain("SECRET_TOKEN_VALUE");
  });
  it("parses last test", () => {
    const v = serviceView(row() as never);
    expect(v.lastTest?.ok).toBe(true);
  });
});

describe("api service chip", () => {
  const base: ApiServiceView = { id: "x", provider: "tinyfish", name: "n", baseUrl: "", status: "connected", keyHint: "", hasHeaders: false, lastTest: null };
  it("connected is ok", () => {
    expect(deriveApiServiceChip(base).tone).toBe("ok");
  });
  it("failed test is error", () => {
    expect(deriveApiServiceChip({ ...base, status: "needs_setup", lastTest: { ok: false, message: "bad" } }).tone).toBe("error");
  });
  it("untested needs setup is warn", () => {
    expect(deriveApiServiceChip({ ...base, status: "needs_setup" }).tone).toBe("warn");
  });
});
