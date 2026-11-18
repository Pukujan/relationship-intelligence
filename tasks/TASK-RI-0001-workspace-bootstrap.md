# TASK-RI-0001 — Authenticated Collection Workspace

<!-- continuity:task {"acceptance":["Two principals have isolated source connections and plans","Octo membership and source ownership are enforced","Collection state survives restart"],"depends_on":[],"goal":"Authenticate teammates and establish isolated, durable source collection plans","id":"RI-0001","issue_url":"https://github.com/Pukujan/relationship-intelligence/issues/9","next_action":"implement the authenticated shell and source ownership schema","owner":"dsh-lead","priority":"3","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Collector runs need individual session ownership before any profile or mailbox exploration can start"} -->

- Status: active
- Owner: dsh-lead
- Priority: 3
- Depends on: none

## Goal

Authenticate teammates through Google, enforce Octo workspace membership, and persist each teammate's TinyFish connections and collection plans without sharing source sessions.

## Human outcome

A teammate can sign into the shared app, connect only their own research accounts, and save a bounded collection plan that can later be resumed.

## Scope and boundaries

- In scope: authenticated application shell; principal/workspace verification; source ownership; durable plan/run state; private/shared workspace model.
- Next slice: LinkedIn exploration with scrolling, section expansion, evidence capture, and checkpoints; then Luma/X and Gmail/calendar adapters.
- Out of scope: CSV-first intake, public social networking, automatic identity merges, autonomous outreach, or sharing a source session across teammates.
- Dependency: actual source runs need saved, verified TinyFish sign-ins. Current profile has none; use TinyProfiles dashboard setup, not the stale CLI URL.

## Acceptance criteria

- [ ] Two principals can authenticate and use independent source connections.
- [ ] One principal cannot read or execute another's source connection by ID.
- [ ] Revoked Octo membership prevents further workspace access.
- [ ] Plans, runs, tasks, and checkpoints survive application restart.
- [ ] Private mail/calendar observations require explicit shared-workspace publication.
- [ ] Real collector acceptance covers configured exploration and resume on a saved session.

## Evidence and sources

- [Authenticated collection and team plan](../docs/COLLECTION-AND-TEAM-PLAN.md)
- [Owning issue #9](https://github.com/Pukujan/relationship-intelligence/issues/9)
- [TinyFish profile documentation](https://docs.tinyfish.ai/key-concepts/browser-context-profiles)

## Related records

- Leaf: #9; parent: #1; no dependencies.
- Primary writer: `dsh-lead`; branch `task/RI-0001-app-shell`.
- ACS installation: PR #8; merged squash commit `5d52991`; required `gates` passed.

## Checkpoint log

No implementation checkpoint yet.

### 2026-11-18 04:55:28 UTC — dsh-lead

<!-- continuity:checkpoint {"agent":"dsh-lead","blocked":[],"changed":["Project contract, team collection plan, issue #9, task and handoff, and browser-renderable design diagrams."],"completed":["Replaced CSV-first intake with a durable multi-user authenticated collection plan before application code landed."],"decisions":["Each teammate owns their source sessions; private mail/calendar observations require explicit publication."],"evidence":["Issue #9 supersedes #2/#3; the team plan defines individual Google/Octo identities, per-principal TinyFish sessions, private/shared workspaces, and resumable source tasks. Planning and continuity validation pass."],"next_action":"Implement the authenticated shell and per-principal source connection and plan schema, then verify a saved LinkedIn session for the first collector run.","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"RI-0001","timestamp":"2026-11-18T04:55:28Z"} -->
<!-- continuity:checkpoint-operation {"payload_sha256":"84198c4cd5f1521cdb1c998c827610d5064d780f20778cb6330ccbd16512d92b","request_id":"ri-auth-plan-20261118","schema":"project-continuity.checkpoint-operation.v1","task_id":"RI-0001"} -->

Completed:
- Replaced CSV-first intake with a durable multi-user authenticated collection plan before application code landed.

Evidence:
- Issue #9 supersedes #2/#3; the team plan defines individual Google/Octo identities, per-principal TinyFish sessions, private/shared workspaces, and resumable source tasks. Planning and continuity validation pass.

Decisions:
- Each teammate owns their source sessions; private mail/calendar observations require explicit publication.

Changed:
- Project contract, team collection plan, issue #9, task and handoff, and browser-renderable design diagrams.

Blocked/uncertain:
- none

Next:
- Implement the authenticated shell and per-principal source connection and plan schema, then verify a saved LinkedIn session for the first collector run.

## Handoff

Read PROJECT → CURRENT → this task → the collection/team plan before implementation.
