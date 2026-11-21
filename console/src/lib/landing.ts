/**
 * The first screen a signed-in visit lands on, pure so the contract is
 * testable (scripts/test-machines.mjs).
 *
 * The owner talks to their agent first, so an owner session opens on the
 * copilot chat; every other screen stays one click away in the sidebar. The
 * demo workspace keeps Today as its front page (#96). The console root and the
 * sign-in redirect both read this, so the two cannot disagree.
 */
import type { SessionMode } from "@/data/types";

export const landingPath = (mode: SessionMode | undefined): string =>
  mode === "owner" ? "/copilot" : "/today";
