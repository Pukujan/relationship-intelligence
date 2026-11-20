# SDD — Workspaces, roles, and permissions (RI-0017)

**Status:** plan, not implemented. Issue log: #37 (RI-0012), #38 (RI-0013); redesign slices #39/#40/#41 are blocked by research gate #42 (RI-0017). Owner direction 2026-11-19: plan first, write
SDD/PDD and metamorphic/hold-out validations first, then implement in slices.
Companion: `PDD-WORKSPACES-ROLES.md`, `VALIDATIONS-WORKSPACES-ROLES.md`,
hold-out suite `scripts/validate_tenancy.py` (red until Slice 1 lands).

## 1. What exists today (audit, not aspiration)

| Layer | Mechanism | Source |
|---|---|---|
| Octo roles | `owner` (implicit creator), grantable `admin`, `operator`, `member`; `roleMeetsMinimum`, `effectiveWorkspaceRole` | `octo-db/src/routes/members.ts`, `server/auth-context.ts` |
| Octo key scopes | `read`, `write`, `files`, `delete`; workspace-scoped keys cannot mint workspaces | `octo-db/src/routes/workspaces.ts` |
| Octo membership lifecycle | invite by email → `pending` → becomes membership at first Google sign-in | `members.ts`, `auth.ts` |
| Row visibility | `ri_console.*.visibility` = `private` \| `shared`; reads match `principal_id = caller OR visibility='shared'` | `app/server/sessions.ts` `owns()` |
| Our session | iron-session cookie; modes: owner Google (principalId, no Octo token), owner key, legacy Octo token, guest seed | `app/server/adapter.ts`, `session.ts` |
| Our role enforcement | **none.** `/app-api/team` reads Octo roles read-only; every data route authenticates the session but never checks membership or role | `adapter.ts` world gate |
| Our tenancy enforcement | **partial.** Token sessions are checked against `fetchWorkspaces(token)` memberships (hold-out MR1–MR3 PASS for a guest). **principalId-mode sessions (our own Google flow) resolve memberships with the server-side owner key**, so any invited teammate passes the membership check for every workspace. No role gates anywhere. | `adapter.ts` bearer resolution; `scripts/validate_tenancy.py` baseline |

Consequence: inviting a teammate today would expose every workspace's shared
data to them, because their session resolves membership with the owner key.
Roles are display-only. This SDD makes both load-bearing.

## 2. Identity and membership model

- **Principal** stays Octo-canonical when it exists (`octo.principals`, matched
  by verified Google email through `GET /api/workspaces/:id/members`).
- **Teammate first sign-in:** our own-Google callback verifies the email, then
  resolves membership in this order:
  1. active member row → use its `principalId`;
  2. pending invite for that email → activate via
     `POST /api/workspaces/:id/members {email, role}` (owner-key authority) and
     use the returned `principalId`;
  3. neither → **deny** (`403 NOT_A_MEMBER`). We never invent principals and
     never auto-join. Octo remains the only principal store.
- **Session cookie** gains `role` (resolved at sign-in and re-resolved on every
  world request, never trusted from the client) and `workspaceId` default.
- **Guest** remains the seeded demo, client-side only, never authenticated
  against Octo; it must never reach `/app-api/*` data routes.

## 3. Permission matrix (enforced in our adapter, Octo roles authoritative)

| Capability | owner | admin | operator | member | non-member |
|---|---|---|---|---|---|
| Read world/shared rows of workspace | ✓ | ✓ | ✓ | ✓ | 403 |
| Read own private rows | ✓ | ✓ | ✓ | ✓ | 403 |
| Create/edit project, mission, plan, note | ✓ | ✓ | ✓ | own only | 403 |
| Delete project (cascade) | ✓ | ✓ | own only | own only | 403 |
| Decide approval (approve/decline) | ✓ | ✓ | ✓ | own proposals | 403 |
| Create schedule / run research | ✓ | ✓ | ✓ | ✓ | 403 |
| Invite / change role / remove member | ✓ | ✓ | ✗ | ✗ | 403 |
| Create workspace | ✓ (account) | ✗ | ✗ | ✗ | 403 |
| Upload files / set visibility | ✓ | ✓ | ✓ | own only | 403 |

Rules: `roleMeetsMinimum` semantics copied from Octo (`owner > admin >
operator > member`). "own only" = the `owns()` predicate already in
`sessions.ts`. Every statement keeps `workspace_id = requested AND owns(...)`.

## 4. Enforcement points (single choke, no scattered checks)

1. `resolveTenancy(req, res, env, session)` → `{principal, role, workspace}` or
   a written 401/403. Called once at the top of the world-routes block, before
   any SQL. Replaces the current `fetchWorkspaces(key)` membership assumption.
2. `requireRole(role, min)` helper mirroring Octo's ordering; used by invite,
   workspace-create, delete, decide.
3. `GET /app-api/session` returns **only workspaces where the session principal
   is an active member** (filter the key's list by membership), plus `role` per
   workspace. The switcher can no longer show workspaces you cannot enter.
4. Octo RLS remains the backstop for direct Octo access; our adapter is the
   enforcement point for console traffic because it holds the owner key.

## 5. New API contracts (adapter)

- `POST /app-api/workspaces {name}` → owner-only; Octo `POST /api/workspaces`
  requires an **account-scoped** key (`OCTO_ACCOUNT_KEY`); workspace-scoped keys
  are forbidden by Octo from minting workspaces. Until the owner supplies one,
  the flow ships disabled-with-explanation and MR5 stays SKIP. Then apply `ri_console` DDL (same statements as
  `console/scripts/bootstrap-octo.mjs`, imported not duplicated), then return
  `{id, name, role:"owner"}`. Failure mid-bootstrap → report and leave the
  workspace listed as `unprovisioned`, retryable via `POST /app-api/workspaces/:id/provision`.
- `POST /app-api/workspaces/:id/invites {email, role}` → admin+; Octo
  `POST members`; returns `{status:"pending"|"added", role}`.
- `GET /app-api/workspaces/:id/members` → member+; Octo members + pending.
- `DELETE /app-api/workspaces/:id/members/:email` → admin+, never owner, never
  self-demotion below caller rank (Octo already enforces; we pre-check to give
  a clean 403).
- Existing routes gain role gates per §3; no shape changes otherwise.

## 6. Data model additions

- `ri_console.workspace_meta (workspace_id PK, provisioned_at, ddl_version)` —
  idempotent bootstrap marker; DDL version bumps re-run only missing statements.
- No new principal tables. No parallel identity store (repo rule).
- Invites/memberships/roles stay in Octo control plane; we cache nothing
  authoritative client-side.

## 7. Isolation invariants (must hold, checked by hold-out suite)

- I1: a session never receives rows of a workspace it is not an active member of.
- I2: `private` rows are invisible to every principal except their owner.
- I3: role changes take effect on the next request (no cached grants).
- I4: workspace creation bootstraps exactly the `ri_console` DDL set, idempotently.
- I5: cascade delete leaves no orphan plan/mission/objective referencing the project.
- I6: deciding an approval twice materializes at most once.
- I7: presentation altitude never changes the fetched payload (UI-only state).

## 8. Failure modes and compat

- Octo down → 502 with resume cookie preserved (existing behaviour).
- Membership revoked mid-session → next request 403 `role_revoked`; console
  shows a re-sign-in banner, never a silent empty world.
- Legacy owner-key and Octo-token sessions keep working; they resolve role
  `owner`/member respectively through the same choke.
- Guest demo untouched; it never calls the adapter.

## 9. Slice order (each independently mergeable, gates + hold-out green)

1. **Tenancy choke + session scoping** (I1–I3): `resolveTenancy`, membership
   filter, role resolution; hold-out MR1–MR4 flip red→green.
2. **Workspace create + provision** (I4): switcher "New workspace", DDL import,
   `workspace_meta`; hold-out MR5.
3. **Invite + join** (lifecycle §2): switcher/Team invite UI, callback pending
   activation, member management UI; hold-out MR6–MR7.
4. **Role-gated writes + cascade integrity** (I5–I6): delete/decide gates;
   hold-out MR8–MR9.
5. **Presentation layering** (I7): Glance/Brief/Deep content contract from the
   PDD; UI metamorphic suite in patchright.
