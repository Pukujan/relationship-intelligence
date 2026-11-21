/** RI-0021 daemon unit tests (node:test). Stub server exercises the client paths. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import { pairDevice, pushFile, startRileyServer, watchWispr } from "./daemon.js";
import { normalizePairingCode, redactSecrets } from "./contracts.js";
import { modeOf } from "./state.js";

let server: Server;
let base = "";
const ingested: { provider: string; items: Record<string, unknown>[] }[] = [];
let usedCode: string | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      const url = req.url ?? "";
      const send = (status: number, obj: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (url.endsWith("/claim")) {
        if (usedCode === json.code) return send(400, { error: "INVALID_PAIRING_CODE" });
        usedCode = json.code;
        return send(200, { deviceToken: "a".repeat(48), deviceId: "dev-1", principalId: "p-1" });
      }
      if (url.endsWith("/heartbeat")) return send(200, { consents: [{ provider: "wispr", scopes: ["dictation:ingest"], granted: true }, { provider: "riley", scopes: ["voice:brief", "voice:triage"], granted: true }], now: new Date().toISOString() });
      if (url.endsWith("/ingest")) { ingested.push({ provider: json.provider, items: json.items }); return send(200, { accepted: json.items.map((i: { externalId: string }) => ({ externalId: i.externalId, id: "x-" + i.externalId })), rejected: [] }); }
      if (url.endsWith("/session-status")) return send(200, { ok: true, status: "connected" });
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

test("Crockford normalization and redaction", () => {
  assert.equal(normalizePairingCode("abiol1o0"), "AB101100");
  assert.equal(redactSecrets("token=abc123 ok", ["abc123"]), "token=[REDACTED] ok");
});

test("pair writes 0600 device.json under 0700 root; code single-use", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ri-daemon-test-"));
  process.env.RI_DAEMON_ROOT = root;
  const out = await pairDevice("ABCD1234", base, "test-laptop");
  assert.equal(modeOf(out.file).toString(8), "600");
  assert.equal(modeOf(root).toString(8), "700");
  const state = JSON.parse(readFileSync(out.file, "utf8"));
  assert.equal(state.deviceToken, "a".repeat(48));
  assert.match(state.localSecret, /^[0-9a-f]{64}$/);
  await assert.rejects(() => pairDevice("ABCD1234", base, "again"));
});

test("push sends only derived signals with consented scopes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ri-daemon-push-"));
  process.env.RI_DAEMON_ROOT = root;
  await pairDevice("WXYZ1234", base, "push");
  const file = path.join(root, "items.json");
  writeFileSync(file, JSON.stringify([{ externalId: "w1", title: "Wispr note", detail: "text", occurredAt: new Date().toISOString(), matchText: "text", scope: "dictation:ingest" }]));
  await pushFile("wispr", file);
  const last = ingested[ingested.length - 1];
  assert.equal(last?.provider, "wispr");
  const item = last?.items[0] ?? {};
  assert.deepEqual(Object.keys(item).sort(), ["detail", "externalId", "matchText", "occurredAt", "scope", "title"]);
});

test("riley-serve gates secret, Host, Origin; accepts valid brief", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ri-daemon-riley-"));
  process.env.RI_DAEMON_ROOT = root;
  await pairDevice("RILY1234", base, "riley");
  const state = JSON.parse(readFileSync(path.join(root, "device.json"), "utf8"));
  const s = await startRileyServer(0);
  const port = s.port;
  const brief = { id: "b1", title: "Morning brief", detail: "d", occurredAt: new Date().toISOString(), kind: "brief" };
  const noSecret = await fetch(`http://127.0.0.1:${port}/brief`, { method: "POST", body: JSON.stringify(brief) });
  assert.equal(noSecret.status, 403);
  const badOrigin = await fetch(`http://127.0.0.1:${port}/brief`, { method: "POST", headers: { "X-Riley-Secret": state.localSecret, Origin: "https://evil.example" }, body: JSON.stringify(brief) });
  assert.equal(badOrigin.status, 403);
  const ok = await fetch(`http://127.0.0.1:${port}/brief`, { method: "POST", headers: { "X-Riley-Secret": state.localSecret }, body: JSON.stringify(brief) });
  assert.equal(ok.status, 200);
  assert.equal(ingested[ingested.length - 1]?.provider, "riley");
  await s.close();
});

test("wispr-watch ingests valid exports and skips invalid", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ri-daemon-wispr-"));
  process.env.RI_DAEMON_ROOT = root;
  await pairDevice("WSPR1234", base, "wispr");
  const dir = path.join(root, "exports");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "good.json"), JSON.stringify({ id: "d1", text: "hello world", createdAt: new Date().toISOString() }));
  writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ nope: true }));
  await watchWispr(dir, true);
  assert.equal(ingested[ingested.length - 1]?.provider, "wispr");
  assert.ok(readFileSync(path.join(dir, "processed", "good.json"), "utf8").includes("d1"));
});
