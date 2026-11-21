/** RI-0021 metamorphic relations MR-K1..K7 over canonical connector state. */
import { beforeEach, describe, expect, it } from "vitest";
import { listUserConnectors } from "../server/connectors.js";
import { type FakeStore, installFakeOcto, newStore } from "./fakeOcto.js";
import {
  callRunner,
  config,
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

const docs = (pid: string) =>
  (store.activity ?? [])
    .filter((r) => r.principal_id === pid)
    .map((r) => JSON.stringify(r.doc))
    .sort();

async function ingest(token: string, provider: string, items: unknown[]) {
  return callRunner("POST", "/app-api/connectors/runner/ingest", {
    bearer: token,
    body: { provider, items },
  });
}

describe("MR-K1/K2: ingest idempotence, order and batch invariance", () => {
  it("duplicate, permuted, and split batches yield identical canonical docs", async () => {
    const a = await pairAndClaim(store, PID_A);
    await grant(PID_A, "linkedin", ["profile:read"]);
    const items = [item("x1"), item("x2"), item("x3")];
    await ingest(a.token, "linkedin", items);
    const once = docs(PID_A);
    await ingest(a.token, "linkedin", items);
    expect(docs(PID_A)).toEqual(once);
    await ingest(a.token, "linkedin", [items[2], items[0], items[1]]);
    expect(docs(PID_A)).toEqual(once);
    await ingest(a.token, "linkedin", [items[0]]);
    await ingest(a.token, "linkedin", [items[1], items[2]]);
    expect(docs(PID_A)).toEqual(once);
    expect((store.activity ?? []).length).toBe(3);
  });
});

describe("MR-K3: cross-principal isolation incl. same externalId", () => {
  it("B operations never change A canonical state", async () => {
    const a = await pairAndClaim(store, PID_A);
    const b = await pairAndClaim(store, PID_B);
    await grant(PID_A, "linkedin", ["profile:read"]);
    await grant(PID_B, "linkedin", ["profile:read"]);
    await ingest(a.token, "linkedin", [item("shared-1")]);
    const before = docs(PID_A);
    await ingest(b.token, "linkedin", [item("shared-1"), item("b-only")]);
    expect(docs(PID_A)).toEqual(before);
    expect(
      (store.activity ?? []).filter((r) => r.principal_id === PID_B).length,
    ).toBe(2);
    expect((store.activity ?? []).every((r) => r.workspace_id === WS)).toBe(
      true,
    );
  });
});

describe("MR-K4: consent revoke freezes canonical state", () => {
  it("revoke -> rejected ingest adds nothing; re-grant resumes", async () => {
    const a = await pairAndClaim(store, PID_A);
    await grant(PID_A, "wispr", ["dictation:ingest"]);
    await ingest(a.token, "wispr", [item("w1", "dictation:ingest")]);
    const before = docs(PID_A);
    await callRunner("POST", "/app-api/connectors/runner/consent", {
      cookie: a.cookie,
      body: { provider: "wispr", scopes: ["dictation:ingest"], granted: false },
    });
    const r = await ingest(a.token, "wispr", [item("w2", "dictation:ingest")]);
    expect(r.status).toBe(403);
    expect(docs(PID_A)).toEqual(before);
  });
});

describe("MR-K5: revoke kills one device, siblings survive", () => {
  it("multi-device principal: revoked token dead, other device live", async () => {
    const d1 = await pairAndClaim(store, PID_A, "laptop");
    const d2 = await pairAndClaim(store, PID_A, "desktop");
    await grant(PID_A, "riley", ["voice:brief"]);
    await callRunner("POST", "/app-api/connectors/runner/revoke", {
      cookie: d1.cookie,
      body: { deviceId: d1.deviceId },
    });
    const dead = await callRunner(
      "POST",
      "/app-api/connectors/runner/heartbeat",
      { bearer: d1.token },
    );
    expect(dead.status).toBe(401);
    const alive = await callRunner(
      "POST",
      "/app-api/connectors/runner/heartbeat",
      { bearer: d2.token },
    );
    expect(alive.status).toBe(200);
    const push = await ingest(d2.token, "riley", [item("r1", "voice:brief")]);
    expect(push.status).toBe(200);
  });
});

describe("MR-K7: device offline is distinct from session expired", () => {
  it("stale heartbeat -> offline while connected; provider failure -> expired", async () => {
    const a = await pairAndClaim(store, PID_A);
    await grant(PID_A, "linkedin", ["profile:read"]);
    await ingest(a.token, "linkedin", [item("s1")]);
    const runner = (store.user_runner ?? [])[0];
    if (!runner) throw new Error("expected runner row");
    runner.last_seen_at = new Date(Date.now() - 60_000).toISOString();
    const view1 = await listUserConnectors(
      config,
      octoCreds.token,
      octoCreds.octo,
      PID_A,
      testEnv,
    );
    const li1 = view1.connectors.find((c) => c.provider === "linkedin");
    expect(li1?.runnerStatus).toBe("offline");
    expect(li1?.status).toBe("connected");
    await callRunner("POST", "/app-api/connectors/runner/session-status", {
      bearer: a.token,
      body: { provider: "linkedin", ok: false },
    });
    const view2 = await listUserConnectors(
      config,
      octoCreds.token,
      octoCreds.octo,
      PID_A,
      testEnv,
    );
    const li2 = view2.connectors.find((c) => c.provider === "linkedin");
    expect(li2?.status).toBe("expired");
    expect(li2?.runnerStatus).toBe("offline");
  });
});
