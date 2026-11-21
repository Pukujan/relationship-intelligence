/**
 * Direct-message import (#120): DMs from LinkedIn (and later Telegram,
 * WhatsApp and Discord) land here from a runner on the owner's behalf.
 *
 * Two layers, both private to the workspace owner:
 *   - every message is one row in ri_console.dm_message, deduplicated by a
 *     hash of its content, so re-sending a thread never stores it twice;
 *   - each completed day of a thread matched to a contact becomes one MESSAGED
 *     claim on that contact, which the profile's event log and "last contact"
 *     read. Today's messages wait until the day is over, so a day's claim is
 *     written once with its final count.
 *
 * A thread is attached to a contact only through a stable handle stored on
 * that contact (a LinkedIn profile link today). Names never match: two people
 * share names, and PROJECT.md rule 6 forbids merging identities on them.
 * Unmatched threads keep their rows with no person, for later review.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import {
  epistemic,
  graph,
  linkedinPeople,
  normUrl,
  type PersonUrl,
} from "./crawler.js";
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { octoSql } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

type Json = Record<string, unknown>;

export const DM_DDL = [
  `CREATE TABLE IF NOT EXISTS ri_console.dm_message (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    thread_url TEXT,
    person_id TEXT,
    counterpart_name TEXT NOT NULL,
    counterpart_handle TEXT,
    direction TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    body TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dm_message_person ON ri_console.dm_message (workspace_id, person_id, sent_at)`,
];

export const DmChannelSchema = z.enum([
  "linkedin",
  "telegram",
  "whatsapp",
  "discord",
]);
export type DmChannel = z.infer<typeof DmChannelSchema>;

export const DmMessageSchema = z.object({
  direction: z.enum(["in", "out"]),
  sentAt: z.string().datetime({ offset: true }),
  text: z.string().max(20_000),
});

export const DmThreadSchema = z.object({
  threadId: z.string().min(1).max(200),
  threadUrl: z.string().url().max(500).optional(),
  counterpart: z.object({
    name: z.string().min(1).max(200),
    /** LinkedIn profile link, phone number, or platform user id. */
    handle: z.string().max(500).optional(),
  }),
  messages: z.array(DmMessageSchema).max(2_000),
});
export type DmThread = z.infer<typeof DmThreadSchema>;

export const DmIngestSchema = z.object({
  channel: DmChannelSchema,
  threads: z.array(DmThreadSchema).max(20),
});
export type DmIngest = z.infer<typeof DmIngestSchema>;

const CHANNEL_LABEL: Record<DmChannel, string> = {
  linkedin: "LinkedIn",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
};

const sha = (parts: string[], length = 24) =>
  createHash("sha256")
    .update(parts.join("\x00"))
    .digest("hex")
    .slice(0, length);

/** One message's identity: the same message re-sent is the same row. */
export const messageId = (
  channel: DmChannel,
  threadId: string,
  message: z.infer<typeof DmMessageSchema>,
): string =>
  `dm-${sha([channel, threadId, message.direction, new Date(message.sentAt).toISOString(), message.text])}`;

/** One thread-day's claim identity. */
export const daySeedId = (
  channel: DmChannel,
  threadId: string,
  day: string,
): string => sha(["MESSAGED", channel, threadId, day], 16);

/**
 * A LinkedIn profile link reduced to its profile slug, so "linkedin.com/in/x",
 * "https://www.linkedin.com/in/X/?miniProfile=..." and "https://uk.linkedin.com/in/x"
 * compare equal. Null when the link isn't a LinkedIn profile.
 */
export const linkedinKey = (url: string): string | null => {
  const slug = normUrl(url).match(/linkedin\.com\/in\/([^/#]+)/)?.[1];
  if (!slug) return null;
  try {
    return decodeURIComponent(slug).toLowerCase();
  } catch {
    return slug.toLowerCase();
  }
};

/**
 * The contact a thread belongs to, by stable handle only. LinkedIn threads
 * match a contact's sourced linkedin_url; other channels have no stored
 * handles yet, so they stay unmatched until they do.
 */
export function matchThread(
  channel: DmChannel,
  thread: DmThread,
  people: PersonUrl[],
): PersonUrl | null {
  const handle = thread.counterpart.handle;
  if (!handle) return null;
  if (channel === "linkedin") {
    const wanted = linkedinKey(handle);
    if (!wanted) return null;
    return people.find((p) => linkedinKey(p.url) === wanted) ?? null;
  }
  return null;
}

export interface DayClaim {
  personId: string;
  seedId: string;
  day: string;
  statement: string;
  threadUrl: string | undefined;
  provenance: Json;
}

const snippetOf = (text: string, max = 140) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

/**
 * The MESSAGED claims a matched thread should have: one per completed UTC day
 * with messages, skipping days already in the ledger. Today is left for the
 * next run, so a day's claim carries its final count.
 */
export function dayClaims(
  channel: DmChannel,
  thread: DmThread,
  person: PersonUrl,
  existingSeeds: Set<string>,
  now: Date,
): DayClaim[] {
  const today = now.toISOString().slice(0, 10);
  const byDay = new Map<string, z.infer<typeof DmMessageSchema>[]>();
  for (const message of thread.messages) {
    const day = new Date(message.sentAt).toISOString().slice(0, 10);
    if (day >= today) continue;
    const list = byDay.get(day) ?? [];
    list.push(message);
    byDay.set(day, list);
  }
  const out: DayClaim[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const seedId = daySeedId(channel, thread.threadId, day);
    if (existingSeeds.has(seedId)) continue;
    const messages = (byDay.get(day) ?? []).sort((a, b) =>
      a.sentAt.localeCompare(b.sentAt),
    );
    const fromThem = messages.filter((m) => m.direction === "in").length;
    const fromMe = messages.length - fromThem;
    const last = messages[messages.length - 1];
    const label = CHANNEL_LABEL[channel];
    const who = last?.direction === "in" ? person.name.split(" ")[0] : "You";
    const statement = `Messaged ${person.name} on ${label}: ${messages.length} message${messages.length === 1 ? "" : "s"} (${fromThem} from them, ${fromMe} from you). Last, ${who}: "${snippetOf(last?.text ?? "")}"`;
    out.push({
      personId: person.personId,
      seedId,
      day,
      statement,
      threadUrl: thread.threadUrl,
      provenance: {
        verb: "MESSAGED",
        channel,
        threadId: thread.threadId,
        day,
        messageCount: messages.length,
        fromThem,
        fromMe,
        seedId,
        // Not "shared" and no principal: only the workspace owner sees it
        // (isClaimVisibleToScope in world.ts).
        visibility: "private",
        source: `dm-${channel}`,
      },
    });
  }
  return out;
}

/** Constant-time bearer check against DM_INGEST_TOKEN; unset means disabled. */
export function dmAuthorized(
  req: Pick<IncomingMessage, "headers">,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const header = String(req.headers.authorization ?? "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** DM threads are larger than the adapter's 8 KB default; cap them at 1 MB. */
export const DM_MAX_BODY_BYTES = 1024 * 1024;

export function readDmBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let text = "";
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DM_MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      text += chunk.toString("utf8");
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

export type DmIngestResult = {
  ok: boolean;
  status: number;
  body: Json;
};

export async function dmIngest(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
  raw: unknown,
  now = new Date(),
): Promise<DmIngestResult> {
  const parsed = DmIngestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "BAD_REQUEST",
        detail: parsed.error.issues
          .map((i) => i.message)
          .join("; ")
          .slice(0, 300),
      },
    };
  }
  const { channel, threads } = parsed.data;
  for (const ddl of DM_DDL) await octoSql(config, token, container, ddl);
  const span = startSpan({
    name: `dm.ingest.${channel}`,
    kind: "TOOL",
    workspaceId,
    attributes: { "ri.dm_channel": channel, "ri.dm_threads": threads.length },
  });

  const people =
    channel === "linkedin"
      ? await linkedinPeople(config, token, container)
      : [];
  const existingRows = await graph(
    config,
    token,
    container,
    `MATCH (c:Claim) WHERE c.provenance CONTAINS '"MESSAGED"' RETURN c.provenance AS p`,
  );
  const existingSeeds = new Set<string>();
  for (const row of existingRows) {
    try {
      const p = JSON.parse(String(row.p ?? "{}")) as Json;
      if (typeof p.seedId === "string") existingSeeds.add(p.seedId);
    } catch {
      // ignore malformed provenance
    }
  }

  let stored = 0;
  let matched = 0;
  let unmatched = 0;
  let claims = 0;
  let failed = 0;
  for (const thread of threads) {
    const person = matchThread(channel, thread, people);
    if (person) matched++;
    else unmatched++;
    for (const message of thread.messages) {
      const id = messageId(channel, thread.threadId, message);
      const rows = await octoSql(
        config,
        token,
        container,
        `INSERT INTO ri_console.dm_message (id, workspace_id, channel, thread_id, thread_url, person_id, counterpart_name, counterpart_handle, direction, sent_at, body)
         VALUES (${lit(id)}, ${lit(workspaceId)}, ${lit(channel)}, ${lit(thread.threadId)}, ${thread.threadUrl ? lit(thread.threadUrl) : "NULL"}, ${person ? lit(person.personId) : "NULL"}, ${lit(thread.counterpart.name)}, ${thread.counterpart.handle ? lit(thread.counterpart.handle) : "NULL"}, ${lit(message.direction)}, ${lit(message.sentAt)}, ${lit(message.text)})
         ON CONFLICT (id) DO UPDATE SET person_id = COALESCE(EXCLUDED.person_id, ri_console.dm_message.person_id)
         RETURNING (xmax = 0) AS inserted`,
      );
      if (rows[0]?.inserted === true) stored++;
    }
    if (!person) continue;
    for (const claim of dayClaims(
      channel,
      thread,
      person,
      existingSeeds,
      now,
    )) {
      try {
        const claimRes = (await epistemic(config, token, container, "claim", {
          subjectEntityId: claim.personId,
          statement: claim.statement,
          validFrom: claim.day,
          recordedAt: now.toISOString(),
          provenance: claim.provenance,
        })) as { claim?: { id?: string } };
        const claimId = claimRes.claim?.id;
        if (!claimId) throw new Error("no claim id");
        if (claim.threadUrl) {
          const evRes = (await epistemic(config, token, container, "evidence", {
            locator: claim.threadUrl,
            quote: null,
          })) as { evidence?: { id?: string } };
          const evidenceId = evRes.evidence?.id;
          if (evidenceId) {
            await epistemic(config, token, container, "claim_evidence", {
              claimId,
              evidenceId,
              stance: "supports",
            });
          }
        }
        existingSeeds.add(claim.seedId);
        claims++;
      } catch {
        failed++;
      }
    }
  }

  await appendLedgerEvent(config, token, container, {
    workspaceId,
    principalId: `dm-${channel}`,
    traceId: span.traceId,
    eventType: `dm.ingest.${channel}`,
    entityKind: "dm_thread",
    entityId: channel,
    // Counts only: message text never goes to the event log or traces.
    payload: {
      threads: threads.length,
      matched,
      unmatched,
      stored,
      claims,
      failed,
    },
  });
  await endSpan(span, failed ? "ERROR" : "OK", {
    matched,
    unmatched,
    stored,
    claims,
    failed,
  });
  return {
    ok: true,
    status: 200,
    body: {
      threads: threads.length,
      matched,
      unmatched,
      stored,
      claims,
      failed,
      traceId: span.traceId,
    },
  };
}
