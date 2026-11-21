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
    facts_count INTEGER NOT NULL DEFAULT 0
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
    .max(10)
    .default([]),
});

/** Only public /in/ profile URLs on linkedin.com itself — never lookalikes. */
export const isProfileUrl = (url: string): boolean =>
  /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%\u00A0-\uFFFF]+\/?(\?.*)?$/u.test(
    url,
  );

const normUrl = (url: string): string =>
  url.split("?")[0]?.replace(/\/+$/, "").toLowerCase() ?? "";

const visitId = (url: string): string =>
  createHash("sha256").update(normUrl(url)).digest("hex").slice(0, 24);

const seedIdOf = (attribute: string, statement: string, url: string): string =>
  createHash("sha256")
    .update(`FACT\x00${statement}\x00${attribute}\x00${normUrl(url)}`)
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

const graph = async (
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

const epistemic = async (
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

interface PersonUrl {
  personId: string;
  name: string;
  url: string;
}

/** People with a sourced linkedin_url FACT, minus retired sample people. */
async function linkedinPeople(
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
  const upsertVisit = (status: string, factsCount: number) =>
    octoSql(
      config,
      token,
      container,
      `INSERT INTO ri_console.crawl_visit (id, workspace_id, person_id, url, status, visited_at, facts_count)
       VALUES (${lit(visitId(data.url))}, ${lit(workspaceId)}, ${lit(data.personId)}, ${lit(data.url)}, ${lit(status)}, ${lit(visitedAt)}, ${factsCount})
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, visited_at = EXCLUDED.visited_at, facts_count = EXCLUDED.facts_count`,
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
  await upsertVisit("ok", recorded);
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
           detail: `${recorded} new sourced fact(s), ${skipped} already known`,
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
    payload: { personId: data.personId, recorded, skipped, failed },
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
