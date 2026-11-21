import { describe, expect, it } from "vitest";
import {
  handleRagQuery,
  RAG_CAPABILITY_FORWARD_HEADER,
  RAG_CAPABILITY_HEADER,
  RagResponseSchema,
  sealRagCapability,
  unsealRagCapability,
} from "../server/copilotProxy.js";
import type { Env } from "../server/env.js";

const ENV: Env = {
  PORT: 8787,
  APP_ORIGIN: "http://localhost:5173",
  OCTO_API_URL: "https://octo.example.test",
  OCTO_API_KEY: "octo_live_ws_shared_key",
  OCTO_WORKSPACE_ID: "11111111-1111-4111-8111-111111111111",
  SESSION_PASSWORD: "0123456789abcdef0123456789abcdef",
  RI_RUNNER_ONLINE_WINDOW_MS: 90000,
};

/**
 * Minimal HTTP response recorder. The RAG route only needs writeHead/end and
 * the session reader needs writableEnded, so no real server is required.
 */
function fakeResponse() {
  let status = 0;
  let text = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(body?: string | Uint8Array) {
      text += typeof body === "string" ? body : new TextDecoder().decode(body);
      return this;
    },
    writableEnded: false,
    get status() {
      return status;
    },
    get body() {
      return text ? JSON.parse(text) : null;
    },
  };
  return res;
}

function fakeRequest(headers: Record<string, string> = {}) {
  return { method: "GET", headers, on() {}, destroy() {} } as never;
}

const ragUrl = (q = "cold outreach") =>
  new URL(
    `/app-api/rag/query?q=${encodeURIComponent(q)}&limit=2`,
    ENV.APP_ORIGIN,
  );

describe("signed-in RAG route (#62 / CONSOLE.md:157)", () => {
  it("rejects a query with no capability (401)", async () => {
    const res = fakeResponse();
    await handleRagQuery(fakeRequest(), res as never, ENV, ragUrl());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("rejects a forged or malformed capability", async () => {
    const res = fakeResponse();
    await handleRagQuery(
      fakeRequest({ [RAG_CAPABILITY_HEADER]: "not-a-sealed-capability" }),
      res as never,
      ENV,
      ragUrl(),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the capability the adapter forwards to the copilot", async () => {
    const cap = await sealRagCapability(ENV);
    expect(await unsealRagCapability(ENV, cap)).toBe(true);
    expect(await unsealRagCapability(ENV, undefined)).toBe(false);
  });

  it("rejects a capability signed with a different session password", async () => {
    const cap = await sealRagCapability(ENV);
    const other = {
      ...ENV,
      SESSION_PASSWORD: "fedcba9876543210fedcba9876543210",
    };
    expect(await unsealRagCapability(other, cap)).toBe(false);
  });

  it("mints a capability that stays valid across proxy-copilot and callback roles", async () => {
    const cap = await sealRagCapability(ENV);
    expect(await unsealRagCapability(ENV, cap)).toBe(true);
    expect(RAG_CAPABILITY_FORWARD_HEADER).not.toBe(RAG_CAPABILITY_HEADER);
  });

  it("rejects malformed Octo payloads with a Zod validation error", async () => {
    const good = { matches: [{ text: "ok", locator: "l" }] };
    expect(RagResponseSchema.safeParse(good).success).toBe(true);
    expect(
      RagResponseSchema.safeParse({ matches: [{ text: 42 }] }).success,
    ).toBe(false);
    expect(
      RagResponseSchema.safeParse({ matches: "not-an-array" }).success,
    ).toBe(false);
  });
});
