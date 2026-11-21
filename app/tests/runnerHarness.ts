/** Shared harness for RI-0021 runner suites (sealed test sessions, fake Octo). */
import { Readable } from "node:stream";
import { sealData } from "iron-session";
import type { Env } from "../server/env.js";
import { handleRunnerRoutes } from "../server/runners.js";
import type { FakeStore } from "./fakeOcto.js";

export const PID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const WS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const testEnv: Env = {
  OCTO_API_URL: "https://octo.example.test",
  OCTO_API_KEY: "octo_live_ws_testkey",
  OCTO_WORKSPACE_ID: WS,
  SESSION_PASSWORD: "0123456789abcdef0123456789abcdef",
  APP_ORIGIN: "http://127.0.0.1:8790",
  PORT: 8790,
  RI_RUNNER_ONLINE_WINDOW_MS: 1500,
  SLACK_CLIENT_ID: "x",
  SLACK_CLIENT_SECRET: "y",
  CALENDLY_CLIENT_ID: "x",
  CALENDLY_CLIENT_SECRET: "y",
  DISCORD_CLIENT_ID: "x",
  DISCORD_CLIENT_SECRET: "y",
  ZOOM_CLIENT_ID: "x",
  ZOOM_CLIENT_SECRET: "y",
};
export const config = { baseUrl: testEnv.OCTO_API_URL, timeoutMs: 5000 };
export const octoCreds = { token: testEnv.OCTO_API_KEY as string, octo: WS };

export const members = [
  {
    principalId: PID_A,
    email: `${PID_A}@test`,
    role: "owner",
    status: "active",
  },
  {
    principalId: PID_B,
    email: `${PID_B}@test`,
    role: "member",
    status: "active",
  },
];

export async function cookieFor(pid: string): Promise<string> {
  const sealed = await sealData(
    {
      principalId: pid,
      email: `${pid}@test`,
      authMode: "google",
      lastSeenAt: Date.now(),
    },
    { password: testEnv.SESSION_PASSWORD, ttl: 3600 },
  );
  return `ri_session=${sealed}`;
}

export async function callRunner(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string; ip?: string } = {},
) {
  const req = Readable.from(
    opts.body !== undefined ? [JSON.stringify(opts.body)] : [],
  ) as unknown as Record<string, unknown>;
  req.headers = {
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
  };
  req.method = method;
  req.socket = { remoteAddress: opts.ip ?? "127.0.0.1" };
  const res = {
    status: 0,
    body: null as unknown,
    writeHead(s: number) {
      this.status = s;
    },
    end(p?: string) {
      this.body = p ? JSON.parse(p) : null;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  const handled = await handleRunnerRoutes(
    req as never,
    res as never,
    new URL(path, testEnv.APP_ORIGIN),
    testEnv,
  );
  return {
    handled,
    status: res.status,
    body: res.body as Record<string, unknown>,
  };
}

export function seedMember(
  store: FakeStore,
  pid: string,
  ws: string = WS,
): void {
  if (!store.workspace_member) store.workspace_member = [];
  store.workspace_member.push({
    workspace_id: ws,
    principal_id: pid,
    email: `${pid}@test`,
    role: "member",
    status: "active",
  });
}

export async function pairAndClaim(
  store: FakeStore,
  pid: string,
  label = "test-laptop",
) {
  seedMember(store, pid);
  const cookie = await cookieFor(pid);
  const pair = await callRunner("POST", "/app-api/connectors/runner/pair", {
    cookie,
  });
  const claim = await callRunner("POST", "/app-api/connectors/runner/claim", {
    body: { code: pair.body.code, deviceLabel: label },
  });
  return {
    cookie,
    code: String(pair.body.code),
    token: String(claim.body.deviceToken),
    deviceId: String(claim.body.deviceId),
  };
}

export async function grant(pid: string, provider: string, scopes: string[]) {
  return callRunner("POST", "/app-api/connectors/runner/consent", {
    cookie: await cookieFor(pid),
    body: { provider, scopes, granted: true },
  });
}

export const item = (externalId: string, scope = "profile:read") => ({
  externalId,
  title: `T ${externalId}`,
  detail: "d",
  occurredAt: new Date().toISOString(),
  matchText: "m",
  scope,
});
