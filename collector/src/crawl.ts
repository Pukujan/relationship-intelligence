/**
 * Slow LinkedIn crawler — local runner (RI-0023, owner decision #108).
 *
 * Attach to the owner's own already-running browser over CDP; never launch a
 * browser, never handle a credential, never use stealth flags, and never route
 * around a challenge. Human-paced visits with a jittered 45-90s delay, a daily
 * cap from the server queue, and immediate stop on a 429 / login wall / block.
 *
 *   RI_CRAWL_TOKEN=... tsx src/crawl.ts once
 *   RI_CRAWL_TOKEN=... tsx src/crawl.ts loop
 *
 * The browser must be started by the human with a debugging port and a
 * dedicated profile, e.g.:
 *   open -na "Brave Browser" --args --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/.ri-linkedin-profile"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

const SERVER = (process.env.RI_CRAWL_SERVER ?? "https://business.design-bakery.com").replace(/\/$/, "");
const TOKEN = process.env.RI_CRAWL_TOKEN ?? "";
const CDP_URL = process.env.RI_CDP_URL ?? "http://127.0.0.1:9222";
const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-crawl";
const EVIDENCE_DIR = path.join(ROOT, "evidence");

interface QueueItem {
  personId: string;
  name: string;
  url: string;
  lastVisitedAt: string | null;
}
interface Queue {
  items: QueueItem[];
  pacing: { minDelayMs: number; maxDelayMs: number; dailyCap: number; cooldownMs: number };
  cooldownUntil: string | null;
}

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
});

function evidence(phase: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(
    EVIDENCE_DIR,
    `${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  console.log(`evidence: ${file}`);
}

async function queue(): Promise<Queue> {
  const res = await fetch(`${SERVER}/app-api/crawler/queue?limit=20`, {
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`queue ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Queue;
}

async function connect(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context on the attached Chrome");
  return { browser, ctx };
}

/** Read one profile; returns extracted facts or a blocked/error status. */
async function visit(
  ctx: BrowserContext,
  item: QueueItem,
): Promise<{
  status: "ok" | "blocked" | "error";
  facts: { attribute: string; statement: string; quote?: string }[];
  finalUrl: string;
}> {
  const page = await ctx.newPage();
  try {
    await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // Human-speed read: dwell like a person, then move. No retries, no
    // challenge bypass, no scroll storms.
    await page.waitForTimeout(2_000 + Math.floor(Math.random() * 3_000));
    const finalUrl = page.url();
    if (/login|authwall|checkpoint|challenge|add-me|人间验证/.test(finalUrl)) {
      return { status: "blocked", facts: [], finalUrl };
    }
    const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (!h1 || h1.toLowerCase().includes("page not found")) {
      return { status: "blocked", facts: [], finalUrl };
    }
    const text = (await page.locator("main").first().innerText().catch(() => "")).slice(0, 20_000);
    // Extract only explicitly labelled public fields. Never infer sensitive
    // attributes and never invent a fact the page did not show.
    const facts: { attribute: string; statement: string; quote?: string }[] = [];
    const patterns: [string, RegExp][] = [
      ["public_headline", /^([^\n]{5,160})$/],
      ["public_education", /(?:Education|edu)[:\s]+([^\n]{3,160})/i],
      ["location", /(?:Location|location)[:\s]+([^\n]{3,120})/i],
    ];
    for (const [attribute, re] of patterns) {
      const match = text.match(re);
      if (match?.[1]) {
        const value = match[1].trim().replace(/\s+/g, " ");
        facts.push({
          attribute,
          statement: `${item.name}, ${attribute}: ${value}`,
          quote: value.slice(0, 400),
        });
      }
    }
    if (facts.length === 0) {
      // Still record the visit so the queue marks it seen: no facts is a
      // legitimate result for a thin or restricted profile.
      facts.push({
        attribute: "public_headline",
        statement: `${item.name}, viewed public profile: ${h1.slice(0, 160)}`,
        quote: h1.slice(0, 400),
      });
    }
    return { status: "ok", facts, finalUrl };
  } catch (error) {
    return { status: "error", facts: [], finalUrl: item.url, ...({ detail: String(error) } as object) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (q: Queue) =>
  q.pacing.minDelayMs +
  Math.floor(Math.random() * Math.max(1, q.pacing.maxDelayMs - q.pacing.minDelayMs));

async function run(loop: boolean): Promise<void> {
  if (!TOKEN) {
    console.error("set RI_CRAWL_TOKEN (the shared bearer from the app env)");
    process.exit(2);
  }
  const q = await queue();
  if (q.cooldownUntil) {
    console.log(`cooldown until ${q.cooldownUntil} — nothing to crawl`);
    return;
  }
  console.log(`queue: ${q.items.length} profile(s), ${q.pacing.minDelayMs/1000}-${q.pacing.maxDelayMs/1000}s apart`);
  if (q.items.length === 0) return;

  const { browser, ctx } = await connect();
  try {
    for (const item of q.items) {
      const result = await visit(ctx, item);
      const body = {
        personId: item.personId,
        url: item.url,
        status: result.status,
        visitedAt: new Date().toISOString(),
        facts: result.facts,
      };
      evidence(`visit-${item.personId}`, { item, result });
      const res = await fetch(`${SERVER}/app-api/crawler/ingest`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const responseBody = (await res.text()).slice(0, 300);
      console.log(`${item.name}: ${result.status} -> ${res.status} ${responseBody}`);
      if (result.status === "blocked" || res.status === 429) {
        console.log("blocked or rate-limited — stopping this run; the server will cool down the queue");
        break;
      }
      if (!loop) break;
      await pause(jitter(q));
    }
  } finally {
    // Detach without closing the human's browser.
    await browser.close();
  }
}

const loop = process.argv[2] === "loop";
run(loop).catch((error) => {
  console.error("crawl failed:", error);
  process.exit(1);
});
