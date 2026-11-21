import { describe, expect, it } from "vitest";
import {
  isPersonJid,
  messageText,
  toThreads,
  type WaMessage,
  waHandle,
} from "./whatsappMap.js";

const JANE = "15551234567@s.whatsapp.net";

describe("WhatsApp mapping (#120)", () => {
  it("keeps one-to-one chats and drops groups, broadcasts and status", () => {
    expect(isPersonJid(JANE)).toBe(true);
    expect(isPersonJid("15551234567:12@s.whatsapp.net")).toBe(true);
    expect(isPersonJid("98765@lid")).toBe(true);
    expect(isPersonJid("120363-1234@g.us")).toBe(false);
    expect(isPersonJid("status@broadcast")).toBe(false);
    expect(isPersonJid(null)).toBe(false);
  });

  it("turns a chat id into a stable handle, dropping device suffixes", () => {
    expect(waHandle(JANE)).toBe("wa:+15551234567");
    expect(waHandle("15551234567:12@s.whatsapp.net")).toBe("wa:+15551234567");
    expect(waHandle("98765@lid")).toBe("wa:lid:98765");
  });

  it("reads text, captions and media kinds, and skips reactions", () => {
    expect(messageText({ conversation: " hi " })).toBe("hi");
    expect(messageText({ extendedTextMessage: { text: "link here" } })).toBe(
      "link here",
    );
    expect(messageText({ imageMessage: { caption: "the venue" } })).toBe(
      "[photo] the venue",
    );
    expect(messageText({ audioMessage: { ptt: true } })).toBe(
      "[voice message]",
    );
    expect(
      messageText({
        ephemeralMessage: { message: { conversation: "disappearing" } },
      }),
    ).toBe("disappearing");
    expect(messageText({})).toBeNull();
    expect(messageText(null)).toBeNull();
  });

  it("groups by chat, orders oldest first, dedupes by id and names the other person", () => {
    const msgs: WaMessage[] = [
      {
        key: { remoteJid: JANE, fromMe: true, id: "B" },
        messageTimestamp: 1_763_740_800,
        message: { conversation: "See you Thursday." },
      },
      {
        key: { remoteJid: JANE, fromMe: false, id: "A" },
        messageTimestamp: { toNumber: () => 1_763_650_000 },
        pushName: "Jane D",
        message: { conversation: "Great meeting you!" },
      },
      {
        key: { remoteJid: JANE, fromMe: false, id: "A" },
        messageTimestamp: 1_763_650_000,
        message: { conversation: "Great meeting you!" },
      },
      {
        key: { remoteJid: "120363-1@g.us", fromMe: false, id: "G" },
        messageTimestamp: 1_763_650_000,
        message: { conversation: "group" },
      },
      {
        key: { remoteJid: JANE, fromMe: false, id: "OLD" },
        messageTimestamp: 1_000,
        message: { conversation: "too old" },
      },
    ];
    const [thread, ...rest] = toThreads(msgs, new Map(), 1_700_000_000);
    expect(rest).toHaveLength(0);
    expect(thread?.threadId).toBe("wa:+15551234567");
    expect(thread?.counterpart).toEqual({
      name: "Jane D",
      handle: "wa:+15551234567",
    });
    expect(thread?.messages.map((m) => [m.direction, m.text])).toEqual([
      ["in", "Great meeting you!"],
      ["out", "See you Thursday."],
    ]);
    const named = toThreads(msgs, new Map([[JANE, "Jane Doe"]]), 1_700_000_000);
    expect(named[0]?.counterpart.name).toBe("Jane Doe");
  });
});
