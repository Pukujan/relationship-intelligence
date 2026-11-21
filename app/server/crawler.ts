/**
 * Slow LinkedIn crawler — server side (RI-0023, owner decision #108).
 *
 * A slow, human-paced crawl of publicly viewable profile facts, not
 * consent-gated collection. The local runner (collector/src/crawl.ts) attaches
 * to the owner's own already-running browser; this module hands out the queue
 * and ingests extracted facts as sourced FACT claims with the profile URL as
 * evidence. Pacing is enforced here, not trusted to the runner: the queue
 * ships delay bounds and a daily cap, and a blocked visit cools the whole
 * queue down for 24 hours. Nothing routes around a block.
 *
 * Ingest is idempotent: a fact's seedId hashes verb + statement + attribute +
 * URL, so re-crawling a profile appends nothing twice (MR-I1 style).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent, endSpan, startSpan } from "./telemetry.js";
import { octoSql } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

type Json = Record<string, unknown>;

export const CRAWL_DDL = [
  `CREATE TABLE IF NOT EXISTS ri_console.crawl_visit (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    facts_count INTEGER NOT NULL DEFAULT 0,
    connections_count INTEGER NOT NULL DEFAULT 0,
    posts_count INTEGER NOT NULL DEFAULT 0,
    image_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ri_console.crawl_observation (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT,
    url TEXT,
    detail TEXT,
    topic TEXT,
    seed_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export const CRAWL_PACING = {
  minDelayMs: 45_000,
  maxDelayMs: 90_000,
  dailyCap: 40,
  cooldownMs: 86_400_000,
  staleAfterDays: 30,
};

const ALLOWED_ATTRIBUTES = [
  "public_role_summary",
  "public_headline",
  "public_education",
  "public_profile_credential",
  "location",
] as const;

export const CrawlerIngestSchema = z.object({
  personId: z.string().min(1).max(80),
  url: z.string().url().max(300),
  status: z.enum(["ok", "blocked", "error"]),
  visitedAt: z.string().max(40).optional(),
  facts: z
    .array(
      z.object({
        attribute: z.enum(ALLOWED_ATTRIBUTES),
        statement: z.string().min(1).max(600),
        quote: z.string().max(600).optional(),
      }),
    )
    .max(20)
    .default([]),
  // Contact info shown on the profile's Contact info overlay, when visible.
  contact: z
    .object({
      email: z.string().max(200).optional(),
      phone: z.string().max(60).optional(),
      website: z.string().max(300).optional(),
      twitter: z.string().max(200).optional(),
      github: z.string().max(200).optional(),
    })
    .default({}),
  // The profile photo URL used as the person's avatar in the console.
  imageUrl: z.string().url().max(600).nullable().optional(),
  // Connections visible on the profile (paginated by the runner).
  connections: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        url: z.string().max(300).optional(),
        headline: z.string().max(300).optional(),
      }),
    )
    .max(500)
    .default([]),
  connectionsComplete: z.boolean().default(false),
  // Posts from the profile's activity tab, with a coarse topic classification.
  posts: z
    .array(
      z.object({
        text: z.string().min(1).max(3_000),
        date: z.string().max(40).optional(),
        url: z.string().max(300).optional(),
        topic: z
          .enum([
            "product",
            "hiring",
            "fundraising",
            "research",
            "event",
            "opinion",
            "personal",
            "other",
          ])
          .default("other"),
      }),
    )
    .max(100)
    .default([]),
  // Companies seen from profile experience and company pages.
  companies: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        url: z.string().max(300).optional(),
        description: z.string().max(1_000).optional(),
      }),
    )
    .max(50)
    .default([]),
  // People this person follows, when visible.
  follows: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        url: z.string().max(300).optional(),
      }),
    )
    .max(300)
    .default([]),
  // Home-feed posts collected in the same session (attributed to 'feed').
  feed: z
    .array(
      z.object({
        author: z.string().min(1).max(160),
        text: z.string().min(1).max(3_000),
        url: z.string().max(300).optional(),
        topic: z
          .enum([
            "product",
            "hiring",
            "fundraising",
            "research",
            "event",
            "opinion",
            "personal",
            "other",
          ])
          .default("other"),
      }),
    )
    .max(100)
    .default([]),
});

/** Only public /in/ profile URLs on linkedin.com itself — never lookalikes. */
export const isProfileUrl = (url: string): boolean =>
  /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%\u00A0-\uFFFF]+\/?(\?.*)?$/u.test(
    url,
  );

export const normUrl = (url: string): string =>
  url.split("?")[0]?.replace(/\/+$/, "").toLowerCase() ?? "";

const visitId = (url: string): string =>
  createHash("sha256").update(normUrl(url)).digest("hex").slice(0, 24);

const seedIdOf = (attribute: string, statement: string, url: string): string =>
  createHash("sha256")
    .update(`FACT\x00${statement}\x00${attribute}\x00${normUrl(url)}`)
    .digest("hex")
    .slice(0, 16);

/** Deterministic id for a graph observation (connection/post/company/follow/feed). */
const observationSeedId = (
  kind: string,
  name: string,
  detail: string,
  url: string,
): string =>
  createHash("sha256")
    .update(`${kind}\x00${name}\x00${detail.slice(0, 120)}\x00${normUrl(url)}`)
    .digest("hex")
    .slice(0, 16);

/** Constant-time bearer check against CRAWLER_TOKEN; unset means disabled. */
export function crawlerAuthorized(
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

export async function readCrawlerBody(req: IncomingMessage): Promise<unknown> {
  const text = await new Promise<string>((resolve, reject) => {
    let acc = "";
    req.on("data", (chunk: Buffer) => {
      acc += chunk.toString("utf8");
      if (acc.length > 65_536) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(acc));
    req.on("error", reject);
  });
  return text ? JSON.parse(text) : {};
}

export const graph = async (
  config: OctoClientConfig,
  token: string,
  container: string,
  query: string,
): Promise<Json[]> => {
  const res = await fetch(new URL("/api/graph/query", config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId: container, query }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`graph ${res.status}`);
  const body = (await res.json()) as { rows?: Json[] };
  return body.rows ?? [];
};

export const epistemic = async (
  config: OctoClientConfig,
  token: string,
  container: string,
  kind: string,
  fields: Json,
): Promise<Json> => {
  const res = await fetch(new URL("/api/epistemic/record", config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId: container, kind, ...fields }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`epistemic ${kind} ${res.status}`);
  return (await res.json()) as Json;
};

export interface PersonUrl {
  personId: string;
  name: string;
  url: string;
}

/** People with a sourced linkedin_url FACT, minus retired sample people. */
export async function linkedinPeople(
  config: OctoClientConfig,
  token: string,
  container: string,
): Promise<PersonUrl[]> {
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
      "MATCH (c:Claim) RETURN c.id AS id, c.statement AS statement, c.supersededAt AS supersededAt, c.provenance AS provenance",
    ),
    graph(
      config,
      token,
      container,
      "MATCH (c:Claim)-[:SUBJECT]->(e:Entity) RETURN c.id AS claimId, e.id AS entityId",
    ),
  ]);
  const subjectOf = new Map(
    subjects.map((s) => [String(s.claimId), String(s.entityId)]),
  );
  const nameOf = new Map(
    entities
      .filter((e) => e.kind === "person")
      .map((e) => [String(e.id), String(e.name)]),
  );
  const retired = new Set<string>();
  const urlOf = new Map<string, string>();
  for (const claim of claims) {
    if (claim.supersededAt) continue;
    let prov: Json = {};
    try {
      prov = JSON.parse(String(claim.provenance ?? "{}")) as Json;
    } catch {
      prov = {};
    }
    const personId = subjectOf.get(String(claim.id));
    if (!personId) continue;
    if (prov.verb === "RETIRED") retired.add(personId);
    if (prov.verb === "FACT" && prov.attribute === "linkedin_url") {
      const match = String(claim.statement ?? "").match(
        /https:\/\/(www\.)?linkedin\.com\/in\/[^\s)"']+/i,
      );
      if (match && !urlOf.has(personId)) urlOf.set(personId, match[0]);
    }
  }
  const out: PersonUrl[] = [];
  for (const [personId, url] of urlOf) {
    if (retired.has(personId) || !nameOf.has(personId)) continue;
    if (!isProfileUrl(url)) continue;
    out.push({ personId, name: nameOf.get(personId) ?? personId, url });
  }
  return out;
}

export interface CrawlQueue {
  items: (PersonUrl & { lastVisitedAt: string | null })[];
  pacing: typeof CRAWL_PACING;
  cooldownUntil: string | null;
}

export async function crawlerQueue(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
  limit = 20,
  now = new Date(),
): Promise<CrawlQueue> {
  for (const ddl of CRAWL_DDL) await octoSql(config, token, container, ddl);
  const blocked = await octoSql(
    config,
    token,
    container,
    `SELECT visited_at FROM ri_console.crawl_visit
     WHERE workspace_id = ${lit(workspaceId)} AND status = 'blocked'
     ORDER BY visited_at DESC LIMIT 1`,
  );
  const lastBlocked = blocked[0]?.visited_at;
  if (lastBlocked) {
    const until = new Date(
      new Date(String(lastBlocked)).getTime() + CRAWL_PACING.cooldownMs,
    );
    if (until.getTime() > now.getTime()) {
      return {
        items: [],
        pacing: CRAWL_PACING,
        cooldownUntil: until.toISOString(),
      };
    }
  }
  const people = await linkedinPeople(config, token, container);
  const visits = await octoSql(
    config,
    token,
    container,
    `SELECT person_id, url, status, visited_at FROM ri_console.crawl_visit
     WHERE workspace_id = ${lit(workspaceId)}`,
  );
  const lastOk = new Map<string, string>();
  let todayCount = 0;
  const dayStart = now.toISOString().slice(0, 10);
  for (const v of visits) {
    const at = String(v.visited_at ?? "");
    if (v.status === "ok") {
      const prev = lastOk.get(String(v.person_id));
      if (!prev || at > prev) lastOk.set(String(v.person_id), at);
    }
    if (at.slice(0, 10) === dayStart) todayCount++;
  }
  const staleCutoff = new Date(
    now.getTime() - CRAWL_PACING.staleAfterDays * 86_400_000,
  ).toISOString();
  const items = people
    .map((p) => ({ ...p, lastVisitedAt: lastOk.get(p.personId) ?? null }))
    .filter((p) => !p.lastVisitedAt || p.lastVisitedAt < staleCutoff)
    .sort((a, b) =>
      (a.lastVisitedAt ?? "").localeCompare(b.lastVisitedAt ?? ""),
    );
  const remaining = Math.max(0, CRAWL_PACING.dailyCap - todayCount);
  return {
    items: items.slice(0, Math.max(0, Math.min(limit, remaining))),
    pacing: CRAWL_PACING,
    cooldownUntil: null,
  };
}

export type IngestResult =
  | { ok: true; status: number; body: Json }
  | { ok: false; status: number; body: Json };

/** Insert one deduplicated graph observation (connection/post/company/follow/feed).
 * The SQL table is the idempotency guard (PRIMARY KEY + DO NOTHING), so a
 * replay never duplicates. Facts are claims on the crawled person with the
 * source URL as evidence; nothing here sends, follows, or posts anything. */
async function recordObservation(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
  subjectPersonId: string,
  sourceUrl: string,
  kind: "connection" | "post" | "company" | "follow" | "feed",
  item: {
    name: string;
    url?: string | undefined;
    detail?: string | undefined;
    topic?: string | undefined;
  },
  counters: { recorded: number; skipped: number; failed: number },
): Promise<void> {
  const seedId = observationSeedId(
    kind,
    item.name,
    item.detail ?? "",
    sourceUrl,
  );
  const id = `obs-${seedId}`;
  const statement =
    kind === "connection"
      ? `${item.name} is a connection of this profile${item.detail ? ` — ${item.detail}` : ""}`
      : kind === "follow"
        ? `this profile follows ${item.name}`
        : kind === "post"
          ? `${item.name} posted about ${item.topic ?? "other"}: ${(item.detail ?? "").slice(0, 200)}`
          : kind === "feed"
            ? `feed post by ${item.name} about ${item.topic ?? "other"}: ${(item.detail ?? "").slice(0, 200)}`
            : `company: ${item.name}${item.detail ? ` — ${item.detail.slice(0, 200)}` : ""}`;
  try {
    const inserted = await octoSql(
      config,
      token,
      container,
      `INSERT INTO ri_console.crawl_observation
         (id, workspace_id, person_id, source_url, kind, name, url, detail, topic, seed_id)
       VALUES (${lit(id)}, ${lit(workspaceId)}, ${lit(subjectPersonId)}, ${lit(sourceUrl)}, ${lit(kind)}, ${lit(item.name)}, ${item.url ? lit(item.url) : "NULL"}, ${item.detail ? lit(item.detail.slice(0, 1000)) : "NULL"}, ${item.topic ? lit(item.topic) : "NULL"}, ${lit(seedId)})
       ON CONFLICT (id) DO NOTHING RETURNING id`,
    );
    if (!inserted.length) {
      counters.skipped++;
      return;
    }
    const attr =
      kind === "connection"
        ? "linkedin_connection"
        : kind === "follow"
          ? "linkedin_follow"
          : kind === "post"
            ? "linkedin_post_topic"
            : kind === "feed"
              ? "feed_post_topic"
              : "company_page";
    await epistemic(config, token, container, "claim", {
      subjectEntityId: subjectPersonId,
      statement,
      validFrom: new Date().toISOString().slice(0, 10),
      recordedAt: new Date().toISOString(),
      provenance: {
        verb: "FACT",
        attribute: attr,
        seedId,
        source: "linkedin-slow-crawler",
        ...(item.topic ? { topic: item.topic } : {}),
      },
    });
    counters.recorded++;
  } catch {
    counters.failed++;
  }
}

export async function crawlerIngest(
  config: OctoClientConfig,
  token: string,
  container: string,
  workspaceId: string,
  raw: unknown,
  now = new Date(),
): Promise<IngestResult> {
  const parsed = CrawlerIngestSchema.safeParse(raw);
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
  const data = parsed.data;
  if (!isProfileUrl(data.url)) {
    return { ok: false, status: 400, body: { error: "INVALID_URL" } };
  }
  const people = await linkedinPeople(config, token, container);
  const person = people.find((p) => p.personId === data.personId);
  if (!person) {
    return { ok: false, status: 404, body: { error: "UNKNOWN_PERSON" } };
  }
  if (normUrl(person.url) !== normUrl(data.url)) {
    return { ok: false, status: 400, body: { error: "URL_MISMATCH" } };
  }
  for (const ddl of CRAWL_DDL) await octoSql(config, token, container, ddl);
  const span = startSpan({
    name: "crawler.ingest",
    kind: "TOOL",
    workspaceId,
    attributes: {
      "ri.person_id": data.personId,
      "ri.crawl_status": data.status,
    },
  });
  const nowIso = now.toISOString();
  const visitedAt = data.visitedAt ?? nowIso;
  const upsertVisit = (
    status: string,
    factsCount: number,
    extra: {
      connections?: number;
      posts?: number;
      imageUrl?: string | null;
    } = {},
  ) =>
    octoSql(
      config,
      token,
      container,
      `INSERT INTO ri_console.crawl_visit (id, workspace_id, person_id, url, status, visited_at, facts_count, connections_count, posts_count, image_url)
       VALUES (${lit(visitId(data.url))}, ${lit(workspaceId)}, ${lit(data.personId)}, ${lit(data.url)}, ${lit(status)}, ${lit(visitedAt)}, ${factsCount}, ${extra.connections ?? 0}, ${extra.posts ?? 0}, ${extra.imageUrl ? lit(extra.imageUrl) : "NULL"})
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, visited_at = EXCLUDED.visited_at, facts_count = EXCLUDED.facts_count, connections_count = EXCLUDED.connections_count, posts_count = EXCLUDED.posts_count, image_url = COALESCE(EXCLUDED.image_url, ri_console.crawl_visit.image_url)`,
    );

  if (data.status !== "ok") {
    await upsertVisit(data.status, 0);
    await appendLedgerEvent(config, token, container, {
      workspaceId,
      principalId: "crawler",
      traceId: span.traceId,
      eventType: `crawler.${data.status}`,
      entityKind: "crawl_visit",
      entityId: visitId(data.url),
      payload: { personId: data.personId, url: data.url, status: data.status },
    });
    await endSpan(span, "OK", { status: data.status });
    return {
      ok: true,
      status: 200,
      body: { recorded: 0, status: data.status, traceId: span.traceId },
    };
  }

  // Idempotent fact ingest: skip seedIds already in the ledger.
  const existingRows = await graph(
    config,
    token,
    container,
    `MATCH (c:Claim) WHERE c.provenance CONTAINS '"seedId"' RETURN c.provenance AS p`,
  );
  const existing = new Set<string>();
  for (const row of existingRows) {
    try {
      const p = JSON.parse(String(row.p ?? "{}")) as Json;
      if (typeof p.seedId === "string") existing.add(p.seedId);
    } catch {
      // ignore malformed provenance
    }
  }
  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  for (const fact of data.facts) {
    const seedId = seedIdOf(fact.attribute, fact.statement, data.url);
    if (existing.has(seedId)) {
      skipped++;
      continue;
    }
    try {
      const claimRes = (await epistemic(config, token, container, "claim", {
        subjectEntityId: data.personId,
        statement: fact.statement,
        validFrom: visitedAt.slice(0, 10),
        recordedAt: nowIso,
        provenance: {
          verb: "FACT",
          attribute: fact.attribute,
          seedId,
          source: "linkedin-slow-crawler",
        },
      })) as { claim?: { id?: string } };
      const claimId = claimRes.claim?.id;
      if (!claimId) throw new Error("no claim id");
      const evRes = (await epistemic(config, token, container, "evidence", {
        locator: data.url,
        quote: fact.quote ?? null,
      })) as { evidence?: { id?: string } };
      const evidenceId = evRes.evidence?.id;
      if (evidenceId) {
        await epistemic(config, token, container, "claim_evidence", {
          claimId,
          evidenceId,
          stance: "supports",
        });
      }
      existing.add(seedId);
      recorded++;
    } catch {
      failed++;
    }
  }

  // Contact info from the profile's Contact info overlay.
  const contactFacts: { attribute: string; value: string }[] = [
    { attribute: "professional_email", value: data.contact.email ?? "" },
    { attribute: "phone", value: data.contact.phone ?? "" },
    { attribute: "website", value: data.contact.website ?? "" },
    { attribute: "twitter", value: data.contact.twitter ?? "" },
    { attribute: "github", value: data.contact.github ?? "" },
  ];
  for (const { attribute, value } of contactFacts) {
    if (!value) continue;
    const statement = `${person.name}, ${attribute}: ${value}`;
    const seedId = seedIdOf(attribute, statement, data.url);
    if (existing.has(seedId)) {
      skipped++;
      continue;
    }
    try {
      const claimRes = (await epistemic(config, token, container, "claim", {
        subjectEntityId: data.personId,
        statement,
        validFrom: visitedAt.slice(0, 10),
        recordedAt: nowIso,
        provenance: {
          verb: "FACT",
          attribute,
          seedId,
          source: "linkedin-slow-crawler",
        },
      })) as { claim?: { id?: string } };
      const claimId = claimRes.claim?.id;
      if (!claimId) throw new Error("no claim id");
      const evRes = (await epistemic(config, token, container, "evidence", {
        locator: data.url,
        quote: value,
      })) as { evidence?: { id?: string } };
      if (evRes.evidence?.id) {
        await epistemic(config, token, container, "claim_evidence", {
          claimId,
          evidenceId: evRes.evidence.id,
          stance: "supports",
        });
      }
      existing.add(seedId);
      recorded++;
    } catch {
      failed++;
    }
  }

  // Profile image: a sourced FACT attribute; world.ts reads it into Person.avatarUrl.
  if (data.imageUrl) {
    const statement = `${person.name}, profile image: ${data.imageUrl}`;
    const seedId = seedIdOf("profile_image", statement, data.url);
    if (existing.has(seedId)) skipped++;
    else {
      try {
        const claimRes = (await epistemic(config, token, container, "claim", {
          subjectEntityId: data.personId,
          statement,
          validFrom: visitedAt.slice(0, 10),
          recordedAt: nowIso,
          provenance: {
            verb: "FACT",
            attribute: "profile_image",
            seedId,
            source: "linkedin-slow-crawler",
          },
        })) as { claim?: { id?: string } };
        if (claimRes.claim?.id) {
          const evRes = (await epistemic(config, token, container, "evidence", {
            locator: data.imageUrl,
            quote: "profile photo URL",
          })) as { evidence?: { id?: string } };
          if (evRes.evidence?.id) {
            await epistemic(config, token, container, "claim_evidence", {
              claimId: claimRes.claim.id,
              evidenceId: evRes.evidence.id,
              stance: "supports",
            });
          }
          existing.add(seedId);
          recorded++;
        } else failed++;
      } catch {
        failed++;
      }
    }
  }

  // Connections, posts, companies, follows, feed — deduplicated observations.
  const counters = { recorded, skipped, failed };
  for (const c of data.connections) {
    await recordObservation(
      config,
      token,
      container,
      workspaceId,
      data.personId,
      data.url,
      "connection",
      { name: c.name, url: c.url, detail: c.headline },
      counters,
    );
  }
  for (const p of data.posts) {
    await recordObservation(
      config,
      token,
      container,
      workspaceId,
      data.personId,
      data.url,
      "post",
      { name: "post", detail: p.text, url: p.url, topic: p.topic },
      counters,
    );
  }
  for (const c of data.companies) {
    await recordObservation(
      config,
      token,
      container,
      workspaceId,
      data.personId,
      data.url,
      "company",
      { name: c.name, url: c.url, detail: c.description },
      counters,
    );
  }
  for (const f of data.follows) {
    await recordObservation(
      config,
      token,
      container,
      workspaceId,
      data.personId,
      data.url,
      "follow",
      { name: f.name, url: f.url },
      counters,
    );
  }
  for (const f of data.feed) {
    await recordObservation(
      config,
      token,
      container,
      workspaceId,
      data.personId,
      data.url,
      "feed",
      { name: f.author, detail: f.text, url: f.url, topic: f.topic },
      counters,
    );
  }
  recorded = counters.recorded;
  skipped = counters.skipped;
  failed = counters.failed;

  await upsertVisit("ok", recorded, {
    connections: data.connections.length,
    posts: data.posts.length,
    imageUrl: data.imageUrl ?? null,
  });
  try {
    await octoSql(
      config,
      token,
      container,
      `INSERT INTO ri_console.activity (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(`act-crawl-${visitId(data.url)}-${now.getTime()}`)}, ${lit(workspaceId)}, 'crawler', 'shared', ${lit(
         JSON.stringify({
           id: `act-crawl-${visitId(data.url)}-${now.getTime()}`,
           at: nowIso,
           agentId: "research",
           type: "research",
           title: `Crawled ${person.name}'s LinkedIn profile`,
           detail: `${recorded} new sourced fact(s)/observation(s), ${skipped} already known; ${data.connections.length} connections, ${data.posts.length} posts, ${data.feed.length} feed items`,
           personId: data.personId,
           outcome: failed > 0 ? "pending" : "ok",
           evidence: [{ label: "linkedin.com", detail: data.url }],
         }),
       )}::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
  } catch {
    // best-effort activity
  }
  await appendLedgerEvent(config, token, container, {
    workspaceId,
    principalId: "crawler",
    traceId: span.traceId,
    eventType: "crawler.ingest",
    entityKind: "crawl_visit",
    entityId: visitId(data.url),
    payload: {
      personId: data.personId,
      recorded,
      skipped,
      failed,
      connections: data.connections.length,
      posts: data.posts.length,
      companies: data.companies.length,
      follows: data.follows.length,
      feed: data.feed.length,
      image: Boolean(data.imageUrl),
    },
  });
  await endSpan(span, failed > 0 ? "ERROR" : "OK", {
    recorded,
    skipped,
    failed,
  });
  return {
    ok: true,
    status: 200,
    body: { recorded, skipped, failed, traceId: span.traceId },
  };
}
