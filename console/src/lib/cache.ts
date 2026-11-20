/**
 * Stale-while-revalidate cache for the console's adapter reads (RI-0010 A2).
 *
 * Within its TTL a read is served from cache without touching the network;
 * past the TTL the loader revalidates, and if the adapter is unreachable the
 * stale snapshot is served instead, labelled offline. Mutations invalidate by
 * key prefix so a write is never followed by a stale read.
 *
 * Trust & privacy: entries are keyed by (mode, workspaceId, principalId), so
 * one principal's snapshot is never served to another and guest demo data
 * never mixes with owner data. Only read payloads the console already renders
 * are stored — never tokens, cookies, or workspace keys. The sessionStorage
 * snapshot is origin-private, shape-checked on read, and cleared on sign-out.
 * Guest mode bypasses this cache entirely (the store decides that): the demo
 * promises decisions reset on reload, which a persisted snapshot would break.
 */
import type { SessionMode } from "@/data/types";

export type CacheKind = "world" | "sessions" | "messages";

export interface CacheScope {
  mode: SessionMode;
  workspaceId: string;
  principalId: string;
}

export interface CachedLoad<T> {
  data: T;
  /** True when the data is a stale snapshot kept because revalidation failed. */
  stale: boolean;
  /** True when the adapter could not be reached and the snapshot is offline. */
  offline: boolean;
}

const TTL_MS: Record<CacheKind, number> = {
  world: 60_000,
  sessions: 30_000,
  messages: 30_000,
};

const SNAPSHOT_KEY = "mission-control.cache.v1";

interface CacheEntry {
  data: unknown;
  storedAt: number;
}

const memory = new Map<string, CacheEntry>();
let snapshotLoaded = false;

/** Hydrate memory from the sessionStorage snapshot once per page load. */
const loadSnapshot = () => {
  if (snapshotLoaded) return;
  snapshotLoaded = true;
  try {
    const raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(parsed)) {
      // sessionStorage is same-origin but still untrusted input: only accept
      // well-formed entries, never arbitrary shapes.
      if (
        value &&
        typeof value === "object" &&
        typeof (value as CacheEntry).storedAt === "number" &&
        "data" in value
      ) {
        memory.set(key, value as CacheEntry);
      }
    }
  } catch {
    // Blocked or corrupt storage: memory-only caching for this visit.
  }
};

const persistSnapshot = () => {
  try {
    const out: Record<string, CacheEntry> = {};
    for (const [key, entry] of memory) out[key] = entry;
    window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(out));
  } catch {
    // Quota exceeded or storage blocked: drop the snapshot, keep memory.
    try {
      window.sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      // Nothing else to do; the cache still works in memory.
    }
  }
};

export const scopePrefix = (scope: CacheScope): string =>
  `${scope.mode}:${scope.workspaceId}:${scope.principalId}:`;

export const cacheKey = (
  scope: CacheScope,
  kind: CacheKind,
  resourceId = "",
): string => `${scopePrefix(scope)}${kind}:${resourceId}`;

/**
 * Auth failures must never be masked as "offline": an expired session has to
 * reach the store so it can offer Resume. octoSource signals 401 with these
 * fixed messages; match them until it throws a typed error instead.
 */
export const isAuthError = (error: unknown): boolean =>
  error instanceof Error && /session expired|answered 401/i.test(error.message);

/**
 * Load through the cache. Fresh entries return without a network call; stale
 * or missing entries revalidate via `loader`. A failed revalidation serves the
 * stale snapshot (stale + offline) when one exists; auth errors always
 * propagate so the session flow can react.
 */
export const cachedLoad = async <T>(
  scope: CacheScope,
  kind: CacheKind,
  resourceId: string,
  loader: () => Promise<T>,
): Promise<CachedLoad<T>> => {
  loadSnapshot();
  const key = cacheKey(scope, kind, resourceId);
  const entry = memory.get(key);
  if (entry && Date.now() - entry.storedAt < TTL_MS[kind]) {
    return { data: entry.data as T, stale: false, offline: false };
  }
  try {
    const data = await loader();
    memory.set(key, { data, storedAt: Date.now() });
    persistSnapshot();
    return { data, stale: false, offline: false };
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (entry) return { data: entry.data as T, stale: true, offline: true };
    throw error;
  }
};

/** Drop every entry whose key starts with `prefix` (e.g. one kind, one session). */
export const invalidate = (prefix: string) => {
  loadSnapshot();
  let changed = false;
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      changed = true;
    }
  }
  if (changed) persistSnapshot();
};

/** Sign-out: no principal's snapshot may outlive their session in this tab. */
export const clearCache = () => {
  memory.clear();
  snapshotLoaded = true;
  try {
    window.sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // Storage blocked: nothing was persisted anyway.
  }
};
