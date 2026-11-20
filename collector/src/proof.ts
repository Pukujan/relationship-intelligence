/**
 * Slice 1 daemon proof (issue #15, docs/COLLECTION-EXECUTION.md).
 *
 * Three phases, each a separate process launch against the same persistent
 * browser profile, so "restart" means a real process restart:
 *
 *   signin  open LinkedIn and wait for the human to sign in manually
 *   fetch   one read-only visit to the signed-in user's own profile
 *   check   after a restart, report whether the session survived
 *
 * Boundaries: no stealth flags, no challenge bypass, no scrolling or
 * clicking beyond navigation, no credentials handled by this code. The
 * profile directory holds live cookies; it lives outside the repository,
 * is created with mode 0700, and is never committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "patchright";

const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-daemon-proof";
const PROFILE_DIR = path.join(ROOT, "profile");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const SIGNIN_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 3000;

interface Evidence {
  phase: string;
  at: string;
  finalUrl: string;
  title: string;
  loggedIn: boolean;
  detail?: string;
}

async function launch(): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    locale: "en-US",
  });
}

async function hasLinkedInSession(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies("https://www.linkedin.com");
  return cookies.some((c) => c.name === "li_at" && c.value.length > 0);
}

function record(e: Evidence): void {
  const stamp = e.at.replace(/[:.]/g, "-");
  const file = path.join(EVIDENCE_DIR, `${e.phase}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(e, null, 2), { mode: 0o600 });
  console.log(`RESULT ${JSON.stringify(e)}`);
  console.log(`evidence: ${file}`);
}

async function signin(): Promise<void> {
  const ctx = await launch();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (await hasLinkedInSession(ctx)) {
      record({
        phase: "signin",
        at: new Date().toISOString(),
        finalUrl: page.url(),
        title: await page.title(),
        loggedIn: true,
        detail: "session already present in profile; no manual sign-in needed",
      });
      return;
    }
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });
    console.log("Waiting for manual sign-in in the browser window...");
    const deadline = Date.now() + SIGNIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(POLL_MS);
      if (await hasLinkedInSession(ctx)) {
        record({
          phase: "signin",
          at: new Date().toISOString(),
          finalUrl: page.url(),
          title: await page.title(),
          loggedIn: true,
          detail: "li_at session cookie observed after manual sign-in",
        });
        return;
      }
    }
    record({
      phase: "signin",
      at: new Date().toISOString(),
      finalUrl: page.url(),
      title: await page.title(),
      loggedIn: false,
      detail: "timed out waiting for manual sign-in",
    });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

async function fetchOwnProfile(): Promise<void> {
  const ctx = await launch();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.linkedin.com/in/me/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    const loggedIn = await hasLinkedInSession(ctx);
    const finalUrl = page.url();
    const title = await page.title();
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
      title,
      loggedIn,
      detail,
    });
    if (!loggedIn || /login|authwall|checkpoint/.test(finalUrl)) {
      process.exitCode = 1;
    }
  } finally {
    await ctx.close();
  }
}

async function check(): Promise<void> {
  const ctx = await launch();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    const loggedIn = await hasLinkedInSession(ctx);
    const finalUrl = page.url();
    const navPresent = await page
      .locator("#global-nav, header.global-nav__header, nav[aria-label='Primary'], header")
      .first()
      .count();
    record({
      phase: "check",
      at: new Date().toISOString(),
      finalUrl,
      title: await page.title(),
      loggedIn: loggedIn && navPresent > 0 && !/login|checkpoint|authwall/.test(page.url()),
      detail: `li_at=${loggedIn}; nav/header present=${navPresent > 0}; url=${page.url()}; fresh process after restart`,
    });
    if (!loggedIn || /login|authwall|checkpoint/.test(finalUrl)) {
      process.exitCode = 1;
    }
  } finally {
    await ctx.close();
  }
}

const phase = process.argv[2];
const run =
  phase === "signin"
    ? signin
    : phase === "fetch"
      ? fetchOwnProfile
      : phase === "check"
        ? check
        : undefined;

if (!run) {
  console.error("usage: tsx src/proof.ts <signin|fetch|check>");
  process.exit(2);
}

run().catch((err: unknown) => {
  console.error("proof failed:", err);
  process.exit(1);
});
