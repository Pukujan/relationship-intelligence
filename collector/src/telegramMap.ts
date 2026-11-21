/**
 * Pure mapping from Telegram's messages to the app's DM thread shape (#120).
 * Kept apart from the client so it can be tested without a Telegram account.
 */

export interface TgUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  bot?: boolean | null;
  self?: boolean | null;
}

export interface TgMessage {
  id: number;
  /** Unix seconds. */
  date: number;
  out: boolean;
  text: string;
  /** A short kind like "photo" or "voice" when the message has media. */
  media?: string | null;
}

export interface DmThread {
  threadId: string;
  counterpart: { name: string; handle: string };
  messages: { direction: "in" | "out"; sentAt: string; text: string }[];
}

/** The stable handle stored on a contact for this Telegram account. */
export const tgHandle = (userId: string) => `tg:${userId}`;

export const displayName = (user: TgUser): string => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  return user.username ? `@${user.username}` : `Telegram user ${user.id}`;
};

/** Only one-to-one chats with real people: no bots, no Saved Messages. */
export const isPersonChat = (user: TgUser) => !user.bot && !user.self;

/**
 * A thread for the ingest route. Messages with no text say what they were
 * ("[photo]"); empty service messages are dropped. Oldest first.
 */
export function toThread(user: TgUser, messages: TgMessage[]): DmThread {
  const out = messages
    .map((m) => {
      const text = m.text.trim() || (m.media ? `[${m.media}]` : "");
      return text
        ? {
            direction: m.out ? ("out" as const) : ("in" as const),
            sentAt: new Date(m.date * 1000).toISOString(),
            text,
          }
        : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return {
    threadId: `tg-${user.id}`,
    counterpart: { name: displayName(user), handle: tgHandle(user.id) },
    messages: out,
  };
}
