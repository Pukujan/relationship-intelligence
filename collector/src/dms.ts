/// <reference lib="dom" />
/**
 * LinkedIn DM reader (#120). Attaches over CDP to the same signed-in browser
 * the slow crawler uses, opens LinkedIn messaging, and sends recently changed
 * threads to the app's private DM ingest. Read-only: it never types or sends.
 *
 * Human-paced: at most RI_DM_MAX_THREADS threads a pass (default 15), 20–40 s
 * apart, and a pass stops at the first login wall or block. A thread is
 * re-read only when its entry in the conversation list changes.
 *
 *   RI_DM_TOKEN=... tsx src/dms.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { buildThread, type RawEvent, threadIdOf } from "./dmParse.js";

const SERVER = (
  process.env.RI_CRAWL_SERVER ?? "https://business.design-bakery.com"
).replace(/\/$/, "");
const TOKEN = process.env.RI_DM_TOKEN ?? "";
const CDP_URL = process.env.RI_CDP_URL ?? "http://127.0.0.1:9222";
const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-crawl";
const STATE_FILE = path.join(ROOT, "dm-state.json");
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const MAX_THREADS = Math.max(
  1,
  Math.min(50, Number(process.env.RI_DM_MAX_THREADS ?? 15)),
);
const MAX_MESSAGES = 200;

const isBlocked = (url: string) =>
  /login|authwall|checkpoint|challenge|add-me|human verification|unusual activity/i.test(
    url,
  );

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => 20_000 + Math.floor(Math.random() * 20_000);

type State = Record<string, string>;
const loadState = (): State => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
};
const saveState = (state: State) => {
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
};

/** Keep the page's HTML when parsing finds nothing, so selectors can be fixed. */
async function keepEvidence(page: Page, phase: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(
    EVIDENCE_DIR,
    `dm-${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`,
  );
  writeFileSync(file, (await page.content()).slice(0, 400_000), {
    mode: 0o600,
  });
  console.log(`kept page for ${phase}: ${file}`);
}

interface ListItem {
  href: string;
  name: string;
  signature: string;
}

async function conversationList(page: Page): Promise<ListItem[]> {
  return page.$$eval(
    "li.msg-conversation-listitem, li.msg-conversations-container__convo-item",
    (els) =>
      els.map((el) => {
        const link = el.querySelector('a[href*="/messaging/thread/"]');
        const name = el.querySelector(
          ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names",
        );
        return {
          href: link?.getAttribute("href") ?? "",
          name: (name?.textContent ?? "").replace(/\s+/g, " ").trim(),
          signature: (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),
        };
      }),
  );
}

async function readThread(
  page: Page,
): Promise<{ profileUrl: string | null; name: string; events: RawEvent[] }> {
  return page.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const header = document.querySelector(
      ".msg-thread__link-to-profile, .msg-entity-lockup, .msg-overlay-bubble-header, .msg-title-bar",
    );
    const profile =
      header?.querySelector('a[href*="/in/"]')?.getAttribute("href") ??
      (
        header?.closest("a[href*='/in/']") as HTMLAnchorElement | null
      )?.getAttribute("href") ??
      document
        .querySelector('.msg-s-message-list a[href*="/in/"]')
        ?.getAttribute("href") ??
      null;
    const name =
      text(
        header?.querySelector(
          "h2, .msg-entity-lockup__entity-title, .profile-card-one-to-one__profile-link",
        ),
      ) || text(header);
    const events: RawEvent[] = [];
    for (const el of Array.from(
      document.querySelectorAll(".msg-s-message-list__event"),
    )) {
      const heading = text(
        el.querySelector("time.msg-s-message-list__time-heading"),
      );
      if (heading) events.push({ kind: "heading", text: heading });
      const sender = text(el.querySelector(".msg-s-message-group__name"));
      const time = text(
        el.querySelector("time.msg-s-message-group__timestamp"),
      );
      const bodies = Array.from(
        el.querySelectorAll(".msg-s-event-listitem__body"),
      );
      bodies.forEach((body, i) => {
        events.push({
          kind: "message",
          sender: i === 0 ? sender : "",
          time: i === 0 ? time : "",
          text: text(body),
        });
      });
    }
    return { profileUrl: profile, name, events };
  });
}

async function run(): Promise<void> {
  if (!TOKEN) {
    console.log("RI_DM_TOKEN not set — skipping DM import");
    return;
  }
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context on the attached Chrome");
  const page = await ctx.newPage();
  const state = loadState();
  try {
    await page.goto("https://www.linkedin.com/messaging/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await pause(5_000);
    if (isBlocked(page.url())) {
      console.log(`blocked at ${page.url()} — stopping this pass`);
      return;
    }
    const items = await conversationList(page);
    if (items.length === 0) {
      await keepEvidence(page, "list");
      console.log("no conversations found on the messaging page");
      return;
    }
    const changed = items
      .filter((item) => {
        const id = threadIdOf(item.href);
        return id && state[id] !== item.signature;
      })
      .slice(0, MAX_THREADS);
    console.log(
      `messaging: ${items.length} conversation(s), ${changed.length} changed since last pass`,
    );

    for (const [index, item] of changed.entries()) {
      const id = threadIdOf(item.href);
      if (!id) continue;
      await page.goto(
        new URL(item.href, "https://www.linkedin.com").toString(),
        {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        },
      );
      await pause(4_000);
      if (isBlocked(page.url())) {
        console.log(`blocked at ${page.url()} — stopping this pass`);
        break;
      }
      const raw = await readThread(page);
      const thread = buildThread(
        {
          threadUrl: item.href,
          counterpartName: item.name || raw.name,
          counterpartProfileUrl: raw.profileUrl,
          events: raw.events,
        },
        new Date(),
      );
      if (!thread || thread.messages.length === 0) {
        await keepEvidence(page, `thread-${id.slice(0, 12)}`);
      } else {
        thread.messages = thread.messages.slice(-MAX_MESSAGES);
        const res = await fetch(`${SERVER}/app-api/dm/ingest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "linkedin", threads: [thread] }),
          signal: AbortSignal.timeout(60_000),
        });
        const summary = (await res.text()).slice(0, 200);
        console.log(
          `${thread.counterpart.name}: ${thread.messages.length} message(s) -> ${res.status} ${summary}`,
        );
        if (res.ok) {
          state[id] = item.signature;
          saveState(state);
        }
        if (res.status === 429) break;
      }
      if (index < changed.length - 1) await pause(jitter());
    }
  } finally {
    await page.close().catch(() => undefined);
    await browser.close();
  }
}

run().catch((error) => {
  console.error("dm import failed:", error);
  process.exit(1);
});
