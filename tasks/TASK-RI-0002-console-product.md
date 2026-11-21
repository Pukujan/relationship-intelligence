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

### 2026-11-20 22:51:32 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["A real microphone and real audio are still untested, because the test browser has neither. Interrupting the copilot by voice while it speaks is not built."],"changed":["none"],"completed":["The Voice page could hear and speak but not hold a conversation; Talk now answers from the live model and reopens the microphone for follow-ups, a call answers questions about the approval being read, and a loosely worded decision is read back and recorded only on a clear yes."],"decisions":["The model's reply carries an intent that can only trigger a read-back; the write still needs the person's own word through the strict parser. The voice chain leads with Claude Haiku because it answered in about 3.5 seconds against 7 to 14 for Qwen flash."],"evidence":["With a stub recogniser on a local build, Talk answered two linked questions from Claude Haiku and stopped on 'thanks'; on a call the top 3 of 13 approvals were read, a question was answered without advancing, a loose approval was read back and recorded on 'yes', and a second was dropped on 'no'. The console's typecheck, contract tests, orphan check and build pass."],"evidence_class":"observed","next_action":"After the deploy, the owner tries Talk in Chrome on the live site, signed in; then decide between importing the owner's relationship data and the pre-meeting brief.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T22:51:32Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"2b5d20a08a6af96608e9693510e266b74fd3d93c1e28b8e2688aa3937108b8e8","request_id":"dd906e6c718b435e8e6596a79d66a636","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The Voice page could hear and speak but not hold a conversation; Talk now answers from the live model and reopens the microphone for follow-ups, a call answers questions about the approval being read, and a loosely worded decision is read back and recorded only on a clear yes.

Evidence:
- With a stub recogniser on a local build, Talk answered two linked questions from Claude Haiku and stopped on 'thanks'; on a call the top 3 of 13 approvals were read, a question was answered without advancing, a loose approval was read back and recorded on 'yes', and a second was dropped on 'no'. The console's typecheck, contract tests, orphan check and build pass.

Decisions:
- The model's reply carries an intent that can only trigger a read-back; the write still needs the person's own word through the strict parser. The voice chain leads with Claude Haiku because it answered in about 3.5 seconds against 7 to 14 for Qwen flash.

Changed:
- none

Blocked/uncertain:
- A real microphone and real audio are still untested, because the test browser has neither. Interrupting the copilot by voice while it speaks is not built.

Next:
- After the deploy, the owner tries Talk in Chrome on the live site, signed in; then decide between importing the owner's relationship data and the pre-meeting brief.

### 2026-11-20 23:07:31 UTC — agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85

<!-- continuity:checkpoint {"agent":"agent:claude-code/5e6d2003-52c8-41a6-a97b-968f704e6c85","blocked":["People and facts are shared by the whole installation, so nobody should be invited until per-workspace privacy for people exists. The 43 imported events are in the ledger but the app does not read events from it yet. The retirement rule in the app is not deployed until this merges."],"changed":["none"],"completed":["The app answered from three sample people; the owner's real relationship records are now in its ledger (23 people, 4 organisations, 43 events, 141 claims) and the sample records are retired."],"decisions":["By the owner's choice on 2026-11-20: only events tied to the owner, everything about people including private notes as unverified, import before per-workspace privacy exists, and retire the samples. A statement is sourced only with a URL the source documented."],"evidence":["The loader's dry run validated the converted seed and --apply reported 141 new claims; a second plan check found all 141 already present, so a re-run writes nothing; read through a local adapter, the app's world lists 24 people and 4 companies with none of the samples, 37 claims sourced and 104 unverified. The app's 47 tests, typecheck, lint and build pass."],"evidence_class":"observed","next_action":"Merge and deploy, then the owner checks the People page on the live site; file per-workspace privacy for people as its own issue.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-20T23:07:31Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"3ce030ba3366c4a6cc46fee2e29e02ae50da4250999596d64cfb96a5fb056683","request_id":"3708d4b6a9864a63824715bd2c7b174d","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The app answered from three sample people; the owner's real relationship records are now in its ledger (23 people, 4 organisations, 43 events, 141 claims) and the sample records are retired.

Evidence:
- The loader's dry run validated the converted seed and --apply reported 141 new claims; a second plan check found all 141 already present, so a re-run writes nothing; read through a local adapter, the app's world lists 24 people and 4 companies with none of the samples, 37 claims sourced and 104 unverified. The app's 47 tests, typecheck, lint and build pass.

Decisions:
- By the owner's choice on 2026-11-20: only events tied to the owner, everything about people including private notes as unverified, import before per-workspace privacy exists, and retire the samples. A statement is sourced only with a URL the source documented.

Changed:
- none

Blocked/uncertain:
- People and facts are shared by the whole installation, so nobody should be invited until per-workspace privacy for people exists. The 43 imported events are in the ledger but the app does not read events from it yet. The retirement rule in the app is not deployed until this merges.

Next:
- Merge and deploy, then the owner checks the People page on the live site; file per-workspace privacy for people as its own issue.

### 2026-11-21 01:42:08 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["console/src/pages/PersonProfile.tsx, console/src/lib/profileSections.ts (new), app/server/world.ts and app/shared/contracts.ts pass claim verb, attribute and basis through"],"completed":["Contact pages read like a LinkedIn profile (#93): banner, avatar, headline and LinkedIn link, then About, Activity, Experience, Education, an event log, the owner's notes and sources. Only sourced claims feed the profile sections; unverified notes stay flagged as notes."],"decisions":["no new decisions"],"evidence":["All 24 live contacts render every core section with an event log and no unverified note inside a profile section, checked in a local browser against the real ledger read through this branch's world read. Phone width has no sideways scroll. Console typecheck, lint (0 errors), machine tests (7 new profile tests), orphan check and build pass; app types, biome, 71 Vitest tests and build pass."],"evidence_class":"observed","next_action":"Open the pull request for #93 and let CI run; after merge, check a contact page on the deployed console.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T01:42:08Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"fe817bb03a00184344f474168ad63091be8f95884a808c36a3947d11534006bb","request_id":"3d4700b9737649eb9b89214ca1390d60","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- Contact pages read like a LinkedIn profile (#93): banner, avatar, headline and LinkedIn link, then About, Activity, Experience, Education, an event log, the owner's notes and sources. Only sourced claims feed the profile sections; unverified notes stay flagged as notes.

Evidence:
- All 24 live contacts render every core section with an event log and no unverified note inside a profile section, checked in a local browser against the real ledger read through this branch's world read. Phone width has no sideways scroll. Console typecheck, lint (0 errors), machine tests (7 new profile tests), orphan check and build pass; app types, biome, 71 Vitest tests and build pass.

Decisions:
- no new decisions

Changed:
- console/src/pages/PersonProfile.tsx, console/src/lib/profileSections.ts (new), app/server/world.ts and app/shared/contracts.ts pass claim verb, attribute and basis through

Blocked/uncertain:
- none

Next:
- Open the pull request for #93 and let CI run; after merge, check a contact page on the deployed console.

### 2026-11-21 02:01:59 UTC — agent:claude-code/0c5c33f5-0cd5-4a9f-8fb4-b82c04581d93

<!-- continuity:checkpoint {"agent":"agent:claude-code/0c5c33f5-0cd5-4a9f-8fb4-b82c04581d93","blocked":[],"changed":["console/src/lib/landing.ts (new) picks the first screen; console/src/App.tsx root route and console/src/pages/SignIn.tsx redirect both use it; console/scripts/test-machines.mjs pins both answers"],"completed":["The console opens on the copilot chat after the owner signs in (#96). A signed-in owner who opens the console root or comes back from sign-in lands on /copilot; Today keeps its address and sidebar place, and the demo workspace still opens on Today."],"decisions":["Guests keep Today as their front page, as the brief allowed; only owner sessions land on the chat."],"evidence":["In a local Chromium with the adapter's session answer stubbed as a signed-in owner, /console/ and /console/signin both land on /console/copilot with the chat composer showing, and the sidebar opens Today, Approvals, People, Voice and Copilot with no page errors. Guest sign-in in the browser pane still lands on /console/today. Console typecheck, lint (0 errors), machine tests (2 new landing tests), orphan check and build pass. A real Google sign-in was not run: it needs the owner's own consent."],"next_action":"Open the pull request for #96 and let CI run; after merge, the owner signs in on the deployed console and should land on the chat.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T02:01:59Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"6bcfee51b4ba3ef4b560bf636376bdfba10163bdf597202f073794a199ebb741","request_id":"efd2900efbd7446e9e371cbf34da4faa","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The console opens on the copilot chat after the owner signs in (#96). A signed-in owner who opens the console root or comes back from sign-in lands on /copilot; Today keeps its address and sidebar place, and the demo workspace still opens on Today.

Evidence:
- In a local Chromium with the adapter's session answer stubbed as a signed-in owner, /console/ and /console/signin both land on /console/copilot with the chat composer showing, and the sidebar opens Today, Approvals, People, Voice and Copilot with no page errors. Guest sign-in in the browser pane still lands on /console/today. Console typecheck, lint (0 errors), machine tests (2 new landing tests), orphan check and build pass. A real Google sign-in was not run: it needs the owner's own consent.

Decisions:
- Guests keep Today as their front page, as the brief allowed; only owner sessions land on the chat.

Changed:
- console/src/lib/landing.ts (new) picks the first screen; console/src/App.tsx root route and console/src/pages/SignIn.tsx redirect both use it; console/scripts/test-machines.mjs pins both answers

Blocked/uncertain:
- none

Next:
- Open the pull request for #96 and let CI run; after merge, the owner signs in on the deployed console and should land on the chat.

### 2026-11-21 02:21:15 UTC — agent:claude-code/b8230d8e-5287-4bb1-afbc-6196712a0498

<!-- continuity:checkpoint {"agent":"agent:claude-code/b8230d8e-5287-4bb1-afbc-6196712a0498","blocked":["Whether to pause the owner's four agents is decision 1 in #98 and stays with the owner. Pause was not exercised against production."],"changed":["app/server/agentShape.ts adds isAgentPaused and agentStatusPatch; app/server/adapter.ts writes the pause flag and refuses unknown statuses; app/server/executor.ts checks pause at queue, start and save and merges its own fields; console run outcomes gain skipped (types, derive, AgentDetail); tests in app/tests/executor.test.ts, executorMetamorphic.test.ts and executorHarness.ts"],"completed":["Pause in the console now stops the agent runner (#101). Pause writes paused: true with the paused status and Resume clears both; one check, isAgentPaused, counts either field, so rows paused the old way stay paused. The runner checks it when it queues a run, before it calls the model and before it saves what the model returned, and a skipped run leaves a receipt that says the agent was paused."],"decisions":["paused: true is the stored record of a pause because status is also the runner's live state, which is how a run erased a pause. The runner merges only its own fields into an agent row and no longer creates a row for an agent that has none. Scheduled research runs as Atlas, so it is skipped while Atlas is paused; pausing the schedule still stops it for good."],"evidence":["Twelve new executor tests cover both pause shapes: never queued, a run queued before the pause is closed without a model call, a pause during the model call saves nothing, a pause landing at the final write or while runs are queued survives, a full tick runs only the unpaused agent, and scheduled research is skipped while Atlas is paused. A new metamorphic property (MR-E6) checks over random agents and answers that both shapes give the same empty result. Undoing each check in turn makes its tests fail. App types, lint, 116 tests and build pass; console typecheck, lint (0 errors), machine tests, orphan check and build pass; planning and continuity validation pass. Checked against the mock Octo only: no production agent row was read or changed."],"next_action":"Open the pull request for #101 and let CI run; after it deploys, Pause on the Agents page should hold through the runner's next tick.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T02:21:15Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"d58f52177c94841f19d146741922610a0449c9d79dec544c22e02fa9094bd44a","request_id":"d92082dc27ab41a58a51cfefb7601438","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- Pause in the console now stops the agent runner (#101). Pause writes paused: true with the paused status and Resume clears both; one check, isAgentPaused, counts either field, so rows paused the old way stay paused. The runner checks it when it queues a run, before it calls the model and before it saves what the model returned, and a skipped run leaves a receipt that says the agent was paused.

Evidence:
- Twelve new executor tests cover both pause shapes: never queued, a run queued before the pause is closed without a model call, a pause during the model call saves nothing, a pause landing at the final write or while runs are queued survives, a full tick runs only the unpaused agent, and scheduled research is skipped while Atlas is paused. A new metamorphic property (MR-E6) checks over random agents and answers that both shapes give the same empty result. Undoing each check in turn makes its tests fail. App types, lint, 116 tests and build pass; console typecheck, lint (0 errors), machine tests, orphan check and build pass; planning and continuity validation pass. Checked against the mock Octo only: no production agent row was read or changed.

Decisions:
- paused: true is the stored record of a pause because status is also the runner's live state, which is how a run erased a pause. The runner merges only its own fields into an agent row and no longer creates a row for an agent that has none. Scheduled research runs as Atlas, so it is skipped while Atlas is paused; pausing the schedule still stops it for good.

Changed:
- app/server/agentShape.ts adds isAgentPaused and agentStatusPatch; app/server/adapter.ts writes the pause flag and refuses unknown statuses; app/server/executor.ts checks pause at queue, start and save and merges its own fields; console run outcomes gain skipped (types, derive, AgentDetail); tests in app/tests/executor.test.ts, executorMetamorphic.test.ts and executorHarness.ts

Blocked/uncertain:
- Whether to pause the owner's four agents is decision 1 in #98 and stays with the owner. Pause was not exercised against production.

Next:
- Open the pull request for #101 and let CI run; after it deploys, Pause on the Agents page should hold through the runner's next tick.

### 2026-11-21 02:22:42 UTC — agent:claude-code/b8230d8e-5287-4bb1-afbc-6196712a0498

<!-- continuity:checkpoint {"agent":"agent:claude-code/b8230d8e-5287-4bb1-afbc-6196712a0498","blocked":["Whether to pause the owner's four agents is decision 1 in #98 and stays with the owner. Pause was not exercised against production."],"changed":["app/server/agentShape.ts adds isAgentPaused and agentStatusPatch; app/server/adapter.ts writes the pause flag and refuses unknown statuses; app/server/executor.ts checks pause at queue, start and save and merges its own fields; console run outcomes gain skipped (types, derive, AgentDetail); tests in app/tests/executor.test.ts, executorMetamorphic.test.ts and executorHarness.ts"],"completed":["Pause in the console now stops the agent runner (#101), and pull request 102 is open for it. Pause writes paused: true with the paused status and Resume clears both; one check, isAgentPaused, counts either field, so rows paused the old way stay paused. The runner checks it when it queues a run, before it calls the model and before it saves what the model returned, and a skipped run leaves a receipt that says the agent was paused."],"decisions":["paused: true is the stored record of a pause because status is also the runner's live state, which is how a run erased a pause. The runner merges only its own fields into an agent row and no longer creates a row for an agent that has none. Scheduled research runs as Atlas, so it is skipped while Atlas is paused; pausing the schedule still stops it for good."],"evidence":["A paused agent never runs: nineteen new test cases in app/tests/executor.test.ts cover both pause shapes, from queueing through a full runner tick, against the mock Octo database. A new metamorphic property (MR-E6) finds both shapes give zero runs and zero writes over random agents and answers. Undoing each part of the fix makes its tests fail (queue check 3, check before the model 5, check after it 2, old whole-row write at finish 4). App types, lint, 116 tests and build pass; console typecheck, lint (0 errors), machine tests, orphan check and build pass; planning and continuity validation pass. This corrects the earlier checkpoint, which miscounted the new tests as twelve. No production agent row was read or changed."],"next_action":"Pull request 102 merges itself once CI is green; after it deploys, Pause on the Agents page should hold through the runner's next tick.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","supersedes":"d92082dc27ab41a58a51cfefb7601438","task_id":"RI-0002","timestamp":"2026-11-21T02:22:42Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"a4a087a6081bd0bd5ac02f04ea21ad9fd2c2c18c819c72544a8d58de065a9051","request_id":"75dcfd5e96214bed86741124182a8514","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- Pause in the console now stops the agent runner (#101), and pull request 102 is open for it. Pause writes paused: true with the paused status and Resume clears both; one check, isAgentPaused, counts either field, so rows paused the old way stay paused. The runner checks it when it queues a run, before it calls the model and before it saves what the model returned, and a skipped run leaves a receipt that says the agent was paused.

Evidence:
- A paused agent never runs: nineteen new test cases in app/tests/executor.test.ts cover both pause shapes, from queueing through a full runner tick, against the mock Octo database. A new metamorphic property (MR-E6) finds both shapes give zero runs and zero writes over random agents and answers. Undoing each part of the fix makes its tests fail (queue check 3, check before the model 5, check after it 2, old whole-row write at finish 4). App types, lint, 116 tests and build pass; console typecheck, lint (0 errors), machine tests, orphan check and build pass; planning and continuity validation pass. This corrects the earlier checkpoint, which miscounted the new tests as twelve. No production agent row was read or changed.

Decisions:
- paused: true is the stored record of a pause because status is also the runner's live state, which is how a run erased a pause. The runner merges only its own fields into an agent row and no longer creates a row for an agent that has none. Scheduled research runs as Atlas, so it is skipped while Atlas is paused; pausing the schedule still stops it for good.

Changed:
- app/server/agentShape.ts adds isAgentPaused and agentStatusPatch; app/server/adapter.ts writes the pause flag and refuses unknown statuses; app/server/executor.ts checks pause at queue, start and save and merges its own fields; console run outcomes gain skipped (types, derive, AgentDetail); tests in app/tests/executor.test.ts, executorMetamorphic.test.ts and executorHarness.ts

Blocked/uncertain:
- Whether to pause the owner's four agents is decision 1 in #98 and stays with the owner. Pause was not exercised against production.

Next:
- Pull request 102 merges itself once CI is green; after it deploys, Pause on the Agents page should hold through the runner's next tick.

### 2026-11-21 15:34:16 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["Merge of main into feat/ri-0021-connectors-real; app/shared/contracts.ts keeps only workflow and API-service types; lint and type fixes in app/server/workflows.ts and app/server/apiServices.ts"],"completed":["The visual workflow canvas branch (draft PR #107) was 19 commits behind main and conflicted with the connector work merged in #110. It now merges main, imports connector types from the merged contract, and passes every local gate."],"decisions":["no new decisions"],"evidence":["App types, biome, 178 Vitest tests and build pass; console typecheck, eslint (no errors), machine tests, orphan check and build pass. The Workflows page renders in a local browser on the merged branch."],"evidence_class":"observed","next_action":"Mark PR #107 ready, let CI run, and merge it with auto-merge.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T15:34:16Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"5959907ed6846ab9552da1f53d35db759c8258a5d5bffac4c7e309efecb731d4","request_id":"7c2514dae36848449484009d8b9e5100","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The visual workflow canvas branch (draft PR #107) was 19 commits behind main and conflicted with the connector work merged in #110. It now merges main, imports connector types from the merged contract, and passes every local gate.

Evidence:
- App types, biome, 178 Vitest tests and build pass; console typecheck, eslint (no errors), machine tests, orphan check and build pass. The Workflows page renders in a local browser on the merged branch.

Decisions:
- no new decisions

Changed:
- Merge of main into feat/ri-0021-connectors-real; app/shared/contracts.ts keeps only workflow and API-service types; lint and type fixes in app/server/workflows.ts and app/server/apiServices.ts

Blocked/uncertain:
- none

Next:
- Mark PR #107 ready, let CI run, and merge it with auto-merge.

### 2026-11-21 15:38:07 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["app/shared/workflowContracts.ts (new), app/shared/contracts.ts re-exports it, three console files import from it"],"completed":["The canvas PR's console CI job failed because the console imported workflow types from a file that needs zod, which that job doesn't install. The types now sit in a dependency-free file like the connector types."],"decisions":["no new decisions"],"evidence":["Reproduced CI by hiding the app's packages: console typecheck, eslint, machine tests, orphan check and build pass; app types, biome and 178 Vitest tests pass."],"evidence_class":"observed","next_action":"Wait for PR #107's checks; auto-merge is on.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T15:38:07Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"18311be5db6a014ec08019729eef84e3936f512d508179f71c2b5b2a43e3c238","request_id":"d6c92548ea5f49dba4e3c0a0bcf425ff","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The canvas PR's console CI job failed because the console imported workflow types from a file that needs zod, which that job doesn't install. The types now sit in a dependency-free file like the connector types.

Evidence:
- Reproduced CI by hiding the app's packages: console typecheck, eslint, machine tests, orphan check and build pass; app types, biome and 178 Vitest tests pass.

Decisions:
- no new decisions

Changed:
- app/shared/workflowContracts.ts (new), app/shared/contracts.ts re-exports it, three console files import from it

Blocked/uncertain:
- none

Next:
- Wait for PR #107's checks; auto-merge is on.

### 2026-11-21 18:17:46 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["deploy/crawler/docker-compose.yml, Dockerfile.runner, run-hourly.sh and README.md (all new)"],"completed":["The LinkedIn crawler needed the owner's Mac awake. A VPS stack in deploy/crawler now runs it there, sending its traffic through the home device teresas-macbook-pro so LinkedIn sees the home address."],"decisions":["no new decisions"],"evidence":["Compose file parses with three services sharing the tailscale container's network, browser and runner gated on the exit node being online; the hourly wrapper passes a shell syntax check. Not yet run: Docker isn't installed on this Mac and SSH to octo-vps is refused."],"evidence_class":"observed","next_action":"Owner turns on the exit node on teresas-macbook-pro, creates the Tailscale auth key and env file on the VPS, starts the stack, and confirms the crawler's address is the home address.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T18:17:46Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"6c33ad29732bc8adba73bea3ef935e31b94f30e13ac00438901845e166a8fab7","request_id":"f176ba40cf8a4d679fca315b55652803","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- The LinkedIn crawler needed the owner's Mac awake. A VPS stack in deploy/crawler now runs it there, sending its traffic through the home device teresas-macbook-pro so LinkedIn sees the home address.

Evidence:
- Compose file parses with three services sharing the tailscale container's network, browser and runner gated on the exit node being online; the hourly wrapper passes a shell syntax check. Not yet run: Docker isn't installed on this Mac and SSH to octo-vps is refused.

Decisions:
- no new decisions

Changed:
- deploy/crawler/docker-compose.yml, Dockerfile.runner, run-hourly.sh and README.md (all new)

Blocked/uncertain:
- none

Next:
- Owner turns on the exit node on teresas-macbook-pro, creates the Tailscale auth key and env file on the VPS, starts the stack, and confirms the crawler's address is the home address.

### 2026-11-21 18:29:54 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["app/server/dm.ts and adapter route, console profile event log, collector/src/dms.ts and dmParse.ts, deploy/crawler wiring"],"completed":["DMs never reached the app. A private DM pipeline now exists, with LinkedIn as its first source: ingest route, contact matching by LinkedIn link only, daily private event-log entries, and a reader that runs in the VPS crawler stack."],"decisions":["no new decisions"],"evidence":["App: types, biome, Vitest (10 new DM tests) and build pass. Console: typecheck without the app's packages, eslint, machine tests (1 new) and build pass. Collector: types and 18 tests pass (13 new parser tests). The LinkedIn page reader itself has not run against live LinkedIn."],"evidence_class":"observed","next_action":"Owner sets DM_INGEST_TOKEN and RI_DM_TOKEN once the crawler stack runs; then build the Telegram slice.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T18:29:54Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"77937b7a3d95b820ddb2ce7cd4322ecec51764733df17a4c8fbdf1663658deac","request_id":"fcf7677e83044e6c8a19d37f73025995","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- DMs never reached the app. A private DM pipeline now exists, with LinkedIn as its first source: ingest route, contact matching by LinkedIn link only, daily private event-log entries, and a reader that runs in the VPS crawler stack.

Evidence:
- App: types, biome, Vitest (10 new DM tests) and build pass. Console: typecheck without the app's packages, eslint, machine tests (1 new) and build pass. Collector: types and 18 tests pass (13 new parser tests). The LinkedIn page reader itself has not run against live LinkedIn.

Decisions:
- no new decisions

Changed:
- app/server/dm.ts and adapter route, console profile event log, collector/src/dms.ts and dmParse.ts, deploy/crawler wiring

Blocked/uncertain:
- none

Next:
- Owner sets DM_INGEST_TOKEN and RI_DM_TOKEN once the crawler stack runs; then build the Telegram slice.

### 2026-11-21 18:54:49 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["app/server/dm.ts (contact handles, conversations, link) and two owner-only routes; People page card; collector/src/telegram.ts; telegram service in deploy/crawler"],"completed":["Telegram chats couldn't reach the app or attach to contacts. A Telegram reader now runs in the VPS stack, and the People page lists unmatched chats so the owner can link each to a contact once."],"decisions":["no new decisions"],"evidence":["App: types, biome, 192 Vitest tests (4 new for linking and Telegram matching) and build pass. Console: typecheck without the app's packages, eslint, machine tests (1 new for name suggestions) and build pass. Collector: types and 21 tests pass (3 new). The reader has not signed in to a real Telegram account."],"evidence_class":"observed","next_action":"Owner adds Telegram API id and hash, signs in once, and links chats on the People page; then WhatsApp.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T18:54:49Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"e9257c8abb9d966a1e05fb85095e0ddf7e3e6b47d1aae0537b96b4ec3625fcb0","request_id":"c11e1e43f64243b8b53e8b58fdd7d942","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- Telegram chats couldn't reach the app or attach to contacts. A Telegram reader now runs in the VPS stack, and the People page lists unmatched chats so the owner can link each to a contact once.

Evidence:
- App: types, biome, 192 Vitest tests (4 new for linking and Telegram matching) and build pass. Console: typecheck without the app's packages, eslint, machine tests (1 new for name suggestions) and build pass. Collector: types and 21 tests pass (3 new). The reader has not signed in to a real Telegram account.

Decisions:
- no new decisions

Changed:
- app/server/dm.ts (contact handles, conversations, link) and two owner-only routes; People page card; collector/src/telegram.ts; telegram service in deploy/crawler

Blocked/uncertain:
- none

Next:
- Owner adds Telegram API id and hash, signs in once, and links chats on the People page; then WhatsApp.

### 2026-11-21 20:01:00 UTC — agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1

<!-- continuity:checkpoint {"agent":"agent:claude-code/38eb6f3f-eb00-4433-b67c-ac4b43b060d1","blocked":[],"changed":["collector/src/whatsapp.ts and whatsappMap.ts, Baileys 6.7.24 with libsignal pinned to npm 6.0.0, whatsapp service in deploy/crawler"],"completed":["WhatsApp chats couldn't reach the app. A WhatsApp reader now runs as a linked device in the VPS stack, behind the home address, feeding the private DM pipeline and the Conversations to match card."],"decisions":["no new decisions"],"evidence":["Collector: frozen install with the Docker flags, types and 25 tests pass (4 new for WhatsApp mapping). App and console checks unchanged and passing. The reader has not been linked to a real WhatsApp account."],"evidence_class":"observed","next_action":"Owner links WhatsApp once by QR; then Discord.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0002","timestamp":"2026-11-21T20:01:00Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"ae7d201ef1c3f8a32e1a0907db38d70e1be94cc49f2204837612206d290116c9","request_id":"050b4c2a9b2747d1ac2613574304cff4","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0002"} -->

Completed:
- WhatsApp chats couldn't reach the app. A WhatsApp reader now runs as a linked device in the VPS stack, behind the home address, feeding the private DM pipeline and the Conversations to match card.

Evidence:
- Collector: frozen install with the Docker flags, types and 25 tests pass (4 new for WhatsApp mapping). App and console checks unchanged and passing. The reader has not been linked to a real WhatsApp account.

Decisions:
- no new decisions

Changed:
- collector/src/whatsapp.ts and whatsappMap.ts, Baileys 6.7.24 with libsignal pinned to npm 6.0.0, whatsapp service in deploy/crawler

Blocked/uncertain:
- none

Next:
- Owner links WhatsApp once by QR; then Discord.

## Handoff

Read PROJECT → CURRENT → this task → minimum relevant spec. Checkpoint before stopping.
