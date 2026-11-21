import { describe, expect, it } from "vitest";
import {
  buildThread,
  parseClock,
  resolveDay,
  type ToInstant,
  threadIdOf,
} from "./dmParse.js";

// Saturday 21 November 2026, local time.
const NOW = new Date(2026, 10, 21, 15, 0);
const utc: ToInstant = (day, h, m) =>
  `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

describe("resolveDay", () => {
  it.each([
    ["Today", "2026-11-21"],
    ["Yesterday", "2026-11-20"],
    ["Monday", "2026-11-16"],
    ["Saturday", "2026-11-14"],
    ["Nov 18", "2026-11-18"],
    ["Dec 30", "2025-12-30"],
    ["Nov 18, 2024", "2024-11-18"],
    ["September 3", "2026-09-03"],
  ])("%s -> %s", (heading, expected) => {
    expect(resolveDay(heading, NOW)).toBe(expected);
  });

  it("returns null for text that isn't a day", () => {
    expect(resolveDay("", NOW)).toBeNull();
    expect(resolveDay("Feb 31", NOW)).toBeNull();
    expect(resolveDay("Jane Doe sent a post", NOW)).toBeNull();
  });
});

describe("parseClock", () => {
  it("reads 12- and 24-hour times", () => {
    expect(parseClock("10:42 AM")).toEqual([10, 42]);
    expect(parseClock("12:05 AM")).toEqual([0, 5]);
    expect(parseClock("12:30 PM")).toEqual([12, 30]);
    expect(parseClock("9:07 pm")).toEqual([21, 7]);
    expect(parseClock("22:05")).toEqual([22, 5]);
    expect(parseClock("noon")).toBeNull();
  });
});

describe("buildThread", () => {
  const raw = {
    threadUrl: "/messaging/thread/2-abc123==/",
    counterpartName: "Jane Doe",
    counterpartProfileUrl: "/in/jane-doe/",
    events: [
      {
        kind: "message" as const,
        sender: "Jane Doe",
        time: "9:00 AM",
        text: "Before any heading: dropped.",
      },
      { kind: "heading" as const, text: "Yesterday" },
      {
        kind: "message" as const,
        sender: "Jane Doe",
        time: "9:15 AM",
        text: "Great meeting you!",
      },
      {
        kind: "message" as const,
        sender: "",
        time: "",
        text: "Same group, same sender.",
      },
      {
        kind: "message" as const,
        sender: "Pujan B.",
        time: "10:02 AM",
        text: "Likewise.",
      },
      { kind: "heading" as const, text: "Today" },
      {
        kind: "message" as const,
        sender: "Jane  doe",
        time: "1:30 PM",
        text: "See you Thursday.",
      },
    ],
  };

  it("dates every message, carries senders forward, and sets direction by the counterpart's name", () => {
    const thread = buildThread(raw, NOW, utc);
    expect(thread?.threadId).toBe("2-abc123==");
    expect(thread?.threadUrl).toBe(
      "https://www.linkedin.com/messaging/thread/2-abc123==/",
    );
    expect(thread?.counterpart).toEqual({
      name: "Jane Doe",
      handle: "https://www.linkedin.com/in/jane-doe/",
    });
    expect(thread?.messages).toEqual([
      {
        direction: "in",
        sentAt: "2026-11-20T09:15:00.000Z",
        text: "Great meeting you!",
      },
      {
        direction: "in",
        sentAt: "2026-11-20T09:15:00.000Z",
        text: "Same group, same sender.",
      },
      {
        direction: "out",
        sentAt: "2026-11-20T10:02:00.000Z",
        text: "Likewise.",
      },
      {
        direction: "in",
        sentAt: "2026-11-21T13:30:00.000Z",
        text: "See you Thursday.",
      },
    ]);
  });

  it("refuses a URL that isn't a messaging thread", () => {
    expect(
      buildThread({ ...raw, threadUrl: "/in/jane-doe/" }, NOW, utc),
    ).toBeNull();
    expect(
      threadIdOf("https://www.linkedin.com/messaging/thread/2-x/?mini=1"),
    ).toBe("2-x");
  });

  it("leaves the handle off when no profile link was found", () => {
    expect(
      buildThread({ ...raw, counterpartProfileUrl: null }, NOW, utc)
        ?.counterpart,
    ).toEqual({
      name: "Jane Doe",
    });
  });
});
