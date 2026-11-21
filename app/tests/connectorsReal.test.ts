/** RI-0021 public deterministic suite: boundaries, pairing, consent, secrets. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createConnectorRoute,
  listUserConnectors,
  saveUserConnector,
} from "../server/connectors.js";
import type { Env } from "../server/env.js";
import type { AppSessionData } from "../server/session.js";
import {
  beginOauthState,
  consumeOauthState,
  OAUTH_STATE_TTL_MS,
} from "../server/session.js";
import { type FakeStore, installFakeOcto, newStore } from "./fakeOcto.js";
import {
  callRunner,
  config,
  cookieFor,
  grant,
  item,
  members,
  octoCreds,
  PID_A,
  PID_B,
  pairAndClaim,
  testEnv,
  WS,
} from "./runnerHarness.js";

let store: FakeStore;
beforeEach(() => {
  store = newStore();
  installFakeOcto(store, members);
});

describe("pairing hygiene (I4, R2)", () => {
  it("code claims exactly once", async () => {
    const d = await pairAndClaim(store, PID_A);
    expect(d.token).toMatch(/^[0-9a-f]{48}$/);
    const again = await callRunner("POST", "/app-api/connectors/runner/claim", {
      body: { code: d.code, deviceLabel: "x" },
    });
    expect(again.status).toBe(400);
  });
  it("expired code rejected", async () => {
    const cookie = await cookieFor(PID_A);
    const pair = await callRunner("POST", "/app-api/connectors/runner/pair", {
      cookie,
    });
    const pairing = (store.runner_pairing ?? [])[0];
    if (!pairing) throw new Error("expected pairing row");
    pairing.expires_at = new Date(Date.now() - 1000).toISOString();
    const claim = await callRunner("POST", "/app-api/connectors/runner/claim", {
      body: { code: pair.body.code, deviceLabel: "x" },
    });
    expect(claim.status).toBe(400);
  });
  it("new pair invalidates prior unused codes", async () => {
    const cookie = await cookieFor(PID_A);
    const p1 = await callRunner("POST", "/app-api/connectors/runner/pair", {
      cookie,
    });
    await callRunner("POST", "/app-api/connectors/runner/pair", { cookie });
    const claim = await callRunner("POST", "/app-api/connectors/runner/claim", {
      body: { code: p1.body.code, deviceLabel: "x" },
    });
    expect(claim.status).toBe(400);
  });
  it("rate limits brute force per IP", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await callRunner("POST", "/app-api/connectors/runner/claim", {
        body: { code: "AAAAAAAA", deviceLabel: "x" },
        ip: "10.0.0.9",
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});

describe("device auth + revocation (I1, I5, R6)", () => {
  it("unknown token 401 INVALID_DEVICE_TOKEN; revoked 401 DEVICE_REVOKED", async () => {
    const d = await pairAndClaim(store, PID_A);
    const bad = await callRunner(
      "POST",
      "/app-api/connectors/runner/heartbeat",
      { bearer: "f".repeat(48) },
    );
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("INVALID_DEVICE_TOKEN");
    const rev = await callRunner("POST", "/app-api/connectors/runner/revoke", {
      cookie: d.cookie,
      body: { deviceId: d.deviceId },
    });
    expect(rev.status).toBe(200);
    const hb = await callRunner(
      "POST",
      "/app-api/connectors/runner/heartbeat",
      { bearer: d.token },
    );
    expect(hb.status).toBe(401);
    expect(hb.body.error).toBe("DEVICE_REVOKED");
  });
  it("B cannot revoke A's device (I2)", async () => {
    const a = await pairAndClaim(store, PID_A);
    const r = await callRunner("POST", "/app-api/connectors/runner/revoke", {
      cookie: await cookieFor(PID_B),
      body: { deviceId: a.deviceId },
    });
    expect(r.status).toBe(404);
  });
});

describe("consent gating (I3, R10, R11)", () => {
  it("no consent -> 403; unconsented scope -> rejected; re-grant restores", async () => {
    const d = await pairAndClaim(store, PID_A);
    const no = await callRunner("POST", "/app-api/connectors/runner/ingest", {
      bearer: d.token,
      body: { provider: "linkedin", items: [item("e1")] },
    });
    expect(no.status).toBe(403);
    await grant(PID_A, "linkedin", ["profile:read"]);
    const mixed = await callRunner(
      "POST",
      "/app-api/connectors/runner/ingest",
      {
        bearer: d.token,
        body: {
          provider: "linkedin",
          items: [item("e1"), item("e2", "messages:read")],
        },
      },
    );
    expect(mixed.status).toBe(200);
    expect((mixed.body.accepted as unknown[]).length).toBe(1);
    expect((mixed.body.rejected as { reason: string }[])[0]?.reason).toBe(
      "SCOPE_NOT_CONSENTED",
    );
    await callRunner("POST", "/app-api/connectors/runner/consent", {
      cookie: d.cookie,
      body: { provider: "linkedin", scopes: ["profile:read"], granted: false },
    });
    const after = await callRunner(
      "POST",
      "/app-api/connectors/runner/ingest",
      { bearer: d.token, body: { provider: "linkedin", items: [item("e3")] } },
    );
    expect(after.status).toBe(403);
    await grant(PID_A, "linkedin", ["profile:read", "messages:read"]);
    const ok = await callRunner("POST", "/app-api/connectors/runner/ingest", {
      bearer: d.token,
      body: { provider: "linkedin", items: [item("e2", "messages:read")] },
    });
    expect((ok.body.accepted as unknown[]).length).toBe(1);
  });
  it("consent scopes must be catalog subsets", async () => {
    const r = await callRunner("POST", "/app-api/connectors/runner/consent", {
      cookie: await cookieFor(PID_A),
      body: { provider: "linkedin", scopes: ["admin:write"], granted: true },
    });
    expect(r.status).toBe(400);
  });
});

describe("boundaries and secrets (R7, R8, R16, R6)", () => {
  it("disconnect clears tokens server-side", async () => {
    await saveUserConnector(
      config,
      octoCreds.token,
      octoCreds.octo,
      WS,
      PID_A,
      {
        provider: "slack",
        status: "connected",
        accessToken: "sekrit",
        refreshToken: "r",
      },
    );
    await saveUserConnector(
      config,
      octoCreds.token,
      octoCreds.octo,
      WS,
      PID_A,
      { provider: "slack", status: "needs_setup", clearTokens: true },
    );
    const row = (store.user_connector ?? []).find(
      (r) => r.provider === "slack",
    );
    expect(row?.access_token).toBeNull();
    expect(row?.refresh_token).toBeNull();
  });
  it("setup response carries no tokens or hashes", async () => {
    const d = await pairAndClaim(store, PID_A);
    await grant(PID_A, "wispr", ["dictation:ingest"]);
    const setup = await callRunner("GET", "/app-api/connectors/runner/setup", {
      cookie: d.cookie,
    });
    const text = JSON.stringify(setup.body);
    expect(text).not.toContain(d.token);
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain("code_hash");
  });
  it("ingest over 256KB -> clean 413", async () => {
    const d = await pairAndClaim(store, PID_A);
    await grant(PID_A, "wispr", ["dictation:ingest"]);
    const big = {
      provider: "wispr",
      items: [item("b1", "dictation:ingest")],
      filler: "a".repeat(300_000),
    };
    const r = await callRunner("POST", "/app-api/connectors/runner/ingest", {
      bearer: d.token,
      body: big,
    });
    expect(r.status).toBe(413);
    expect(r.body.error).toBe("BODY_TOO_LARGE");
  });
  it("accountHint capped; session-status ok=false -> expired", async () => {
    const d = await pairAndClaim(store, PID_A);
    await grant(PID_A, "linkedin", ["profile:read"]);
    const bad = await callRunner(
      "POST",
      "/app-api/connectors/runner/session-status",
      {
        bearer: d.token,
        body: { provider: "linkedin", ok: true, accountHint: "x".repeat(130) },
      },
    );
    expect(bad.status).toBe(400);
    const ok = await callRunner(
      "POST",
      "/app-api/connectors/runner/session-status",
      { bearer: d.token, body: { provider: "linkedin", ok: true } },
    );
    expect(ok.body.status).toBe("connected");
    const exp = await callRunner(
      "POST",
      "/app-api/connectors/runner/session-status",
      { bearer: d.token, body: { provider: "linkedin", ok: false } },
    );
    expect(exp.body.status).toBe("expired");
  });
  it("route targets require active membership (R4)", async () => {
    const r = await createConnectorRoute(
      config,
      octoCreds.token,
      octoCreds.octo,
      PID_A,
      [WS],
      {
        provider: "gmail",
        matchExpr: "*",
        targetWorkspaceId: "ws-foreign",
        cadence: "signal",
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.error).toBe("TARGET_NOT_MEMBER");
  });
});

describe("unconfigured OAuth view (R19 label contract)", () => {
  it("no creds -> null connectUrl; creds -> provider start url", async () => {
    const envNo = { ...testEnv } as Env;
    delete envNo.SLACK_CLIENT_ID;
    delete envNo.SLACK_CLIENT_SECRET;
    const viewNo = await listUserConnectors(
      config,
      octoCreds.token,
      octoCreds.octo,
      PID_A,
      envNo,
    );
    const slackNo = viewNo.connectors.find((c) => c.provider === "slack");
    expect(slackNo?.connectUrl).toBeNull();
    expect(slackNo?.oauthConfigured).toBe(false);
    const viewYes = await listUserConnectors(
      config,
      octoCreds.token,
      octoCreds.octo,
      PID_A,
      testEnv,
    );
    const slackYes = viewYes.connectors.find((c) => c.provider === "slack");
    expect(slackYes?.connectUrl).toContain("/oauth/slack/start");
    expect(slackYes?.oauthConfigured).toBe(true);
  });
});

describe("OAuth state single-use (R12, MR-K6)", () => {
  it("consumes once, rejects replay and foreign provider", () => {
    const s: AppSessionData = {};
    const st = beginOauthState(s, "slack");
    expect(consumeOauthState(s, "slack", st)).toBe(true);
    expect(consumeOauthState(s, "slack", st)).toBe(false);
    const st2 = beginOauthState(s, "discord");
    expect(consumeOauthState(s, "slack", st2)).toBe(false);
    const s3: AppSessionData = {};
    const st3 = beginOauthState(s3, "zoom");
    s3.connectorOauthStates = {
      zoom: { state: st3, createdAt: Date.now() - OAUTH_STATE_TTL_MS - 1 },
    };
    expect(consumeOauthState(s3, "zoom", st3)).toBe(false);
  });
});
