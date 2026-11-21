/**
 * Pure mapping from WhatsApp messages (as Baileys delivers them) to the app's
 * DM thread shape (#120). No socket here, so it is tested without a phone.
 */

/** The slice of a Baileys WAMessage this mapping reads. */
export interface WaMessage {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
  };
  /** Unix seconds; Baileys may hand over a Long-like object. */
  messageTimestamp?: number | { toNumber(): number } | null;
  pushName?: string | null;
  message?: WaContent | null;
}

interface WaContent {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: { caption?: string | null } | null;
  videoMessage?: { caption?: string | null } | null;
  audioMessage?: { ptt?: boolean | null } | null;
  documentMessage?: { fileName?: string | null } | null;
  stickerMessage?: unknown;
  contactMessage?: { displayName?: string | null } | null;
  locationMessage?: unknown;
  ephemeralMessage?: { message?: WaContent | null } | null;
  viewOnceMessage?: { message?: WaContent | null } | null;
}

export interface DmThread {
  threadId: string;
  counterpart: { name: string; handle: string };
  messages: { direction: "in" | "out"; sentAt: string; text: string }[];
}

/** One-to-one chats only: phone-number users and privacy ids, no groups. */
export const isPersonJid = (jid: string | null | undefined): jid is string =>
  typeof jid === "string" &&
  /^[0-9]+(:[0-9]+)?@(s\.whatsapp\.net|lid)$/.test(jid);

/**
 * The stable handle for a chat: "wa:+15551234567" for a phone-number user,
 * "wa:lid:123" when WhatsApp only shares a privacy id. Device suffixes drop.
 */
export const waHandle = (jid: string): string => {
  const [user = "", server = ""] = jid.split("@");
  const id = user.split(":")[0] ?? "";
  return server === "lid" ? `wa:lid:${id}` : `wa:+${id}`;
};

const unwrap = (content: WaContent | null | undefined): WaContent | null => {
  if (!content) return null;
  return (
    unwrap(content.ephemeralMessage?.message) ??
    unwrap(content.viewOnceMessage?.message) ??
    content
  );
};

/** Readable text for a message, or null for reactions, receipts and the like. */
export function messageText(
  content: WaContent | null | undefined,
): string | null {
  const c = unwrap(content);
  if (!c) return null;
  const text = c.conversation ?? c.extendedTextMessage?.text;
  if (text?.trim()) return text.trim();
  const withCaption = (kind: string, caption?: string | null) =>
    caption?.trim() ? `[${kind}] ${caption.trim()}` : `[${kind}]`;
  if (c.imageMessage) return withCaption("photo", c.imageMessage.caption);
  if (c.videoMessage) return withCaption("video", c.videoMessage.caption);
  if (c.audioMessage) return c.audioMessage.ptt ? "[voice message]" : "[audio]";
  if (c.documentMessage) return withCaption("file", c.documentMessage.fileName);
  if (c.stickerMessage) return "[sticker]";
  if (c.contactMessage)
    return withCaption("contact", c.contactMessage.displayName);
  if (c.locationMessage) return "[location]";
  return null;
}

const seconds = (ts: WaMessage["messageTimestamp"]): number | null => {
  if (typeof ts === "number") return ts;
  if (ts && typeof ts === "object" && typeof ts.toNumber === "function")
    return ts.toNumber();
  return null;
};

/**
 * Group messages into one thread per chat, oldest first, deduplicated by
 * message id. `names` maps a jid to a saved or pushed name; failing that the
 * other person's own push name is used, then the handle.
 */
export function toThreads(
  messages: WaMessage[],
  names: Map<string, string>,
  sinceSeconds = 0,
): DmThread[] {
  const byJid = new Map<string, Map<string, DmThread["messages"][number]>>();
  const pushed = new Map<string, string>();
  for (const m of messages) {
    const jid = m.key.remoteJid;
    if (!isPersonJid(jid)) continue;
    const ts = seconds(m.messageTimestamp);
    if (ts === null || ts < sinceSeconds) continue;
    const text = messageText(m.message);
    if (!text) continue;
    if (!m.key.fromMe && m.pushName?.trim()) pushed.set(jid, m.pushName.trim());
    const list = byJid.get(jid) ?? new Map();
    list.set(m.key.id ?? `${ts}:${text}`, {
      direction: m.key.fromMe ? "out" : "in",
      sentAt: new Date(ts * 1000).toISOString(),
      text,
    });
    byJid.set(jid, list);
  }
  return [...byJid.entries()].map(([jid, list]) => {
    const handle = waHandle(jid);
    return {
      threadId: handle,
      counterpart: {
        name: names.get(jid) ?? pushed.get(jid) ?? handle.replace(/^wa:/, ""),
        handle,
      },
      messages: [...list.values()].sort((a, b) =>
        a.sentAt.localeCompare(b.sentAt),
      ),
    };
  });
}
