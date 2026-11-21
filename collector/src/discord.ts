/**
 * Discord DM reader (#120). Reads the owner's one-to-one DMs through
 * Discord's web API with the owner's own account token, and sends them to the
 * app's private DM ingest. Read-only: it never sends, reacts or marks read.
 *
 *   DISCORD_USER_TOKEN=... RI_DM_TOKEN=... tsx src/discord.ts once
 *
 * One pass lists DM channels and fetches only messages newer than the last
 * pass (up to 100 per channel; the first pass takes the latest 100 from the
 * last 90 days). It waits out Discord's rate limits and stops the pass on a
 * 401 or 403. The token is read from the environment and never logged.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type DcChannel,
  type DcMessage,
  dmPartner,
  newerId,
  toThread,
} from "./discordMap.js";

const API = "https://discord.com/api/v10";
const SERVER = (
  process.env.RI_CRAWL_SERVER ?? "https://business.design-bakery.com"
).replace(/\/$/, "");
const TOKEN = process.env.RI_DM_TOKEN ?? "";
const USER_TOKEN = process.env.DISCORD_USER_TOKEN ?? "";
const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-crawl";
const STATE_FILE = path.join(ROOT, "discord-state.json");
const SINCE_DAYS = Math.max(1, Number(process.env.RI_DM_SINCE_DAYS ?? 90));
const MAX_CHANNELS = Math.max(
  1,
  Math.min(200, Number(process.env.RI_DC_MAX_CHANNELS ?? 100)),
);

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
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class StopPass extends Error {}

/** GET from Discord, waiting out 429s; a 401 or 403 ends the pass. */
async function discord<T>(pathname: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}${pathname}`, {
      headers: { Authorization: USER_TOKEN },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as {
        retry_after?: number;
      };
      const waitMs = Math.ceil((body.retry_after ?? 5) * 1000) + 500;
      console.log(
        `discord: rate limited, waiting ${Math.round(waitMs / 1000)}s`,
      );
      await pause(waitMs);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new StopPass(
        `discord answered ${res.status}; check DISCORD_USER_TOKEN`,
      );
    }
    if (!res.ok)
      throw new Error(`discord ${res.status} on ${pathname.split("?")[0]}`);
    return (await res.json()) as T;
  }
  throw new StopPass("discord kept rate limiting; stopping this pass");
}

async function once(): Promise<void> {
  if (!TOKEN || !USER_TOKEN) {
    console.log(
      "RI_DM_TOKEN or DISCORD_USER_TOKEN not set — skipping Discord import",
    );
    return;
  }
  const state = loadState();
  const sinceMs = Date.now() - SINCE_DAYS * 86_400_000;
  try {
    const me = await discord<{ id: string }>("/users/@me");
    const channels = (await discord<DcChannel[]>("/users/@me/channels"))
      .filter((c) => dmPartner(c) && newerId(c.last_message_id, state[c.id]))
      .sort((a, b) => (newerId(a.last_message_id, b.last_message_id) ? -1 : 1))
      .slice(0, MAX_CHANNELS);
    let sent = 0;
    for (const channel of channels) {
      const partner = dmPartner(channel);
      if (!partner) continue;
      const after = state[channel.id];
      const messages = await discord<DcMessage[]>(
        `/channels/${channel.id}/messages?limit=100${after ? `&after=${after}` : ""}`,
      );
      const thread = toThread(channel, partner, messages, me.id, sinceMs);
      if (thread.messages.length > 0) {
        const res = await fetch(`${SERVER}/app-api/dm/ingest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "discord", threads: [thread] }),
          signal: AbortSignal.timeout(60_000),
        });
        console.log(
          `${thread.counterpart.name}: ${thread.messages.length} message(s) -> ${res.status} ${(await res.text()).slice(0, 160)}`,
        );
        if (!res.ok) continue;
        sent++;
      }
      const newest = messages.reduce<string | null>(
        (top, m) => (newerId(m.id, top) ? m.id : top),
        after ?? null,
      );
      if (newest) {
        state[channel.id] = newest;
        saveState(state);
      }
      await pause(1_500);
    }
    console.log(`discord: ${sent} DM(s) sent`);
  } catch (error) {
    console.error(
      "discord pass stopped:",
      error instanceof Error ? error.message : error,
    );
  }
}

if (process.argv[2] !== "once") {
  console.error('use "once"');
  process.exit(2);
}
once().then(() => process.exit(0));
