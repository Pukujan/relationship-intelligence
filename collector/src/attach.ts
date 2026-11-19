/**
 * Slice 1 daemon proof, attach mode (issue #15).
 *
 * The first attempt failed: Playwright's bundled "Chrome for Testing" is
 * rejected by Google OAuth with "This browser or app may not be secure",
 * because an automation-launched browser advertises itself as automated.
 *
 * This variant inverts the launch. The human starts their own real Chrome
 * with a debugging port and a dedicated profile, then signs in normally.
 * This code never launches a browser and never sees a credential; it
 * connects to the already-running browser and drives one tab.
 *
 *   attach  connect over CDP and report what is signed in
 *   fetch   one read-only visit to the signed-in user's own profile
 *   check   fresh process: did the session survive the restart?
 *
 * Boundaries unchanged: no stealth flags, no challenge bypass, read-only
 * navigation, and no credential handling.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-daemon-proof";
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const CDP_URL = process.env.RI_CDP_URL ?? "http://127.0.0.1:9222";

interface Evidence {
  phase: string;
  at: string;
  finalUrl: string;
  title: string;
  loggedIn: boolean;
  detail?: string;
}

function record(e: Evidence): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const stamp = e.at.replace(/[:.]/g, "-");
  const file = path.join(EVIDENCE_DIR, `${e.phase}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(e, null, 2), { mode: 0o600 });
  console.log(`RESULT ${JSON.stringify(e)}`);
  console.log(`evidence: ${file}`);
}

async function connect(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context on the attached Chrome");
  return { browser, ctx };
}

async function hasLinkedInSession(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies("https://www.linkedin.com");
  return cookies.some((c) => c.name === "li_at" && c.value.length > 0);
}

/** Report whether the attached browser carries automation tells. */
async function automationProfile(ctx: BrowserContext): Promise<string> {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const tells = await page.evaluate(() => ({
    webdriver: (navigator as unknown as { webdriver?: boolean }).webdriver,
    brands: (navigator as unknown as { userAgentData?: { brands: { brand: string }[] } })
      .userAgentData?.brands?.map((b) => b.brand).join(", ") ?? "n/a",
    ua: navigator.userAgent,
  }));
  return `webdriver=${tells.webdriver}; brands=${tells.brands}; ua=${tells.ua.slice(0, 90)}`;
}

async function attach(): Promise<void> {
  const { browser, ctx } = await connect();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const loggedIn = await hasLinkedInSession(ctx);
    const tells = await automationProfile(ctx);
    record({
      phase: "attach",
      at: new Date().toISOString(),
      finalUrl: page.url(),
      title: await page.title(),
      loggedIn,
      detail: `attached over CDP to ${CDP_URL}; ${tells}`,
    });
    if (!loggedIn) process.exitCode = 1;
  } finally {
    // Detach without closing the human's browser.
    await browser.close();
  }
}

async function fetchOwnProfile(): Promise<void> {
  const { browser, ctx } = await connect();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.linkedin.com/in/me/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    const loggedIn = await hasLinkedInSession(ctx);
    const finalUrl = page.url();
    let detail = "read-only visit to own profile via /in/me/ redirect";
    const h1 = page.locator("h1").first();
    if (await h1.count()) {
      detail += `; h1: ${(await h1.innerText()).slice(0, 120)}`;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `fetch-${stamp}.png`),
    });
    record({
      phase: "fetch",
      at: new Date().toISOString(),
      finalUrl,
      title: await page.title(),
      loggedIn,
      detail,
    });
    if (!loggedIn || /login|authwall|checkpoint/.test(finalUrl)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

async function check(): Promise<void> {
  const { browser, ctx } = await connect();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    const liAt = await hasLinkedInSession(ctx);
    const finalUrl = page.url();
    const redirectedToLogin = /login|authwall|checkpoint/.test(finalUrl);
    const nav = await page
      .locator("#global-nav, header.global-nav__header")
      .first()
      .count();
    record({
      phase: "check",
      at: new Date().toISOString(),
      finalUrl,
      title: await page.title(),
      loggedIn: liAt && !redirectedToLogin,
      detail: `li_at=${liAt}; login-redirect=${redirectedToLogin}; global-nav present=${nav > 0} (informational); fresh process after restart`,
    });
    if (!liAt || redirectedToLogin) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

const phase = process.argv[2];
const run =
  phase === "attach"
    ? attach
    : phase === "fetch"
      ? fetchOwnProfile
      : phase === "check"
        ? check
        : undefined;

if (!run) {
  console.error("usage: tsx src/attach.ts <attach|fetch|check>");
  process.exit(2);
}

run().catch((err: unknown) => {
  console.error("proof failed:", err);
  process.exit(1);
});
