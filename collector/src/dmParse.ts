/**
 * Pure helpers for the LinkedIn DM reader (#120): turn what the messaging page
 * shows (day headings like "Today" or "Nov 18", clock times like "10:42 AM",
 * sender names that appear only at the start of a group) into dated messages.
 * No browser or network here, so it is unit-tested directly.
 */

export type RawEvent =
  | { kind: "heading"; text: string }
  | { kind: "message"; sender: string; time: string; text: string };

export interface RawThread {
  threadUrl: string;
  counterpartName: string;
  counterpartProfileUrl: string | null;
  events: RawEvent[];
}

export interface DmMessage {
  direction: "in" | "out";
  sentAt: string;
  text: string;
}

export interface DmThread {
  threadId: string;
  threadUrl: string;
  counterpart: { name: string; handle?: string };
  messages: DmMessage[];
}

/** Local wall-clock time to an ISO instant. The runner uses the container's TZ. */
export type ToInstant = (day: string, hour: number, minute: number) => string;

export const localInstant: ToInstant = (day, hour, minute) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute).toISOString();
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * A day heading as LinkedIn shows it, resolved against `now` in local time:
 * "Today", "Yesterday", a weekday name (the most recent one, within a week),
 * "Nov 18" (this year, or last year if that date is still ahead), or
 * "Nov 18, 2025". Null when it isn't a recognisable day.
 */
export function resolveDay(heading: string, now: Date): string | null {
  const text = heading.trim().toLowerCase();
  if (!text) return null;
  if (text === "today") return ymd(now);
  if (text === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  const weekday = WEEKDAYS.indexOf(text);
  if (weekday >= 0) {
    const d = new Date(now);
    const back = (now.getDay() - weekday + 7) % 7 || 7;
    d.setDate(d.getDate() - back);
    return ymd(d);
  }
  const m = text.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (m) {
    const month = MONTHS.indexOf(m[1] ?? "");
    const day = Number(m[2]);
    if (month < 0 || day < 1 || day > 31) return null;
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    let date = new Date(year, month, day);
    if (!m[3] && date > now) {
      year -= 1;
      date = new Date(year, month, day);
    }
    return date.getMonth() === month ? ymd(date) : null;
  }
  return null;
}

/** "10:42 AM" or "22:05" to [hour, minute]; null otherwise. */
export function parseClock(text: string): [number, number] | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const half = m[3]?.toLowerCase();
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return [hour, minute];
}

/** The thread id in "/messaging/thread/2-abc==/" or a full URL. */
export function threadIdOf(url: string): string | null {
  return url.match(/\/messaging\/thread\/([^/?#]+)/)?.[1] ?? null;
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, " ") ===
  b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Dated messages from a thread's raw events. A message without its own day
 * heading or time inherits the last one seen; a message without a sender
 * belongs to the group above it. Messages before the first readable day are
 * dropped rather than guessed.
 */
export function buildThread(
  raw: RawThread,
  now: Date,
  toInstant: ToInstant = localInstant,
): DmThread | null {
  const threadId = threadIdOf(raw.threadUrl);
  if (!threadId) return null;
  let day: string | null = null;
  let clock: [number, number] = [12, 0];
  let sender = "";
  const messages: DmMessage[] = [];
  for (const event of raw.events) {
    if (event.kind === "heading") {
      day = resolveDay(event.text, now) ?? day;
      continue;
    }
    if (event.sender.trim()) sender = event.sender;
    const parsed = parseClock(event.time);
    if (parsed) clock = parsed;
    const text = event.text.trim();
    if (!day || !text || !sender) continue;
    messages.push({
      direction: sameName(sender, raw.counterpartName) ? "in" : "out",
      sentAt: toInstant(day, clock[0], clock[1]),
      text,
    });
  }
  const thread: DmThread = {
    threadId,
    threadUrl: new URL(raw.threadUrl, "https://www.linkedin.com").toString(),
    counterpart: { name: raw.counterpartName.trim() },
    messages,
  };
  if (raw.counterpartProfileUrl) {
    thread.counterpart.handle = new URL(
      raw.counterpartProfileUrl,
      "https://www.linkedin.com",
    ).toString();
  }
  return thread;
}
