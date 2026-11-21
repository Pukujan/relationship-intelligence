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
 * that contact: their LinkedIn profile link, or an account the owner linked
 * once from "Conversations to match" (a Telegram user id, a phone number, a
 * Discord id). Names never match on their own: two people share names, and
 * PROJECT.md rule 6 forbids merging identities on them. Unmatched threads keep
 * their rows with no person until the owner links them.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { epistemic, graph, linkedinPeople, normUrl } from "./crawler.js";
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

/** A contact and one stable account handle of theirs on a channel. */
export interface ContactHandle {
  personId: string;
  name: string;
  handle: string;
}

/** Comparable form of a handle: LinkedIn by profile slug, others as given. */
export const handleKey = (
  channel: DmChannel,
  handle: string,
): string | null => {
  if (channel === "linkedin") return linkedinKey(handle);
  const key = handle.trim().toLowerCase();
  return key ? key : null;
};

/**
 * The contact a thread belongs to, by stable handle only: never by name.
 */
export function matchThread(
  channel: DmChannel,
  thread: DmThread,
  contacts: ContactHandle[],
): ContactHandle | null {
  const handle = thread.counterpart.handle;
  if (!handle) return null;
  const wanted = handleKey(channel, handle);
  if (!wanted) return null;
  return contacts.find((c) => handleKey(channel, c.handle) === wanted) ?? null;
}

/** The FACT attribute that records a contact's account on a channel. */
export const accountAttribute = (channel: DmChannel) => `${channel}_account`;

/**
 * Contacts with an account linked on this channel (FACT claims with attribute
 * "<channel>_account" and the handle in provenance), plus, for LinkedIn, every
 * contact's sourced profile link.
 */
export async function contactHandles(
  config: OctoClientConfig,
  token: string,
  container: string,
  channel: DmChannel,
): Promise<ContactHandle[]> {
  const [entities, claims, subjects] = await Promise.all([
    graph(
      config,
      token,
      container,
      "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS kind",
    ),
    graph(
      config,
      token,
      container,
      `MATCH (c:Claim) WHERE c.provenance CONTAINS '"${accountAttribute(channel)}"' RETURN c.id AS id, c.supersededAt AS supersededAt, c.provenance AS provenance`,
    ),
    graph(
      config,
      token,
      container,
      "MATCH (c:Claim)-[:SUBJECT]->(e:Entity) RETURN c.id AS claimId, e.id AS entityId",
    ),
  ]);
  const nameOf = new Map(
    entities
      .filter((e) => e.kind === "person")
      .map((e) => [String(e.id), String(e.name)]),
  );
  const subjectOf = new Map(
    subjects.map((r) => [String(r.claimId), String(r.entityId)]),
  );
  const out: ContactHandle[] = [];
  for (const claim of claims) {
    if (claim.supersededAt) continue;
    let prov: Json = {};
    try {
      prov = (
        typeof claim.provenance === "string"
          ? JSON.parse(claim.provenance)
          : (claim.provenance ?? {})
      ) as Json;
    } catch {
      continue;
    }
    const personId = subjectOf.get(String(claim.id));
    if (
      !personId ||
      prov.verb !== "FACT" ||
      prov.attribute !== accountAttribute(channel)
    )
      continue;
    if (typeof prov.handle !== "string" || !nameOf.has(personId)) continue;
    out.push({
      personId,
      name: nameOf.get(personId) ?? personId,
      handle: prov.handle,
    });
  }
  if (channel === "linkedin") {
    for (const p of await linkedinPeople(config, token, container)) {
      out.push({ personId: p.personId, name: p.name, handle: p.url });
    }
  }
  return out;
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
  person: Pick<ContactHandle, "personId" | "name">,
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

/** seedIds of MESSAGED claims already in the ledger. */
async function messagedSeeds(
  config: OctoClientConfig,
  token: string,
  container: string,
): Promise<Set<string>> {
  const rows = await graph(
    config,
    token,
    container,
    `MATCH (c:Claim) WHERE c.provenance CONTAINS '"MESSAGED"' RETURN c.provenance AS p`,
  );
  const seeds = new Set<string>();
  for (const row of rows) {
    try {
      const p = (
        typeof row.p === "string" ? JSON.parse(row.p) : (row.p ?? {})
      ) as Json;
      if (typeof p.seedId === "string") seeds.add(p.seedId);
    } catch {
      // ignore malformed provenance
    }
  }
  return seeds;
}

/** Writes day claims (with the thread link as evidence when there is one). */
async function recordDayClaims(
  config: OctoClientConfig,
  token: string,
  container: string,
  claims: DayClaim[],
  existingSeeds: Set<string>,
  now: Date,
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const claim of claims) {
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
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
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

  const people = await contactHandles(config, token, container, channel);
  const existingSeeds = await messagedSeeds(config, token, container);

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
    const written = await recordDayClaims(
      config,
      token,
      container,
      dayClaims(channel, thread, person, existingSeeds, now),
      existingSeeds,
      now,
    );
    claims += written.written;
    failed += written.failed;
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

/* ------------------------------------------------------------------ */
/* Conversations to match (owner, signed in)                           */
/* ------------------------------------------------------------------ */

export interface UnmatchedConversation {
  channel: DmChannel;
  threadId: string;
  threadUrl: string | null;
  name: string;
  handle: string | null;
  messages: number;
  lastAt: string;
}

/** Threads with no contact yet, newest first. Counts and names only, no text. */
export async function dmConversations(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
): Promise<UnmatchedConversation[]> {
  for (const ddl of DM_DDL) await octoSql(config, token, container, ddl);
  const rows = await octoSql(
    config,
    token,
    container,
    `SELECT channel, thread_id, max(thread_url) AS thread_url, max(counterpart_name) AS name,
            max(counterpart_handle) AS handle, count(*) AS messages, max(sent_at) AS last_at
       FROM ri_console.dm_message
      WHERE workspace_id = ${lit(workspaceId)}
      GROUP BY channel, thread_id
     HAVING bool_and(person_id IS NULL)
      ORDER BY max(sent_at) DESC
      LIMIT 100`,
  );
  return rows.map((r) => ({
    channel: DmChannelSchema.catch("linkedin").parse(r.channel),
    threadId: String(r.thread_id),
    threadUrl: r.thread_url ? String(r.thread_url) : null,
    name: String(r.name ?? ""),
    handle: r.handle ? String(r.handle) : null,
    messages: Number(r.messages ?? 0),
    lastAt: new Date(String(r.last_at)).toISOString(),
  }));
}

export const DmLinkSchema = z.object({
  channel: DmChannelSchema,
  threadId: z.string().min(1).max(200),
  personId: z.string().min(1).max(200),
});

/**
 * The owner says "this conversation is with this contact". Records the
 * account on the contact (a private FACT, so later threads match on their own),
 * attaches the stored messages, and writes the completed days' claims.
 */
export async function dmLink(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
  raw: unknown,
  now = new Date(),
): Promise<DmIngestResult> {
  const parsed = DmLinkSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, status: 400, body: { error: "BAD_REQUEST" } };
  const { channel, threadId, personId } = parsed.data;
  const people = await graph(
    config,
    token,
    container,
    "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS kind",
  );
  const person = people.find(
    (e) => String(e.id) === personId && e.kind === "person",
  );
  if (!person)
    return { ok: false, status: 404, body: { error: "UNKNOWN_PERSON" } };
  const name = String(person.name);
  const rows = await octoSql(
    config,
    token,
    container,
    `SELECT thread_url, counterpart_name, counterpart_handle, direction, sent_at, body
       FROM ri_console.dm_message
      WHERE workspace_id = ${lit(workspaceId)} AND channel = ${lit(channel)} AND thread_id = ${lit(threadId)}
      ORDER BY sent_at`,
  );
  if (rows.length === 0)
    return { ok: false, status: 404, body: { error: "UNKNOWN_THREAD" } };
  const handle = rows.find((r) => r.counterpart_handle)?.counterpart_handle;
  if (!handle) return { ok: false, status: 400, body: { error: "NO_HANDLE" } };

  const label = CHANNEL_LABEL[channel];
  const seedId = sha(
    ["FACT", accountAttribute(channel), personId, String(handle)],
    16,
  );
  const existing = await contactHandles(config, token, container, channel);
  if (
    !existing.some(
      (c) =>
        c.personId === personId &&
        handleKey(channel, c.handle) === handleKey(channel, String(handle)),
    )
  ) {
    await epistemic(config, token, container, "claim", {
      subjectEntityId: personId,
      statement: `${name}'s ${label} account is ${String(rows[0]?.counterpart_name ?? handle)} (${String(handle)})`,
      validFrom: now.toISOString().slice(0, 10),
      recordedAt: now.toISOString(),
      provenance: {
        verb: "FACT",
        attribute: accountAttribute(channel),
        handle: String(handle),
        seedId,
        visibility: "private",
        source: "dm-link",
      },
    });
  }
  await octoSql(
    config,
    token,
    container,
    `UPDATE ri_console.dm_message SET person_id = ${lit(personId)}
      WHERE workspace_id = ${lit(workspaceId)} AND channel = ${lit(channel)} AND thread_id = ${lit(threadId)}`,
  );
  const thread: DmThread = {
    threadId,
    ...(rows[0]?.thread_url ? { threadUrl: String(rows[0].thread_url) } : {}),
    counterpart: {
      name: String(rows[0]?.counterpart_name ?? name),
      handle: String(handle),
    },
    messages: rows.map((r) => ({
      direction: r.direction === "out" ? "out" : "in",
      sentAt: new Date(String(r.sent_at)).toISOString(),
      text: String(r.body ?? ""),
    })),
  };
  const seeds = await messagedSeeds(config, token, container);
  const written = await recordDayClaims(
    config,
    token,
    container,
    dayClaims(channel, thread, { personId, name }, seeds, now),
    seeds,
    now,
  );
  return {
    ok: true,
    status: 200,
    body: {
      linked: true,
      messages: rows.length,
      claims: written.written,
      failed: written.failed,
    },
  };
}
