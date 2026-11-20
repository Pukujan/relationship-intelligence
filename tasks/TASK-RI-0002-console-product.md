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

### 2026-11-20 21:46:54 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["Production has no model: the copilot server is not deployed there and the vault working keys exist only in the owner's local console/.env. The owner has not yet said whether to deploy."],"changed":["none"],"completed":["The copilot could reach only three model providers through raw keys and its fallback order was fixed in code; pull request #63 adds Claude Haiku and Sonnet and OpenRouter's free models, reaches vendors through Octo's vault proxy with working keys, and makes both fallback chains reorderable from the environment. Earlier the same day pull request #60 made the Voice page use the browser's microphone and speech, and pull request #61 made installed agents appear on the Agents page; both are merged."],"decisions":["The free hy4flash-free model sits second in the everyday chain because it took 20 to 40 seconds on a full digest; the owner can put it first with COPILOT_CHAIN_ASK."],"evidence":["Each named model answered in live calls on a local server, a request for Opus was refused, a broken first route fell through to Haiku, and a full workspace digest was answered in about 7 seconds; the console's typecheck, contract tests, orphan check and build pass."],"evidence_class":"observed","next_action":"On the owner's go-ahead, run the copilot server in production with the vault working keys (issue #62), then build the shared assistant for chat, voice and call.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T21:46:54Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"6b2984154e89c3e6ee4863f05ace54de18d8bfed2a3c86ce25e80cc919e849db","request_id":"5a22f66d0371494d9ee4391999099893","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The copilot could reach only three model providers through raw keys and its fallback order was fixed in code; pull request #63 adds Claude Haiku and Sonnet and OpenRouter's free models, reaches vendors through Octo's vault proxy with working keys, and makes both fallback chains reorderable from the environment. Earlier the same day pull request #60 made the Voice page use the browser's microphone and speech, and pull request #61 made installed agents appear on the Agents page; both are merged.

Evidence:
- Each named model answered in live calls on a local server, a request for Opus was refused, a broken first route fell through to Haiku, and a full workspace digest was answered in about 7 seconds; the console's typecheck, contract tests, orphan check and build pass.

Decisions:
- The free hy4flash-free model sits second in the everyday chain because it took 20 to 40 seconds on a full digest; the owner can put it first with COPILOT_CHAIN_ASK.

Changed:
- none

Blocked/uncertain:
- Production has no model: the copilot server is not deployed there and the vault working keys exist only in the owner's local console/.env. The owner has not yet said whether to deploy.

Next:
- On the owner's go-ahead, run the copilot server in production with the vault working keys (issue #62), then build the shared assistant for chat, voice and call.

### 2026-11-20 21:59:31 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["The agent's SSH key is refused by octo-vps, so the vault working keys are not yet in the production env file; until the owner adds them the deployed copilot has no providers and the console keeps using its offline router."],"changed":["none"],"completed":["The live site had no model because the production image started only the app adapter; the image now also starts the copilot server on loopback and the adapter forwards /api requests to it only for a signed-in session."],"decisions":["The copilot server runs inside the same container as the adapter, restarted by the start script if it exits, so the existing deploy script and health check need no change."],"evidence":["Run side by side locally, the adapter answered 401 to /api requests with no session and, with a sealed test session, listed five providers, returned a Claude Haiku answer and passed a streamed answer through; the app's 40 tests, typecheck, lint and build pass. The Docker image itself was not built locally because this machine has no Docker."],"evidence_class":"observed","next_action":"The owner appends the provider keys to the production env file on octo-vps and recreates the container; then check that /api/models lists providers for a signed-in session on the live site.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T21:59:31Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"f3aeebaa26b8d8e610dfe6eb71b05f293d37562980ef8f99386138be7fe77e3a","request_id":"9042adf434a9477bab775fead95e43d9","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The live site had no model because the production image started only the app adapter; the image now also starts the copilot server on loopback and the adapter forwards /api requests to it only for a signed-in session.

Evidence:
- Run side by side locally, the adapter answered 401 to /api requests with no session and, with a sealed test session, listed five providers, returned a Claude Haiku answer and passed a streamed answer through; the app's 40 tests, typecheck, lint and build pass. The Docker image itself was not built locally because this machine has no Docker.

Decisions:
- The copilot server runs inside the same container as the adapter, restarted by the start script if it exits, so the existing deploy script and health check need no change.

Changed:
- none

Blocked/uncertain:
- The agent's SSH key is refused by octo-vps, so the vault working keys are not yet in the production env file; until the owner adds them the deployed copilot has no providers and the console keeps using its offline router.

Next:
- The owner appends the provider keys to the production env file on octo-vps and recreates the container; then check that /api/models lists providers for a signed-in session on the live site.

### 2026-11-20 22:35:45 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["The fix is not deployed yet, so on the live site an account with no workspace can still reach the copilot until this merges. The test emulates first sign-in with SQL, so creating a first workspace and activating an invite through Google are not covered."],"changed":["none"],"completed":["The owner asked whether several accounts can share one workspace; a new hold-out test with five test accounts found that an account in no workspace could reach the copilot, that conversations and notes failed in every workspace but the first, and that every POST on the profile and schedule routes hung. All three are fixed on this branch."],"decisions":["A workspace membership check on the copilot is trusted for 60 seconds, so a spoken turn does not wait on Octo every time; a removed member can still call the copilot for up to a minute but loses workspace data at once."],"evidence":["scripts/validate_sharing.py passes 12 of 12 checks against a local adapter after the fixes (8 of 11 before), and a count of test rows left behind returned 0; the app's 41 tests, typecheck, lint and build pass."],"evidence_class":"observed","next_action":"Merge the fix (issue #66) and confirm on the server that the new image is running; then return to routing Talk and the call through the live model.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T22:35:45Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"60593d6c1be403f627f67b58b57acb81032aed3990349c31ddad54677092aad5","request_id":"d8e3d9f2610f4fbfb742309583960ac1","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The owner asked whether several accounts can share one workspace; a new hold-out test with five test accounts found that an account in no workspace could reach the copilot, that conversations and notes failed in every workspace but the first, and that every POST on the profile and schedule routes hung. All three are fixed on this branch.

Evidence:
- scripts/validate_sharing.py passes 12 of 12 checks against a local adapter after the fixes (8 of 11 before), and a count of test rows left behind returned 0; the app's 41 tests, typecheck, lint and build pass.

Decisions:
- A workspace membership check on the copilot is trusted for 60 seconds, so a spoken turn does not wait on Octo every time; a removed member can still call the copilot for up to a minute but loses workspace data at once.

Changed:
- none

Blocked/uncertain:
- The fix is not deployed yet, so on the live site an account with no workspace can still reach the copilot until this merges. The test emulates first sign-in with SQL, so creating a first workspace and activating an invite through Google are not covered.

Next:
- Merge the fix (issue #66) and confirm on the server that the new image is running; then return to routing Talk and the call through the live model.

### 2026-11-20 22:42:59 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["Not deployed yet: until this merges, a stranger with a guest token can still call the copilot on the live site."],"changed":["none"],"completed":["After the first copilot gate fix deployed, a guest minted from Octo still got a model answer on the live site, because Octo gives every guest a personal workspace; the gate now requires a token session to belong to this app's own Octo container."],"decisions":["no new decisions"],"evidence":["scripts/validate_sharing.py passes 13 of 13 locally, including a new check that mints a real Octo guest and gets 403 from the copilot routes, and the owner's key session still gets 200; the app's 42 tests, typecheck, lint and build pass."],"evidence_class":"observed","next_action":"After the deploy, repeat the live guest check against business.design-bakery.com and expect 403; then return to routing Talk and the call through the live model.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T22:42:59Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"fc76a47f72e33b24935b14da27f5f60abd7ab876c551d5b7a68a8987e20dc40e","request_id":"9e467d65296f40d6a246fbc81683f2ab","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- After the first copilot gate fix deployed, a guest minted from Octo still got a model answer on the live site, because Octo gives every guest a personal workspace; the gate now requires a token session to belong to this app's own Octo container.

Evidence:
- scripts/validate_sharing.py passes 13 of 13 locally, including a new check that mints a real Octo guest and gets 403 from the copilot routes, and the owner's key session still gets 200; the app's 42 tests, typecheck, lint and build pass.

Decisions:
- no new decisions

Changed:
- none

Blocked/uncertain:
- Not deployed yet: until this merges, a stranger with a guest token can still call the copilot on the live site.

Next:
- After the deploy, repeat the live guest check against business.design-bakery.com and expect 403; then return to routing Talk and the call through the live model.

## Handoff

Read PROJECT → CURRENT → this task → minimum relevant spec. Checkpoint before stopping.
