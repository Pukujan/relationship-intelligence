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

## Handoff

Read PROJECT → CURRENT → this task → the collection/team plan before implementation.
