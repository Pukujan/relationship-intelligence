import { describe, expect, it } from "vitest";
import {
  copilotGate,
  MEMBERSHIP_TRUST_MS,
  NO_SUCH_WORKSPACE,
  recentlyMember,
  rememberMember,
  withSessionPrincipal,
  workspaceRequiredFor,
} from "../server/copilotProxy.js";
import { IDLE_LIMIT_MS } from "../server/session.js";

describe("copilot proxy gate (#62)", () => {
  const now = 1_800_000_000_000;

  it("refuses a request with no signed-in session", () => {
    expect(copilotGate({}, now)).toEqual({
      ok: false,
      status: 401,
      body: { error: "UNAUTHENTICATED" },
    });
  });

  it("refuses a session that has been idle past the limit", () => {
    const gate = copilotGate(
      { principalId: "p1", lastSeenAt: now - IDLE_LIMIT_MS - 1 },
      now,
    );
    expect(gate).toMatchObject({
      ok: false,
      status: 401,
      body: { reason: "idle_expired" },
    });
  });

  it("lets a fresh signed-in session through with its own principal", () => {
    expect(
      copilotGate({ principalId: "p1", lastSeenAt: now - 1000 }, now),
    ).toEqual({ ok: true, principalId: "p1" });
    expect(copilotGate({ octoToken: "octo_sess_x" }, now)).toEqual({
      ok: true,
      principalId: null,
    });
  });

  it("replaces the principal the browser named with the session's", () => {
    const sent = JSON.stringify({ prompt: "hi", principalId: "someone-else" });
    expect(JSON.parse(withSessionPrincipal(sent, "p1"))).toEqual({
      prompt: "hi",
      principalId: "p1",
    });
    // With no principal on the session, a claimed one is dropped, not trusted.
    expect(JSON.parse(withSessionPrincipal(sent, null))).toEqual({
      prompt: "hi",
    });
  });

  // Metamorphic: whatever the browser claims, the forwarded principal is the
  // session's, and every other field passes through untouched.
  it("(metamorphic) the forwarded principal never depends on the claimed one", () => {
    const base = { prompt: "who should I call?", digest: { people: 3 } };
    const claims = [undefined, "", "p1", "admin", 42, null, { id: "x" }];
    for (const claim of claims) {
      const sent = JSON.stringify(
        claim === undefined ? base : { ...base, principalId: claim },
      );
      expect(JSON.parse(withSessionPrincipal(sent, "p1"))).toEqual({
        ...base,
        principalId: "p1",
      });
    }
  });

  it("requires a token session to belong to the app's own container", () => {
    // A guest token lists the guest's personal workspace; only the container counts.
    expect(workspaceRequiredFor({ octoToken: "octo_sess_guest" }, "ws-1")).toBe(
      "ws-1",
    );
    expect(
      workspaceRequiredFor({ octoToken: "octo_sess_guest" }, " ws-1 "),
    ).toBe("ws-1");
    // With no container configured, a token session can never pass.
    for (const missing of [undefined, "", "   "]) {
      expect(
        workspaceRequiredFor({ octoToken: "octo_sess_guest" }, missing),
      ).toBe(NO_SUCH_WORKSPACE);
    }
    // A Google sign-in session has no token: any verified membership will do.
    expect(workspaceRequiredFor({}, "ws-1")).toBeUndefined();
  });

  it("trusts a membership check for a minute and no longer", () => {
    expect(recentlyMember("p-new", now)).toBe(false);
    rememberMember("p-new", now);
    expect(recentlyMember("p-new", now + MEMBERSHIP_TRUST_MS - 1)).toBe(true);
    expect(recentlyMember("p-new", now + MEMBERSHIP_TRUST_MS)).toBe(false);
    // One account's membership says nothing about another's.
    rememberMember("p-a", now);
    expect(recentlyMember("p-b", now)).toBe(false);
  });

  it("passes through bodies that are not JSON objects", () => {
    expect(withSessionPrincipal("", "p1")).toBe("");
    expect(withSessionPrincipal("not json", "p1")).toBe("not json");
    expect(withSessionPrincipal("[1,2]", "p1")).toBe("[1,2]");
  });
});
