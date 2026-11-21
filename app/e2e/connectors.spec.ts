/** RI-0021 real user flows: OAuth via stub IdP, runner daemon, UI secret hygiene. */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { cleanup, cookieFor, EMAIL_A, env, lit, OCTO, PID_A, PID_B, seedFixtureB, sql, TEST_PROVIDERS } from "./harness.js";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const collectorDir = path.join(here, "../../collector");
const startIso = new Date().toISOString();

async function authedPage(browser: Browser, pid: string, email: string): Promise<Page> {
  const context = await browser.newContext();
  const cookie = await cookieFor(pid, email);
  await context.addCookies([{ name: "ri_session", value: cookie.slice("ri_session=".length), domain: "127.0.0.1", path: "/" }]);
  return context.newPage();
}

function daemon(args: string[], root: string) {
  return exec("pnpm", ["--dir", collectorDir, "exec", "tsx", "src/daemon.ts", ...args], {
    env: { ...process.env, RI_DAEMON_ROOT: root },
    timeout: 60_000,
  });
}

test.beforeAll(async () => {
  await seedFixtureB();
});
test.afterAll(async () => {
  await cleanup(startIso);
});

test("E2E-OAuth: connect, sync, disconnect for slack/calendly/discord/zoom", async ({ browser }) => {
  const page = await authedPage(browser, PID_A, EMAIL_A);
  const names: Record<string, string> = { slack: "Slack", calendly: "Calendly", discord: "Discord", zoom: "Zoom" };
  for (const provider of ["slack", "calendly", "discord", "zoom"]) {
    await page.goto("/console/integrations/connectors");
    const card = page.locator("article").filter({ hasText: names[provider] }).first();
    await card.getByRole("link", { name: `Connect ${names[provider]}` }).click();
    await page.waitForURL(/connected=/, { timeout: 30_000 });
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
    if (provider !== "slack") {
      await expect(card.getByText(`stub@${provider}.test`)).toBeVisible();
    }
    await card.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText(`${names[provider]} synced`)).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Disconnect" }).click();
    await expect(card.getByText("Needs setup")).toBeVisible();
  }
  await page.context().close();
});

test("E2E-OAuth: callback state is single-use (MR-K6)", async ({ request }) => {
  const cookie = await cookieFor(PID_A, EMAIL_A);
  const start = await request.get("/app-api/connectors/oauth/slack/start", { headers: { cookie }, maxRedirects: 0 });
  const authorizeUrl = start.headers().location ?? "";
  expect(authorizeUrl).toContain("/slack/authorize");
  const authorize = await request.get(authorizeUrl, { maxRedirects: 0 });
  const callbackUrl = authorize.headers().location ?? "";
  expect(callbackUrl).toContain("code=");
  const first = await request.get(callbackUrl, { maxRedirects: 0 });
  expect(first.headers().location ?? "").toContain("connected=slack");
  const replay = await request.get(callbackUrl, { maxRedirects: 0 });
  expect(replay.headers().location ?? "").toContain("connector_error=STATE_MISMATCH");
});

test("E2E-OAuth: provider 401 surfaces expired, distinct from offline", async ({ browser, request }) => {
  await request.post("http://127.0.0.1:8791/__mode", { data: { mode: "force401" } });
  const page = await authedPage(browser, PID_A, EMAIL_A);
  await page.goto("/console/integrations/connectors");
  const card = page.locator("article").filter({ hasText: "Zoom" }).first();
  await card.getByRole("link", { name: "Connect Zoom" }).click();
  await page.waitForURL(/connected=/);
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(card.getByText("Re-auth needed")).toBeVisible({ timeout: 30_000 });
  await request.post("http://127.0.0.1:8791/__mode", { data: { mode: "normal" } });
  await page.context().close();
});

test("E2E-Runner: pair, consent, push, offline, revoke", async ({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ri-e2e-daemon-"));
  const page = await authedPage(browser, PID_A, EMAIL_A);
  await page.goto("/console/integrations/connectors");
  const card = page.locator("article").filter({ hasText: "LinkedIn" }).first();
  await card.getByRole("button", { name: "Set up" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Generate pairing code" }).click();
  const code = (await dialog.locator("p.font-mono").first().textContent())?.trim() ?? "";
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  await daemon(["pair", "--code", code, "--server", "http://127.0.0.1:8790", "--label", "e2e-laptop"], root);
  await daemon(["start", "--once"], root);
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await expect(dialog.getByText("e2e-laptop")).toBeVisible();
  await dialog.getByRole("checkbox").first().click();
  await expect(dialog.getByRole("checkbox").first()).toBeChecked();
  await dialog.getByRole("button", { name: "Close" }).click();
  const itemsFile = path.join(root, "items.json");
  writeFileSync(itemsFile, JSON.stringify([{ externalId: "e2e-1", title: "LinkedIn: E2E", detail: "d", occurredAt: new Date().toISOString(), matchText: "m", scope: "profile:read" }]));
  const push = await daemon(["push", "--provider", "linkedin", "--file", itemsFile], root);
  expect(push.stdout).toContain("e2e-1");
  await daemon(["start", "--once"], root);
  await page.reload();
  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(card.getByText("Device offline")).toBeVisible();
  const device = JSON.parse(readFileSync(path.join(root, "device.json"), "utf8")) as { deviceToken: string };
  const revokedConsent = await page.request.post("/app-api/connectors/runner/consent", { data: { provider: "linkedin", scopes: ["profile:read"], granted: false } });
  expect(revokedConsent.ok()).toBeTruthy();
  const ingestAfterRevoke = await page.request.post("/app-api/connectors/runner/ingest", {
    headers: { Authorization: `Bearer ${device.deviceToken}` },
    data: { provider: "linkedin", items: [{ externalId: "e2e-2", title: "x", detail: "", occurredAt: new Date().toISOString(), matchText: "", scope: "profile:read" }] },
  });
  expect(ingestAfterRevoke.status()).toBe(403);
  await card.getByRole("button", { name: "Set up" }).click();
  await dialog.getByRole("button", { name: "Revoke" }).first().click();
  await page.waitForTimeout(300);
  const hb = await daemon(["start", "--once"], root).catch((e) => e as { stdout?: string; stderr?: string; code?: number });
  expect(String((hb as { stderr?: string }).stderr ?? (hb as { stdout?: string }).stdout ?? "")).toContain("revoked");
  await page.context().close();
});

test("E2E-UI: unconfigured label and secret hygiene (R8)", async ({ browser }) => {
  const page = await authedPage(browser, PID_A, EMAIL_A);
  const seen: { url: string; body: string }[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/app-api/")) {
      seen.push({ url: r.url(), body: await r.text().catch(() => "") });
    }
  });
  await page.goto("/console/integrations/connectors");
  const view = await page.request.get("/app-api/connectors");
  const { connectors } = (await view.json()) as { connectors: { provider: string; oauthConfigured: boolean; connectUrl: string | null }[] };
  const slack = connectors.find((c) => c.provider === "slack");
  expect(slack?.oauthConfigured).toBe(true);
  expect(slack?.connectUrl).toContain("/oauth/slack/start");
  const wispr = page.locator("article").filter({ hasText: "Wispr Flow" }).first();
  await wispr.getByRole("button", { name: "Set up" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Generate pairing code" }).click();
  const code = (await dialog.locator("p.font-mono").first().textContent())?.trim() ?? "";
  await page.waitForTimeout(500);
  for (const s of seen) {
    expect(s.body).not.toContain("deviceToken");
    expect(s.body).not.toContain("token_hash");
    expect(s.body).not.toContain("code_hash");
    if (!s.url.endsWith("/runner/pair")) expect(s.body).not.toContain(code);
  }
  const pairResponses = seen.filter((s) => s.url.endsWith("/runner/pair"));
  expect(pairResponses.length).toBe(1);
  expect(pairResponses[0]?.body).toContain(code);
  await page.context().close();
});

test("E2E-isolation: B cannot touch A devices or routes (I2)", async ({ browser }) => {
  const pageA = await authedPage(browser, PID_A, EMAIL_A);
  const pageB = await authedPage(browser, PID_B, PID_B + "@test");
  const pair = await pageA.request.post("/app-api/connectors/runner/pair");
  const { code } = (await pair.json()) as { code: string };
  const claim = await pageA.request.post("/app-api/connectors/runner/claim", { data: { code, deviceLabel: "a-device" } });
  expect(claim.ok()).toBeTruthy();
  const { deviceId, deviceToken } = (await claim.json()) as { deviceId: string; deviceToken: string };
  const revokeByB = await pageB.request.post("/app-api/connectors/runner/revoke", { data: { deviceId } });
  expect(revokeByB.status()).toBe(404);
  const consentByB = await pageB.request.post("/app-api/connectors/runner/consent", { data: { provider: "linkedin", scopes: ["profile:read"], granted: true } });
  expect(consentByB.ok()).toBeTruthy();
  const ingestA = await pageA.request.post("/app-api/connectors/runner/ingest", {
    headers: { Authorization: `Bearer ${deviceToken}` },
    data: { provider: "linkedin", items: [{ externalId: "a-1", title: "a", detail: "", occurredAt: new Date().toISOString(), matchText: "", scope: "profile:read" }] },
  });
  expect(ingestA.status()).toBe(403);
  const pairB = await pageB.request.post("/app-api/connectors/runner/pair");
  const codeB = ((await pairB.json()) as { code: string }).code;
  const claimB = await pageB.request.post("/app-api/connectors/runner/claim", { data: { code: codeB, deviceLabel: "b-device" } });
  const tokB = ((await claimB.json()) as { deviceToken: string }).deviceToken;
  const ingestB = await pageB.request.post("/app-api/connectors/runner/ingest", {
    headers: { Authorization: `Bearer ${tokB}` },
    data: { provider: "linkedin", items: [{ externalId: "b-1", title: "b", detail: "", occurredAt: new Date().toISOString(), matchText: "", scope: "profile:read" }] },
  });
  expect(ingestB.status()).toBe(200);
  const rowsA = await sql(`SELECT id FROM ri_console.activity WHERE id = ${lit("sync-" + PID_A + "-linkedin-a-1")}`);
  expect(rowsA.length).toBe(0);
  const rowsB = await sql(`SELECT principal_id FROM ri_console.activity WHERE id LIKE ${lit("sync-" + PID_B + "-%")}`);
  expect(rowsB.every((r) => r.principal_id === PID_B)).toBe(true);
  await pageA.context().close();
  await pageB.context().close();
});
