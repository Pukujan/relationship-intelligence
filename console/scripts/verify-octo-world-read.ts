/**
 * Read-only proof of the owner-mode world assembly against live Octo.
 *
 * Runs the exact readWorld() the adapter uses, with the workspace key as the
 * bearer (read-only here). The per-principal write path is verified separately
 * by verify-owner-flow.mjs once a human completes Google sign-in.
 *
 *   cd app && pnpm exec tsx ../console/scripts/verify-octo-world-read.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorld } from "../../app/server/world.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "../../.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const config = { baseUrl: env.OCTO_API_URL, timeoutMs: 20_000 };
const ws = env.OCTO_WORKSPACE_ID;

const world = await readWorld(
  config,
  env.OCTO_API_KEY,
  ws,
  { id: "read-proof", displayName: "Read proof" },
  [{ id: ws, name: "social-engineering" }],
);

console.log("people:", world.people.map((p) => `${p.name} (${p.role || "—"} @ ${p.companyId ? "org" : "—"}, strength ${p.strength}, ${p.warmth}, claims ${p.claims.length})`));
console.log("companies:", world.companies.map((c) => c.name));
console.log("sourced vs unverified claims:", world.people.flatMap((p) => p.claims).reduce((acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; }, {} as Record<string, number>));
console.log("agents:", world.agents.map((a) => a.name));
console.log("connectors:", world.connectors.length, "| plugins:", world.plugins.length, "| smartLists:", world.smartLists.length);
console.log("work (should be empty until approved):", { projects: world.projects.length, milestones: world.milestones.length, approvals: world.approvals.length });
console.log("events (none in ledger yet):", world.events.length);
if (!world.people.some((p) => p.name === "Jane Doe")) {
  console.error("FAIL: canonical ledger people missing");
  process.exit(1);
}
if (world.people.some((p) => p.name === "Dana Whitfield")) {
  console.error("FAIL: demo seed leaked into owner world");
  process.exit(1);
}
console.log("READ PROOF OK");
