/**
 * WhatsApp DM reader (#120). A linked device on the owner's WhatsApp, through
 * Baileys, that passes one-to-one chats to the app's private DM ingest.
 * Read-only: it never sends, never marks messages as read and doesn't show
 * the owner as online.
 *
 *   tsx src/whatsapp.ts login   # once: scan the QR code with your phone
 *   tsx src/whatsapp.ts run     # keeps listening; the VPS stack runs this
 *
 * On linking, WhatsApp sends recent history; after that, new messages arrive
 * live. Both are buffered and sent to the app every RI_WA_FLUSH_SECONDS
 * (default 300). Link data lives in RI_PROOF_ROOT/whatsapp-auth (mode 0700).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { toThreads, type WaMessage } from "./whatsappMap.js";

const SERVER = (
  process.env.RI_CRAWL_SERVER ?? "https://business.design-bakery.com"
).replace(/\/$/, "");
const TOKEN = process.env.RI_DM_TOKEN ?? "";
const ROOT = process.env.RI_PROOF_ROOT ?? "/tmp/ri-crawl";
const AUTH_DIR = path.join(ROOT, "whatsapp-auth");
const SINCE_DAYS = Math.max(1, Number(process.env.RI_DM_SINCE_DAYS ?? 90));
const FLUSH_MS =
  Math.max(30, Number(process.env.RI_WA_FLUSH_SECONDS ?? 300)) * 1000;
const MAX_MESSAGES = 200;
const BATCH = 10;

const logger = pino({ level: process.env.RI_WA_LOG_LEVEL ?? "silent" });
const names = new Map<string, string>();
let pending: WaMessage[] = [];

async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const since = Date.now() / 1000 - SINCE_DAYS * 86_400;
  const threads = toThreads(pending, names, since).map((t) => ({
    ...t,
    messages: t.messages.slice(-MAX_MESSAGES),
  }));
  const taken = pending;
  pending = [];
  for (let i = 0; i < threads.length; i += BATCH) {
    const batch = threads.slice(i, i + BATCH);
    try {
      const res = await fetch(`${SERVER}/app-api/dm/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "whatsapp", threads: batch }),
        signal: AbortSignal.timeout(60_000),
      });
      console.log(
        `whatsapp: ${batch.length} chat(s) -> ${res.status} ${(await res.text()).slice(0, 160)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Keep what didn't land for the next flush; the app dedupes resends.
      pending = [...taken, ...pending];
      return;
    }
  }
}

async function connect(mode: "login" | "run"): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts) {
      const name = c.name ?? c.notify ?? c.verifiedName;
      if (c.id && name) names.set(c.id, name);
    }
  });
  sock.ev.on("messaging-history.set", ({ contacts, messages }) => {
    for (const c of contacts) {
      const name = c.name ?? c.notify ?? c.verifiedName;
      if (c.id && name) names.set(c.id, name);
    }
    pending.push(...(messages as WaMessage[]));
    console.log(
      `whatsapp: history sync, ${messages.length} message(s) buffered`,
    );
  });
  sock.ev.on("messages.upsert", ({ messages }) => {
    pending.push(...(messages as WaMessage[]));
  });

  await new Promise<void>((resolve, reject) => {
    sock.ev.on("connection.update", (update) => {
      if (update.qr) {
        console.log(
          "Scan this with WhatsApp on your phone: Settings → Linked devices → Link a device",
        );
        qrcode.generate(update.qr, { small: true });
      }
      if (update.connection === "open") {
        console.log("whatsapp: linked and connected");
        if (mode === "login") {
          // Give WhatsApp a moment to finish saving the link, then stop.
          setTimeout(() => {
            sock.end(undefined);
            resolve();
          }, 5_000);
        }
      }
      if (update.connection === "close") {
        const code = (
          update.lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined
        )?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          reject(
            new Error(
              'this device was unlinked in WhatsApp; run "login" again',
            ),
          );
          return;
        }
        if (mode === "login" && code === DisconnectReason.restartRequired) {
          // Expected once right after scanning: reconnect to finish linking.
          connect("login").then(resolve, reject);
          return;
        }
        if (mode === "run") {
          console.log(
            `whatsapp: connection closed (${code ?? "unknown"}); reconnecting in 30s`,
          );
          setTimeout(() => connect("run").then(resolve, reject), 30_000);
          return;
        }
        reject(new Error(`connection closed (${code ?? "unknown"})`));
      }
    });
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "login") {
    await connect("login");
    console.log(`linked; the link is saved in ${AUTH_DIR}`);
    return;
  }
  if (mode !== "run") throw new Error('use "login" or "run"');
  if (!TOKEN) {
    console.log("RI_DM_TOKEN not set — WhatsApp import is off; idling");
    await new Promise(() => undefined);
  }
  setInterval(() => void flush(), FLUSH_MS);
  await connect("run");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("whatsapp:", error instanceof Error ? error.message : error);
    process.exit(
      error instanceof Error && /unlinked/.test(error.message) ? 3 : 1,
    );
  });
