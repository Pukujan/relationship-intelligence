/**
 * Telegram DM reader (#120). A user client on Telegram's own API, signed in
 * once by the owner, that sends recent one-to-one chats to the app's private
 * DM ingest. Read-only: it never sends, reads or marks anything as read.
 *
 *   tsx src/telegram.ts login   # once, interactive: phone, code, 2FA password
 *   tsx src/telegram.ts once    # one pass; the VPS stack runs it on a timer
 *
 * Needs TELEGRAM_API_ID and TELEGRAM_API_HASH (from my.telegram.org), and
 * RI_DM_TOKEN for the ingest. The session lives in TELEGRAM_SESSION_FILE
 * (mode 0600) and is never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  isPersonChat,
  type TgMessage,
  type TgUser,
  toThread,
} from "./telegramMap.js";

const SERVER = (
  process.env.RI_CRAWL_SERVER ?? "https://business.design-bakery.com"
).replace(/\/$/, "");
const TOKEN = process.env.RI_DM_TOKEN ?? "";
const API_ID = Number(process.env.TELEGRAM_API_ID ?? 0);
const API_HASH = process.env.TELEGRAM_API_HASH ?? "";
const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-crawl";
const SESSION_FILE =
  process.env.TELEGRAM_SESSION_FILE ?? path.join(ROOT, "telegram.session");
const STATE_FILE = path.join(ROOT, "telegram-state.json");
const SINCE_DAYS = Math.max(1, Number(process.env.RI_DM_SINCE_DAYS ?? 90));
const MAX_DIALOGS = Math.max(
  1,
  Math.min(500, Number(process.env.RI_TG_MAX_DIALOGS ?? 200)),
);
const MAX_MESSAGES = 200;

const readText = (file: string) => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
};
const writePrivate = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
};
type State = Record<string, number>;
const loadState = (): State => {
  try {
    return JSON.parse(readText(STATE_FILE) || "{}") as State;
  } catch {
    return {};
  }
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function client(): TelegramClient {
  if (!API_ID || !API_HASH) {
    console.error(
      "set TELEGRAM_API_ID and TELEGRAM_API_HASH (from my.telegram.org)",
    );
    process.exit(2);
  }
  return new TelegramClient(
    new StringSession(readText(SESSION_FILE)),
    API_ID,
    API_HASH,
    {
      connectionRetries: 3,
    },
  );
}

async function login(): Promise<void> {
  const tg = client();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await tg.start({
    phoneNumber: () => rl.question("Phone number (with country code): "),
    phoneCode: () => rl.question("Code Telegram sent you: "),
    password: () => rl.question("Two-step password (blank if none): "),
    onError: (error) => console.error("sign-in error:", error.message),
  });
  rl.close();
  writePrivate(SESSION_FILE, String(tg.session.save()));
  console.log(`signed in; session saved to ${SESSION_FILE}`);
  await tg.disconnect();
}

const mediaKind = (message: Api.Message): string | null => {
  const media = message.media;
  if (!media) return null;
  if (media instanceof Api.MessageMediaPhoto) return "photo";
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (doc instanceof Api.Document) {
      if (
        doc.attributes.some(
          (a) => a instanceof Api.DocumentAttributeAudio && a.voice,
        )
      )
        return "voice message";
      if (doc.attributes.some((a) => a instanceof Api.DocumentAttributeVideo))
        return "video";
      if (doc.attributes.some((a) => a instanceof Api.DocumentAttributeSticker))
        return "sticker";
    }
    return "file";
  }
  return "attachment";
};

async function once(): Promise<void> {
  if (!TOKEN) {
    console.log("RI_DM_TOKEN not set — skipping Telegram import");
    return;
  }
  if (!readText(SESSION_FILE)) {
    console.log(
      `no Telegram session at ${SESSION_FILE} — run "login" once first`,
    );
    return;
  }
  const tg = client();
  await tg.connect();
  const state = loadState();
  const since = Date.now() / 1000 - SINCE_DAYS * 86_400;
  try {
    const dialogs = await tg.getDialogs({ limit: MAX_DIALOGS });
    let sent = 0;
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (!(entity instanceof Api.User)) continue;
      const user: TgUser = {
        id: entity.id.toString(),
        firstName: entity.firstName ?? null,
        lastName: entity.lastName ?? null,
        username: entity.username ?? null,
        bot: entity.bot ?? false,
        self: entity.self ?? false,
      };
      if (!isPersonChat(user)) continue;
      const lastId = dialog.message?.id ?? 0;
      const lastDate = dialog.message?.date ?? 0;
      if (lastDate < since || state[user.id] === lastId) continue;

      const raw = await tg.getMessages(entity, {
        limit: MAX_MESSAGES,
        ...(state[user.id] ? { minId: state[user.id] } : {}),
      });
      const messages: TgMessage[] = raw
        .filter((m): m is Api.Message => m instanceof Api.Message)
        .map((m) => ({
          id: m.id,
          date: m.date,
          out: Boolean(m.out),
          text: m.message ?? "",
          media: mediaKind(m),
        }));
      const thread = toThread(user, messages);
      if (thread.messages.length > 0) {
        const res = await fetch(`${SERVER}/app-api/dm/ingest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: "telegram", threads: [thread] }),
          signal: AbortSignal.timeout(60_000),
        });
        console.log(
          `${thread.counterpart.name}: ${thread.messages.length} message(s) -> ${res.status} ${(await res.text()).slice(0, 160)}`,
        );
        if (!res.ok) continue;
        sent++;
      }
      state[user.id] = lastId;
      writePrivate(STATE_FILE, JSON.stringify(state));
      await pause(1_500);
    }
    console.log(`telegram: ${sent} chat(s) sent`);
  } catch (error) {
    // FLOOD_WAIT and other API errors end the pass; the next one retries.
    console.error(
      "telegram pass stopped:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await tg.disconnect();
  }
}

const mode = process.argv[2];
(mode === "login"
  ? login()
  : mode === "once"
    ? once()
    : Promise.reject(new Error('use "login" or "once"'))
)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "telegram failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
