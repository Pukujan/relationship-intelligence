# TASK-RI-0002 — Console Product

<!-- continuity:task {"acceptance":["replace this with observable, task-specific acceptance checks"],"depends_on":[],"goal":"Define and build the console product surface: grouped workspace, work hierarchy, and the human-in-control agent intelligence layer","id":"RI-0002","issue_url":"https://github.com/Pukujan/relationship-intelligence/issues/18","next_action":"define scope and observable acceptance checks, then begin bounded work","owner":"dsh-lead","priority":"3","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"The owner directed a console where agents help figure out and do relationship work with the human always in control, no silent stalls, and legible signals"} -->

- Status: active
- Owner: dsh-lead
- Priority: 3
- Depends on: none

## Goal

Define and build the console product surface: grouped workspace, work hierarchy, and the human-in-control agent intelligence layer

## Why

The owner directed a console where agents help figure out and do relationship work with the human always in control, no silent stalls, and legible signals

## Allowed files

- define bounded paths before implementation.

## Human outcome

Describe what becomes easier, safer, clearer, or possible when this task is complete.

## Scope and boundaries

- In scope:
- Out of scope:
- Dependencies/uncertainty:

## Acceptance criteria

- [ ] state observable, task-specific outcomes.

## Evidence and sources

Link repository state at a revision and cite external factual claims directly. Record commands and results for claims that need verification.

## Reproduction details (only when needed)

Starting revision, material inputs/configuration, runtime, exact command or prompt, observed result, and limitations.

## Related records

- Required leaf owning issue, parent ancestry and dependencies (or explicitly none):
- Primary writer / branch / source issue revision / as-of status:
- Related PR/CI evidence and push receipt (request ID / SHA):

## Checkpoint log

No checkpoints yet.

### 2026-11-19 07:58:24 UTC — dsh-lead

<!-- continuity:checkpoint {"agent":"dsh-lead","blocked":["New MacBook (pujans-macbook-air) has Remote Login off, so DSH model setup there is pending. The console copilot is still a seeded simulation; the intelligence layer is not built."],"changed":["docs/CONSOLE.md, PROJECT.md, docs/issues/RI-009.md, docs/ISSUES.md, console/ prototype, console-preview/ screenshots, HANDOFF.md, checkpoints/CURRENT.md."],"completed":["Defined the console product (goal, trust-layer operating model, UX map) in docs/CONSOLE.md and PROJECT.md, filed as issue #18. Built the ABA console prototype in console/ through a restructure pass (grouped nav, Project-Objective-Mission-Plan hierarchy, sign-in/guest, connectors/MCP/plugins); its build gate passed and it builds locally. Proved local collection execution (#15) and fixed the app build script (#14)."],"decisions":["Personal-first console with organization as the tenancy boundary; people stay a single graph that work references; agents propose and the human decides; deadlines/iteration surface stalls as signals."],"evidence":["Restructure run ri-console-002 status passed; console/ pnpm build succeeds; OIO/planning/continuity validators VALID; PRs #13, #16, #17, #19 merged to main."],"next_action":"Build the intelligence layer (real orchestrator + research/design mode held for approval + deadline/iteration loop + signal layer), then wire the data layer to Octo and integrate the console into app/ behind Octo sign-in.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-19T07:58:24Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"c5674ce1aa0f026273080acf9d080accc1d222ee1df41f00cd599f4208382d29","request_id":"6f90589671074c50ae8ceeeed0a28f88","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- Defined the console product (goal, trust-layer operating model, UX map) in docs/CONSOLE.md and PROJECT.md, filed as issue #18. Built the ABA console prototype in console/ through a restructure pass (grouped nav, Project-Objective-Mission-Plan hierarchy, sign-in/guest, connectors/MCP/plugins); its build gate passed and it builds locally. Proved local collection execution (#15) and fixed the app build script (#14).

Evidence:
- Restructure run ri-console-002 status passed; console/ pnpm build succeeds; OIO/planning/continuity validators VALID; PRs #13, #16, #17, #19 merged to main.

Decisions:
- Personal-first console with organization as the tenancy boundary; people stay a single graph that work references; agents propose and the human decides; deadlines/iteration surface stalls as signals.

Changed:
- docs/CONSOLE.md, PROJECT.md, docs/issues/RI-009.md, docs/ISSUES.md, console/ prototype, console-preview/ screenshots, HANDOFF.md, checkpoints/CURRENT.md.

Blocked/uncertain:
- New MacBook (pujans-macbook-air) has Remote Login off, so DSH model setup there is pending. The console copilot is still a seeded simulation; the intelligence layer is not built.

Next:
- Build the intelligence layer (real orchestrator + research/design mode held for approval + deadline/iteration loop + signal layer), then wire the data layer to Octo and integrate the console into app/ behind Octo sign-in.

## Handoff

Read PROJECT → CURRENT → this task → minimum relevant spec. Checkpoint before stopping.
