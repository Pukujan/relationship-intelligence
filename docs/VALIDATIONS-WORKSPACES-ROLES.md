# Validations — Workspaces, roles, tenancy (RI-0017)

**Status:** hold-out suite written BEFORE implementation, per owner direction.
`scripts/validate_tenancy.py` is deliberately **not imported by any product
code**; CI runs it as a contract job after deploy. It is red today where the
SDD's invariants are not yet enforced — that red is the specification.

## Metamorphic relations (properties, not examples)

Each relation states what must remain true when the input is transformed.
They are checked against the live adapter with two real sessions: the owner
(workspace key accepted through `/app-api/session/accept-key`) and an Octo
**guest principal** (minted via `POST /api/auth/guest`, accepted through
`/app-api/session/accept`) — a genuine second identity with no membership.

| ID | Relation (transformation → invariant) | SDD invariant | Baseline |
|---|---|---|---|
| MR1 | swap session owner→guest, same workspace request → foreign workspace data must become 403, never a filtered-but-200 leak | I1 | PASS (token path) |
| MR2 | swap session owner→guest, session listing → workspace list must shrink to memberships only | I1 | PASS (token path) |
| MR3 | swap session owner→guest, same write (create project) → must become 403, not a row owned by guest in owner's workspace | I1+§3 | PASS (token path) |
| MR1b | same as MR1 but session in principalId mode (our Google flow) → 403 | I1 | SKIP — needs second Google identity; U4 covers it |
| MR3b | same as MR3 but principalId mode → 403 | I1+§3 | SKIP — same |
| MR4 | swap session owner→guest, invite call → must become 403 (route may not exist yet; absence of enforcement counts as red) | §3 | RED |
| MR5 | create workspace twice with same name / re-provision → exactly one workspace, DDL idempotent, `workspace_meta.ddl_version` stable | I4 | SKIP (needs account-scoped key, see below) |
| MR6 | create project + child mission, then delete project → no mission/plan/objective references survive | I5 | GREEN |
| MR7 | decide the same approval twice → at most one materialized mission; second decide is not a second creation | I6 | PASS (n=1; second decide returns 502 today — Slice 4 makes it a clean 409) |
| MR8 | swap session owner→guest, list conversations → owner's `private` rows absent, guest's own rows present | I2 | GREEN |
| MR9 | change a member's role, then next request → capability changes immediately, no cached grant | I3 | SKIP until Slice 3 |

## UI metamorphic relations (patchright suite, Slice 5)

| ID | Relation | Invariant |
|---|---|---|
| U1 | change altitude Glance→Brief→Deep on Today/Projects/Calendar → the `/app-api/world` payload is byte-identical; only rendered DOM changes | I7 |
| U2 | type a query matching k threads → exhaustive search returns all k regardless of page size; clearing restores paging | rail contract |
| U3 | delete a project at Deep → card disappears without reload (cache invalidated), and SQL cascade holds | I5 |
| U4 | sign in as invited teammate in a second context → lands in invited workspace, switcher lists only memberships | I1 |

## Hold-out rules

- The suite lives in `scripts/`, reads only public HTTP surfaces plus the
  workspace SQL surface for cascade assertions; it never imports adapter or
  console modules, so implementation cannot special-case it.
- It creates its own fixtures (unique names per run) and cleans them up; it
  never touches seeded demo rows.
- CI: run after the post-merge live check; a RED MR blocks the deploy contract.
- MR5 requires an **account-scoped** Octo key (`OCTO_ACCOUNT_KEY`): Octo forbids
  workspace-scoped keys from minting workspaces. Until the owner supplies one,
  workspace creation ships disabled-with-explanation and MR5 stays SKIP.

## Baseline (recorded at plan time, before any implementation)

Run: `.venv/bin/python scripts/validate_tenancy.py`
Result: 6 PASS (MR1–MR3 token-path tenancy, MR6 cascade, MR7 idempotence,
MR8 private isolation), 1 RED (MR4: invite route absent, therefore unenforced),
4 SKIP (MR1b/MR3b principalId-mode hole needs a second Google identity; MR5
needs an account key; MR9 needs the invite flow). Slice 1 must close the
principalId-mode hole (MR1b/MR3b via U4) and add role gates; Slice 3 flips MR4.
