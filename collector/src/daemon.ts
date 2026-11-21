/**
 * RI-0021 local runner daemon (collection slice 2). Builds on the slice-1
 * proof: attach over CDP to a human-started real browser; never launch, never
 * see credentials, read-only, no stealth, cookies never leave the machine.
 *
 * Commands: pair, start, signin, collect, wispr-watch, riley-serve, push, status.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, renameSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext } from "playwright";
import { RunnerApi, DeviceAuthError } from "./api.js";
import {
  normalizePairingCode,
  PairingCodeSchema,
  RileyBriefSchema,
  RunnerProviderSchema,
  WisprExportFileSchema,
  ingestItemSchema,
  type IngestItem,
  type RunnerProvider,
} from "./contracts.js";
import { daemonRoot, ensureRoot, loadDevice, newLocalSecret, saveDevice, writeEvidence, modeOf, devicePath } from "./state.js";

const CDP_URL = process.env.RI_CDP_URL ?? "http://127.0.0.1:9222";

export async function pairDevice(code: string, server: string, label: string): Promise<{ deviceId: string; file: string }> {
  const normalized = normalizePairingCode(code);
  PairingCodeSchema.parse(normalized);
  const api = new RunnerApi(server);
  const claim = await api.claim(normalized, label);
  const root = ensureRoot(daemonRoot());
  const file = saveDevice(root, {
    deviceToken: claim.deviceToken,
    deviceId: claim.deviceId,
    server,
    localSecret: newLocalSecret(),
    principalId: claim.principalId,
    deviceLabel: label,
  });
  return { deviceId: claim.deviceId, file };
}

function apiFromDevice(): { api: RunnerApi; device: NonNullable<ReturnType<typeof loadDevice>> } {
  const device = loadDevice(daemonRoot());
  if (!device) throw new Error("not paired. Run: pnpm run daemon -- pair --code <CODE> --server <URL>");
  return { api: new RunnerApi(device.server, device.deviceToken), device };
}

export async function heartbeatOnce(): Promise<void> {
  const { api } = apiFromDevice();
  try {
    const hb = await api.heartbeat();
    console.log(JSON.stringify({ ok: true, consents: hb.consents }));
  } catch (e) {
    if (e instanceof DeviceAuthError) {
      console.error(e.code === "DEVICE_REVOKED" ? "device revoked by owner; re-pair to continue" : "device token invalid; re-pair to continue");
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

async function attachedContext(): Promise<{ ctx: BrowserContext; close: () => Promise<void> }> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context; start your real browser with --remote-debugging-port=9222 and sign in first");
  return { ctx, close: () => browser.close() };
}

async function linkedinSessionOk(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies("https://www.linkedin.com");
  return cookies.some((c) => c.name === "li_at" && c.value.length > 0);
}

export async function signin(provider: "linkedin" | "luma"): Promise<void> {
  const { api } = apiFromDevice();
  const { ctx, close } = await attachedContext();
  try {
    const ok = provider === "linkedin" ? await linkedinSessionOk(ctx) : (await ctx.cookies("https://lu.ma")).length > 0;
    await api.sessionStatus(provider, ok);
    writeEvidence(daemonRoot(), `signin-${provider}.json`, { provider, ok, at: new Date().toISOString() });
    console.log(JSON.stringify({ provider, ok }));
    if (!ok) process.exitCode = 1;
  } finally {
    await close();
  }
}

export async function collect(provider: "linkedin" | "luma"): Promise<void> {
  const { api } = apiFromDevice();
  const hb = await api.heartbeat();
  const consent = hb.consents.find((c) => c.provider === provider && c.granted);
  if (!consent) throw new Error(`no granted consent for ${provider}; enable scopes in the console first`);
  const { ctx, close } = await attachedContext();
  const items: IngestItem[] = [];
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (provider === "linkedin") {
      await page.goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4000);
      const ok = await linkedinSessionOk(ctx);
      await api.sessionStatus("linkedin", ok);
      if (!ok || /login|authwall|checkpoint/.test(page.url())) throw new Error("LinkedIn session expired or challenged; re-sign-in in your browser");
      const h1 = (await page.locator("h1").first().innerText().catch(() => "")) || "own profile";
      if (consent.scopes.includes("profile:read")) {
        items.push({ externalId: "own-profile", title: `LinkedIn: ${h1}`.slice(0, 200), detail: "read-only own-profile visit", occurredAt: new Date().toISOString(), matchText: h1, scope: "profile:read" });
      }
    } else {
      await page.goto("https://lu.ma/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4000);
      const ok = (await ctx.cookies("https://lu.ma")).length > 0;
      await api.sessionStatus("luma", ok);
      if (!ok) throw new Error("Luma session expired; re-sign-in in your browser");
      if (consent.scopes.includes("events:read")) {
        const titles = await page.locator("h3, [data-testid='event-name']").allInnerTexts().catch(() => []);
        for (const t of titles.slice(0, 8)) {
          items.push({ externalId: `luma-${t.slice(0, 60)}`, title: `Luma: ${t}`.slice(0, 200), detail: "own events page, read-only", occurredAt: new Date().toISOString(), matchText: t, scope: "events:read" });
        }
      }
    }
  } finally {
    await close();
  }
  if (items.length > 0) {
    const res = await api.ingest(provider, items);
    writeEvidence(daemonRoot(), `collect-${provider}.json`, { accepted: res.accepted, rejected: res.rejected });
    console.log(JSON.stringify(res));
  } else {
    console.log(JSON.stringify({ accepted: [], rejected: [] }));
  }
}

export async function pushFile(provider: RunnerProvider, file: string): Promise<void> {
  const { api } = apiFromDevice();
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const items = Array.isArray(raw) ? raw : (raw as { items?: unknown }).items;
  const parsed = ingestItemSchema(provider).array().min(1).max(50).parse(items);
  const res = await api.ingest(provider, parsed);
  console.log(JSON.stringify(res));
}

export async function watchWispr(dir: string, once = false): Promise<void> {
  const { api } = apiFromDevice();
  const processed = path.join(dir, "processed");
  mkdirSync(processed, { recursive: true });
  const tick = async (): Promise<number> => {
    let n = 0;
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const file = path.join(dir, name);
      const parsed = WisprExportFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!parsed.success) continue;
      const records = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      const items: IngestItem[] = records.slice(0, 50).map((r) => ({
        externalId: r.id, title: `Wispr: ${r.text.slice(0, 80)}`, detail: r.text.slice(0, 2000), occurredAt: r.createdAt, matchText: r.text.slice(0, 2000), scope: "dictation:ingest",
      }));
      await api.ingest("wispr", items);
      renameSync(file, path.join(processed, name));
      n += items.length;
    }
    return n;
  };
  if (once) { console.log(JSON.stringify({ ingested: await tick() })); return; }
  for (;;) { await tick(); await new Promise((r) => setTimeout(r, 5000)); }
}

export async function startRileyServer(port: number): Promise<{ close: () => Promise<void>; port: number }> {
  const { api, device } = apiFromDevice();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = String(req.headers.host ?? "");
    const origin = req.headers.origin;
    const loopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
    const originOk = origin === undefined || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(origin));
    if (!loopback || !originOk || req.headers["x-riley-secret"] !== device.localSecret) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "FORBIDDEN" }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/brief") {
      res.writeHead(404); res.end(); return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", () => {
      const parsed = RileyBriefSchema.safeParse(JSON.parse(body || "{}"));
      if (!parsed.success) { res.writeHead(400); res.end(JSON.stringify({ error: "BAD_REQUEST" })); return; }
      const b = parsed.data;
      api.ingest("riley", [{ externalId: b.id, title: b.title, detail: b.detail, occurredAt: b.occurredAt, matchText: b.title, scope: b.kind === "brief" ? "voice:brief" : "voice:triage" }])
        .then((r) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)); })
        .catch(() => { res.writeHead(502); res.end(JSON.stringify({ error: "INGEST_FAILED" })); });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  return { close: () => new Promise((r) => server.close(() => r())), port: actual };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      code: { type: "string" }, server: { type: "string" }, label: { type: "string" },
      provider: { type: "string" }, dir: { type: "string" }, file: { type: "string" },
      port: { type: "string" }, once: { type: "boolean" },
    },
  });
  const cmd = positionals[0];
  if (cmd === "pair") {
    const out = await pairDevice(values.code ?? "", values.server ?? "", values.label ?? "my-laptop");
    console.log(JSON.stringify({ paired: true, deviceId: out.deviceId, deviceFile: out.file, mode: modeOf(out.file).toString(8) }));
  } else if (cmd === "start") {
    if (values.once) { await heartbeatOnce(); return; }
    for (;;) { await heartbeatOnce(); await new Promise((r) => setTimeout(r, 30_000)); }
  } else if (cmd === "status") {
    const device = loadDevice(daemonRoot());
    console.log(JSON.stringify({ paired: !!device, deviceId: device?.deviceId, server: device?.server, deviceFileMode: existsSync(devicePath(daemonRoot())) ? modeOf(devicePath(daemonRoot())).toString(8) : null, rootMode: modeOf(daemonRoot()).toString(8) }));
    if (device) await heartbeatOnce();
  } else if (cmd === "signin" || cmd === "collect") {
    const p = RunnerProviderSchema.parse(values.provider);
    if (p !== "linkedin" && p !== "luma") throw new Error("signin/collect support linkedin|luma");
    if (cmd === "signin") await signin(p); else await collect(p);
  } else if (cmd === "push") {
    await pushFile(RunnerProviderSchema.parse(values.provider), values.file ?? "");
  } else if (cmd === "wispr-watch") {
    await watchWispr(values.dir ?? "", values.once ?? false);
  } else if (cmd === "riley-serve") {
    const s = await startRileyServer(Number(values.port ?? 8791));
    console.log(JSON.stringify({ riley: "listening", port: s.port, bind: "127.0.0.1" }));
  } else {
    console.error("usage: daemon <pair|start|status|signin|collect|push|wispr-watch|riley-serve>");
    process.exit(2);
  }
}

if (process.argv[1] && process.argv[1].endsWith("daemon.ts")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : "daemon failed"); process.exit(1); });
}
