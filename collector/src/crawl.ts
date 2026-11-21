/**
 * Slow LinkedIn crawler — local runner (RI-0023/0024).
 *
 * Attach to the owner's own already-running browser over CDP; never launch a
 * browser, never handle a credential, never use stealth flags, and never route
 * around a challenge. Human-paced visits with a jittered 45-90s delay, a daily
 * cap from the server queue, and immediate stop on a 429 / login wall / block.
 *
 * Collects: public profile facts, contact info overlay, profile image,
 * connections (paginated), posts + topic classification (scrollable),
 * companies, follow list (paginated), and home feed.
 *
 *   RI_CRAWL_TOKEN=... tsx src/crawl.ts once
 *   RI_CRAWL_TOKEN=... tsx src/crawl.ts loop
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

type Topic = "product" | "hiring" | "fundraising" | "research" | "event" | "opinion" | "personal" | "other";

interface VisitResult {
  status: "ok" | "blocked" | "error";
  facts: { attribute: string; statement: string; quote?: string }[];
  contact: { email?: string; phone?: string; website?: string; twitter?: string; github?: string };
  imageUrl: string | null;
  connections: { name: string; url?: string | undefined; headline?: string | undefined }[];
  connectionsComplete: boolean;
  posts: { text: string; date?: string; url?: string; topic: Topic }[];
  companies: { name: string; url?: string; description?: string }[];
  follows: { name: string; url?: string | undefined }[];
  feed: { author: string; text: string; url?: string; topic: Topic }[];
  finalUrl: string;
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (q: Queue) =>
  q.pacing.minDelayMs +
  Math.floor(Math.random() * Math.max(1, q.pacing.maxDelayMs - q.pacing.minDelayMs));

function classify(text: string): Topic {
  const t = text.toLowerCase();
  if (/hiring|we're hiring|join our team|open role|apply/.test(t)) return "hiring";
  if (/fundrais|raised|series [a-e]|seed round|investors?/.test(t)) return "fundraising";
  if (/research|paper|benchmark|study|dataset/.test(t)) return "research";
  if (/conference|event|meetup|talk at|register/.test(t)) return "event";
  if (/launch|shipping|product|feature|release/.test(t)) return "product";
  if (/grateful|personal|family|weekend|vacation/.test(t)) return "personal";
  if (/opinion|believe|think that|hot take/.test(t)) return "opinion";
  return "other";
}

const isBlocked = (url: string) =>
  /login|authwall|checkpoint|challenge|add-me|human verification|unusual activity/i.test(url);

/** Human-paced scroll: wait between scrolls, capped, no retries. */
async function gentleScroll(page: Page, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 700 + Math.floor(Math.random() * 400));
    await page.waitForTimeout(1_200 + Math.floor(Math.random() * 1_300));
    if (isBlocked(page.url())) return;
  }
}

/** Paginate a people list by clicking "See more" / scrolling, capped. */
async function collectPeople(
  page: Page,
  selector: string,
  max: number,
): Promise<{ name: string; url?: string | undefined; headline?: string | undefined }[]> {
  const out: { name: string; url?: string | undefined; headline?: string | undefined }[] = [];
  const seen = new Set<string>();
  for (let pass = 0; pass < 8 && out.length < max; pass++) {
    const rows = page.locator(selector);
    const n = Math.min(await rows.count(), 30);
    for (let i = 0; i < n && out.length < max; i++) {
      const row = rows.nth(i);
      const link = row.locator("a[href*='/in/']").first();
      const href = await link.getAttribute("href").catch(() => null);
      const name = (await row.innerText().catch(() => "")).split("\n")[0]?.trim() ?? "";
      if (!name || !href) continue;
      const url = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      const key = url.split("?")[0] ?? url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, url, headline: (await row.innerText().catch(() => "")).split("\n").slice(1, 2).join(" ").slice(0, 200) || undefined });
    }
    // "Show more" button inside the section, then a gentle scroll.
    const more = page.getByRole("button", { name: /show more|see more|next/i });
    if (await more.count()) {
      await more.first().click().catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
    await gentleScroll(page, 2);
    if (isBlocked(page.url())) break;
  }
  return out;
}

/** Read one profile and all its visible sections; returns typed observations. */
async function visit(ctx: BrowserContext, item: QueueItem): Promise<VisitResult> {
  const empty: VisitResult = {
    status: "error",
    facts: [],
    contact: {},
    imageUrl: null,
    connections: [],
    connectionsComplete: false,
    posts: [],
    companies: [],
    follows: [],
    feed: [],
    finalUrl: item.url,
  };
  const page = await ctx.newPage();
  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2_000 + Math.floor(Math.random() * 3_000));
    if (isBlocked(page.url())) return { ...empty, status: "blocked", finalUrl: page.url() };
    const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (!h1 || /page not found/i.test(h1)) return { ...empty, status: "blocked", finalUrl: page.url() };

    const result: VisitResult = { ...empty, status: "ok", finalUrl: page.url() };
    const text = (await page.locator("main").first().innerText().catch(() => "")).slice(0, 30_000);
    const patterns: [string, RegExp][] = [
      ["public_headline", /^([^\n]{5,160})$/],
      ["public_education", /(?:Education|edu)[:\s]+([^\n]{3,160})/i],
      ["location", /(?:Location|location)[:\s]+([^\n]{3,120})/i],
    ];
    for (const [attribute, re] of patterns) {
      const match = text.match(re);
      if (match?.[1]) {
        const value = match[1].trim().replace(/\s+/g, " ");
        result.facts.push({ attribute, statement: `${item.name}, ${attribute}: ${value}`, quote: value.slice(0, 400) });
      }
    }
    if (result.facts.length === 0) {
      result.facts.push({
        attribute: "public_headline",
        statement: `${item.name}, viewed public profile: ${h1.slice(0, 160)}`,
        quote: h1.slice(0, 400),
      });
    }

    // Profile image: the h1's card photo, <img> in the top card.
    const img = page.locator("main img").first();
    const src = await img.getAttribute("src").catch(() => null);
    if (src?.startsWith("http")) result.imageUrl = src.slice(0, 600);

    // Contact info overlay — only what LinkedIn shows to this account.
    const contactLink = page.locator("a[href*='overlay/contact-info'], a:has-text('Contact info')").first();
    if (await contactLink.count()) {
      await contactLink.click().catch(() => undefined);
      await page.waitForTimeout(1_200);
      const dialog = page.locator("[role='dialog']").first();
      const ctext = (await dialog.innerText().catch(() => "")).slice(0, 5_000);
      const grab = (re: RegExp) => ctext.match(re)?.[1]?.trim() ?? "";
      const email = grab(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      const phone = grab(/(?:Phone|phone)[:\s]*([+0-9()\-. ]{6,30})/);
      const website = grab(/(?:Website|website)[:\s]*(https?:\/\/[^\s]+)/i);
      const twitter = grab(/(?:Twitter|twitter)[:\s]*([@A-Za-z0-9_]{2,30})/i);
      const github = grab(/(?:GitHub|github)[:\s]*(https?:\/\/github\.com\/[^\s]+)/i);
      if (email) result.contact.email = email;
      if (phone) result.contact.phone = phone;
      if (website) result.contact.website = website;
      if (twitter) result.contact.twitter = twitter;
      if (github) result.contact.github = github;
      await page.keyboard.press("Escape").catch(() => undefined);
    }

    // Connections — visible list, paginated. If privacy hides it, we get [].
    await gentleScroll(page, 2);
    result.connections = await collectPeople(page, "section:has-text('Connections') li, div:has-text('Connections') li", 300);
    result.connectionsComplete = result.connections.length < 300;

    // Posts from the Activity tab — scrollable, classified.
    const postsTab = page.locator("a[href*='/recent-activity/'], a:has-text('Posts')").first();
    if (await postsTab.count()) {
      await postsTab.click().catch(() => undefined);
      await page.waitForTimeout(1_500);
      if (!isBlocked(page.url())) {
        await gentleScroll(page, 6);
        const items = page.locator("main div:has-text('posted'), main article, main .feed-shared-update-v2");
        const n = Math.min(await items.count(), 40);
        for (let i = 0; i < n; i++) {
          const t = (await items.nth(i).innerText().catch(() => "")).slice(0, 3_000);
          if (t.length < 40) continue;
          result.posts.push({ text: t, topic: classify(t) });
        }
      }
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(1_000);
    }

    // Companies from the Experience section / company links.
    const companyLinks = page.locator("main a[href*='/company/']");
    const cn = Math.min(await companyLinks.count(), 30);
    const seenCo = new Set<string>();
    for (let i = 0; i < cn; i++) {
      const href = await companyLinks.nth(i).getAttribute("href").catch(() => null);
      const name = (await companyLinks.nth(i).innerText().catch(() => "")).trim();
      if (!href || !name || seenCo.has(href)) continue;
      seenCo.add(href);
      result.companies.push({ name, url: `https://www.linkedin.com${href.split("?")[0]}` });
    }

    // Follow list — paginated if visible.
    await gentleScroll(page, 2);
    result.follows = (await collectPeople(page, "section:has-text('Following') li, div:has-text('Following') li", 200)).map((p) => ({ name: p.name, url: p.url }));

    // Home feed — collected in the same session, attributed separately.
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2_000);
    if (!isBlocked(page.url())) {
      await gentleScroll(page, 5);
      const posts = page.locator("main .feed-shared-update-v2, main article");
      const fn = Math.min(await posts.count(), 30);
      for (let i = 0; i < fn; i++) {
        const t = (await posts.nth(i).innerText().catch(() => "")).slice(0, 3_000);
        if (t.length < 40) continue;
        const author = t.split("\n")[0]?.slice(0, 160) ?? "unknown";
        result.feed.push({ author, text: t, topic: classify(t) });
      }
    }
    return result;
  } catch (error) {
    return { ...empty, finalUrl: page.url(), ...({ detail: String(error) } as object) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

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
        contact: result.contact,
        imageUrl: result.imageUrl,
        connections: result.connections,
        connectionsComplete: result.connectionsComplete,
        posts: result.posts,
        companies: result.companies,
        follows: result.follows,
        feed: result.feed,
      };
      evidence(`visit-${item.personId}`, { item, result });
      const res = await fetch(`${SERVER}/app-api/crawler/ingest`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const responseBody = (await res.text()).slice(0, 300);
      console.log(
        `${item.name}: ${result.status} -> ${res.status} | ${result.connections.length} connections, ${result.posts.length} posts, ${result.companies.length} companies, ${result.follows.length} follows, ${result.feed.length} feed, image=${Boolean(result.imageUrl)} | ${responseBody}`,
      );
      if (result.status === "blocked" || res.status === 429) {
        console.log("blocked or rate-limited — stopping; the server will cool down the queue");
        break;
      }
      if (!loop) break;
      await pause(jitter(q));
    }
  } finally {
    await browser.close();
  }
}

const loop = process.argv[2] === "loop";
run(loop).catch((error) => {
  console.error("crawl failed:", error);
  process.exit(1);
});
