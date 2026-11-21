/**
 * Pure mapping from Discord's REST shapes to the app's DM thread shape (#120).
 * No network here, so it is tested without a Discord account.
 */

export interface DcUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DcChannel {
  id: string;
  /** 1 = one-to-one DM, 3 = group DM. */
  type: number;
  recipients?: DcUser[];
  last_message_id?: string | null;
}

export interface DcMessage {
  id: string;
  /** 0 = normal, 19 = reply; others are joins, pins, calls and so on. */
  type: number;
  timestamp: string;
  author: { id: string };
  content: string;
  attachments?: { filename?: string }[];
  sticker_items?: unknown[];
}

export interface DmThread {
  threadId: string;
  counterpart: { name: string; handle: string };
  messages: { direction: "in" | "out"; sentAt: string; text: string }[];
}

export const dcHandle = (userId: string) => `discord:${userId}`;

/** The other person in a one-to-one DM, or null for groups and bots. */
export function dmPartner(channel: DcChannel): DcUser | null {
  if (channel.type !== 1) return null;
  const other = channel.recipients?.[0];
  if (!other || other.bot) return null;
  return other;
}

/** Text for a message, or null for system messages and empty ones. */
export function messageText(m: DcMessage): string | null {
  if (m.type !== 0 && m.type !== 19) return null;
  const parts = [m.content.trim()];
  for (const a of m.attachments ?? [])
    parts.push(a.filename ? `[file] ${a.filename}` : "[file]");
  if ((m.sticker_items ?? []).length > 0) parts.push("[sticker]");
  const text = parts.filter(Boolean).join(" ");
  return text || null;
}

/** One thread for a DM channel, oldest message first. */
export function toThread(
  channel: DcChannel,
  partner: DcUser,
  messages: DcMessage[],
  meId: string,
  sinceMs = 0,
): DmThread {
  const out = messages
    .map((m) => {
      const text = messageText(m);
      const at = Date.parse(m.timestamp);
      if (!text || Number.isNaN(at) || at < sinceMs) return null;
      return {
        direction: m.author.id === meId ? ("out" as const) : ("in" as const),
        sentAt: new Date(at).toISOString(),
        text,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return {
    threadId: `dc-${channel.id}`,
    counterpart: {
      name: partner.global_name?.trim() || partner.username,
      handle: dcHandle(partner.id),
    },
    messages: out,
  };
}

/** Discord message ids are time-ordered snowflakes; compare them as numbers. */
export const newerId = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean => Boolean(a) && (!b || BigInt(a as string) > BigInt(b));
