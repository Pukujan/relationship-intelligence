import { describe, expect, it } from "vitest";
import {
  type DcMessage,
  dmPartner,
  messageText,
  newerId,
  toThread,
} from "./discordMap.js";

const ME = "100";
const jane = { id: "200", username: "jane.doe", global_name: "Jane Doe" };
const dm = { id: "900", type: 1, recipients: [jane], last_message_id: "1003" };

const msg = (
  id: string,
  author: string,
  content: string,
  at: string,
  extra: Partial<DcMessage> = {},
): DcMessage => ({
  id,
  type: 0,
  timestamp: at,
  author: { id: author },
  content,
  ...extra,
});

describe("Discord mapping (#120)", () => {
  it("keeps one-to-one DMs with people and drops groups and bots", () => {
    expect(dmPartner(dm)?.id).toBe("200");
    expect(dmPartner({ ...dm, type: 3 })).toBeNull();
    expect(
      dmPartner({ ...dm, recipients: [{ ...jane, bot: true }] }),
    ).toBeNull();
    expect(dmPartner({ ...dm, recipients: [] })).toBeNull();
  });

  it("reads text, attachments and stickers, and skips system messages", () => {
    expect(messageText(msg("1", "200", " hi ", "2026-11-19T10:00:00Z"))).toBe(
      "hi",
    );
    expect(
      messageText(
        msg("1", "200", "", "2026-11-19T10:00:00Z", {
          attachments: [{ filename: "deck.pdf" }],
        }),
      ),
    ).toBe("[file] deck.pdf");
    expect(
      messageText(
        msg("1", "200", "look", "2026-11-19T10:00:00Z", {
          sticker_items: [{}],
        }),
      ),
    ).toBe("look [sticker]");
    expect(
      messageText(
        msg("1", "200", "pinned", "2026-11-19T10:00:00Z", { type: 6 }),
      ),
    ).toBeNull();
    expect(messageText(msg("1", "200", "", "2026-11-19T10:00:00Z"))).toBeNull();
  });

  it("builds an oldest-first thread keyed by the channel, with direction from the author", () => {
    const thread = toThread(
      dm,
      jane,
      [
        msg("1003", ME, "See you Thursday.", "2026-11-20T12:00:00Z"),
        msg("1001", "200", "Great meeting you!", "2026-11-19T10:00:00Z"),
        msg("1000", "200", "too old", "2025-01-01T00:00:00Z"),
      ],
      ME,
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(thread.threadId).toBe("dc-900");
    expect(thread.counterpart).toEqual({
      name: "Jane Doe",
      handle: "discord:200",
    });
    expect(thread.messages.map((m) => [m.direction, m.text])).toEqual([
      ["in", "Great meeting you!"],
      ["out", "See you Thursday."],
    ]);
  });

  it("falls back to the username and compares ids as big numbers", () => {
    const thread = toThread(dm, { id: "200", username: "jane.doe" }, [], ME);
    expect(thread.counterpart.name).toBe("jane.doe");
    expect(newerId("1200000000000000001", "1200000000000000000")).toBe(true);
    expect(newerId("99", "100")).toBe(false);
    expect(newerId("5", undefined)).toBe(true);
    expect(newerId(null, "5")).toBe(false);
  });
});
