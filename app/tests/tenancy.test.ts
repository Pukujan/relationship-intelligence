import { describe, expect, it, vi } from "vitest";
import type { Env } from "../server/env.js";
import type { AppSession } from "../server/session.js";
import {
  normalizeRole,
  requireRole,
  resolvePrincipalWorkspaces,
} from "../server/tenancy.js";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PRINCIPAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const baseEnv: Env = {
  PORT: 4000,
  APP_ORIGIN: "http://localhost:4000",
  OCTO_API_URL: "https://octo.example.test",
  OCTO_API_KEY: "octo_live_ws_ownerkey",
  SESSION_PASSWORD: "0123456789abcdef0123456789abcdef",
  RI_RUNNER_ONLINE_WINDOW_MS: 90000,
};

describe("tenancy role ordering (RI-0012 / #37)", () => {
  it("enforces owner > admin > operator > member", () => {
    expect(requireRole("owner", "owner")).toBe(true);
    expect(requireRole("owner", "admin")).toBe(true);
    expect(requireRole("admin", "owner")).toBe(false);
    expect(requireRole("admin", "operator")).toBe(true);
    expect(requireRole("operator", "admin")).toBe(false);
    expect(requireRole("operator", "member")).toBe(true);
    expect(requireRole("member", "operator")).toBe(false);
    expect(requireRole("member", "member")).toBe(true);
    expect(requireRole(null, "member")).toBe(false);
  });

  it("normalizes role strings safely", () => {
    expect(normalizeRole("ADMIN")).toBe("admin");
    expect(normalizeRole(" operator ")).toBe("operator");
    expect(normalizeRole("unknown")).toBeNull();
  });
});

describe("principalId-mode membership scoping (RI-0012 / #37)", () => {
  it("filters out foreign workspaces and resolves member role from Octo members", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workspaces")) {
        return new Response(
          JSON.stringify([
            { id: WS_A, slug: "ws-a", name: "Workspace A", role: "owner" },
            { id: WS_B, slug: "ws-b", name: "Workspace B", role: "owner" },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/workspaces/${WS_A}/members`)) {
        return new Response(
          JSON.stringify({
            members: [
              {
                principalId: PRINCIPAL_ID,
                email: "teammate@example.com",
                role: "member",
                status: "active",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/workspaces/${WS_B}/members`)) {
        return new Response(
          JSON.stringify({
            members: [
              {
                principalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                email: "owner@example.com",
                role: "owner",
                status: "active",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const session = {
        principalId: PRINCIPAL_ID,
        email: "teammate@example.com",
        displayName: "Teammate",
      } as AppSession;
      const resolved = await resolvePrincipalWorkspaces(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        baseEnv,
        session,
      );
      expect(resolved.workspaces).toHaveLength(1);
      expect(resolved.workspaces[0]?.id).toBe(WS_A);
      expect(resolved.workspaces[0]?.role).toBe("member");
      expect(resolved.workspaces[0]?.isOwner).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores revoked and pending memberships", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workspaces")) {
        return new Response(
          JSON.stringify([
            { id: WS_A, slug: "ws-a", name: "Workspace A", role: "owner" },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/workspaces/${WS_A}/members`)) {
        return new Response(
          JSON.stringify({
            members: [
              {
                principalId: PRINCIPAL_ID,
                email: "teammate@example.com",
                role: "admin",
                status: "revoked",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const session = {
        principalId: PRINCIPAL_ID,
        email: "teammate@example.com",
      } as AppSession;
      const resolved = await resolvePrincipalWorkspaces(
        { baseUrl: baseEnv.OCTO_API_URL, timeoutMs: 5000 },
        baseEnv,
        session,
      );
      expect(resolved.workspaces).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
