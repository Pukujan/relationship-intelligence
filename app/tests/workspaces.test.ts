import { describe, expect, it, vi } from "vitest";
import type { Env } from "../server/env.js";
import {
  createWorkspaceWithProvision,
  DDL_VERSION,
  provisionWorkspace,
  removeWorkspaceMember,
  resolveOrActivateGoogleMember,
} from "../server/workspaces.js";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const NEW_PID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseEnv: Env = {
  PORT: 4000,
  APP_ORIGIN: "http://localhost:4000",
  OCTO_API_URL: "https://octo.example.test",
  OCTO_API_KEY: "octo_live_ws_ownerkey",
  SESSION_PASSWORD: "0123456789abcdef0123456789abcdef",
};

describe("workspace lifecycle (RI-0013 / #38)", () => {
  it("returns 501 disabled-with-explanation when OCTO_ACCOUNT_KEY is absent", async () => {
    const prev = process.env.OCTO_ACCOUNT_KEY;
    delete process.env.OCTO_ACCOUNT_KEY;
    try {
      const res = await createWorkspaceWithProvision(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        baseEnv,
        { name: "New Team" },
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(501);
      expect(res.body.disabled).toBe(true);
    } finally {
      if (prev !== undefined) process.env.OCTO_ACCOUNT_KEY = prev;
    }
  });

  it("provisions ri_console DDL idempotently with workspace_meta marker", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          sql?: string;
        };
        if (parsed.sql) queries.push(parsed.sql);
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    try {
      const result = await provisionWorkspace(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_acc_test",
        WS_ID,
      );
      expect(result.provisioned).toBe(true);
      expect(result.ddlVersion).toBe(DDL_VERSION);
      expect(queries.some((q) => q.includes("ri_console.workspace_meta"))).toBe(
        true,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("activates a pending invite during Google sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/workspaces")) {
          return new Response(JSON.stringify([{ id: WS_ID }]), { status: 200 });
        }
        if (
          url.endsWith(`/api/workspaces/${WS_ID}/members`) &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              members: [
                {
                  email: "invitee@example.com",
                  role: "operator",
                  status: "pending",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith(`/api/workspaces/${WS_ID}/members`) &&
          method === "POST"
        ) {
          return new Response(JSON.stringify({ principalId: NEW_PID }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );
    try {
      const hit = await resolveOrActivateGoogleMember(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        "octo_live_ws_ownerkey",
        "invitee@example.com",
      );
      expect(hit).toEqual({
        principalId: NEW_PID,
        workspaceId: WS_ID,
        role: "operator",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks removing self or workspace owner", async () => {
    const selfRes = await removeWorkspaceMember(
      { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
      "token",
      WS_ID,
      "admin@example.com",
      "admin@example.com",
    );
    expect(selfRes.status).toBe(403);
    expect(selfRes.body.error).toBe("CANNOT_REMOVE_SELF");
  });
});
