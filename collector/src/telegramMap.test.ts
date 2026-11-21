import { describe, expect, it } from "vitest";
import {
  displayName,
  isPersonChat,
  tgHandle,
  toThread,
} from "./telegramMap.js";

describe("Telegram mapping (#120)", () => {
  const jane = {
    id: "4242",
    firstName: "Jane",
    lastName: "Doe",
    username: "janed",
  };

  it("builds a thread keyed by the stable user id, oldest message first", () => {
    const thread = toThread(jane, [
      { id: 3, date: 1_763_740_800, out: true, text: "See you Thursday." },
      { id: 1, date: 1_763_650_000, out: false, text: "Great meeting you!" },
      { id: 2, date: 1_763_650_100, out: false, text: "", media: "photo" },
      { id: 4, date: 1_763_740_900, out: false, text: "   " },
    ]);
    expect(thread.threadId).toBe("tg-4242");
    expect(thread.counterpart).toEqual({ name: "Jane Doe", handle: "tg:4242" });
    expect(thread.messages.map((m) => [m.direction, m.text])).toEqual([
      ["in", "Great meeting you!"],
      ["in", "[photo]"],
      ["out", "See you Thursday."],
    ]);
    expect(thread.messages[0]?.sentAt).toBe(
      new Date(1_763_650_000 * 1000).toISOString(),
    );
  });

  it("names a user by their name, then their username, then their id", () => {
    expect(displayName(jane)).toBe("Jane Doe");
    expect(displayName({ id: "7", username: "sam" })).toBe("@sam");
    expect(displayName({ id: "7" })).toBe("Telegram user 7");
    expect(tgHandle("7")).toBe("tg:7");
  });

  it("skips bots and Saved Messages", () => {
    expect(isPersonChat(jane)).toBe(true);
    expect(isPersonChat({ id: "1", bot: true })).toBe(false);
    expect(isPersonChat({ id: "2", self: true })).toBe(false);
  });
});
