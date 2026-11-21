/**
 * The /copilot thread-entry decision, pure so the contract is testable
 * (scripts/test-machines.mjs).
 *
 * A seeded arrival — quick-ask, "Draft follow-up", "Research this" — always
 * opens a fresh draft thread with the seed's scope pinned. Only an unseeded
 * arrival resumes the newest open thread. Keeping the decision here is what
 * stops a seeded draft from landing in whatever thread was active last.
 */
export type ThreadScope = { kind: string; id: string | null };
export type ThreadNavState = { seed?: string; scope?: ThreadScope } | null;
export type ThreadEntry = { seed: string; draft: boolean; activeId: string | null; scope: ThreadScope };

export const WORKSPACE_SCOPE: ThreadScope = { kind: "workspace", id: null };

export const resolveThreadEntry = (nav: ThreadNavState, openSessionIds: readonly string[]): ThreadEntry => {
  const seed = nav?.seed ?? "";
  const scope = nav?.scope ?? WORKSPACE_SCOPE;
  if (seed.trim()) return { seed, draft: true, activeId: null, scope };
  return { seed: "", draft: false, activeId: openSessionIds[0] ?? null, scope };
};
