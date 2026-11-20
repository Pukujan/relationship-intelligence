# PDD — Workspaces, roles, and the four creation flows (RI-0017)

**Status:** plan, not implemented. Companion to `SDD-WORKSPACES-ROLES.md`.
Owner direction 2026-11-19: "how do I make new project / new workspace / join
new workspace / new project from my teammate?" and "there is way too much on
screen". This document answers both with screens, not promises.

## 1. The four flows, where they live

### 1.1 New project (exists today; discoverability fixed)
- **Projects page header:** `New project` button (already shipped) → inline
  name + summary form → creates a `shared` project container.
- **Added:** the same action inside the **project switcher** dropdown (footer
  row "＋ New project…") and in **⌘K** as a command, so it is reachable from
  every screen without navigating.
- Teammate-created projects appear to you exactly like yours: `shared`
  visibility, owner shown as a chip on the card ("by Sam Rivera").

### 1.2 New workspace
- **Workspace switcher** (sidebar, currently lists memberships only) gains a
  footer row **"＋ New workspace…"**.
- Dialog: name (required), optional description. Submit → adapter creates the
  Octo workspace, provisions `ri_console`, switches you into it, and lands on
  an **empty-state Today**: "This workspace is empty. Create a project, invite
  teammates, or ask the copilot to seed a plan." Three buttons, nothing else.
- You become `owner`. The workspace key never leaves the server; the switcher
  shows role badges (`owner`, `admin`, `operator`, `member`).

### 1.3 Invite a teammate (join, part one)
- **Workspace switcher footer:** "Invite teammate…" (admin+ only; hidden
  otherwise, not disabled-with-no-explanation).
- Dialog: email + role select (`admin`, `operator`, `member`; default member)
  + one-line explanation of what the role can do (from the SDD matrix).
- Result row in **Profile & team → Team**: pending invite with email, role,
  "waiting for first sign-in", and a revoke action.
- Copy shown to the inviter: "They join by opening business.design-bakery.com
  and signing in with this Google address. Nothing else to install."

### 1.4 Join a workspace (join, part two)
- Teammate opens the console, clicks **Continue with Google**, uses the invited
  address. Our callback activates the pending invite, seals their session with
  the invited role, and lands them on **that workspace's Today** — not yours.
- If the address has no invite and no membership: a clear screen — "You're
  signed in as x@y, but no workspace has invited you. Ask an owner to invite
  you, or create your own workspace." Two buttons: `Create workspace`,
  `Copy my email`. No silent empty world, no accidental access.
- Switching workspaces is always explicit (switcher); the last choice persists
  per browser, and a revoked membership drops you to the join screen with a
  reason banner.

## 2. Roles, made visible

- Switcher rows and Team list show role badges; hovering a badge shows the
  three capabilities that matter for that role (read / act / manage).
- Actions you cannot perform are **hidden**, except delete/invite where hiding
  would confuse ownership — those render disabled with a one-line reason
  ("Only admins manage members").
- Approvals: you see proposals you may decide; a member sees only their own.
  The inbox count respects that, so "1 decision waiting" is always true for
  the reader.

## 3. Density: the Glance / Brief / Deep content contract

The complaint: at **Glance**, Today still renders KPI tiles + four
Needs-attention cards + Next-7-days strip + three bottom cards. That is Brief
content wearing a Glance label. The contract becomes:

| Altitude | Today renders | Never renders |
|---|---|---|
| **Glance** | one prose sentence ("1 decision waiting, 1 mission due, 1 going cold"); 4 compact KPI tiles; **one** "Needs attention" list of at most 3 one-line rows (label · detail · link); nothing else | card grids, timelines, team panel, activity, evidence |
| **Brief** | Glance + Next-7-days strip + the three working cards (My approvals / Missions due today / Going cold) | evidence, activity, step lists |
| **Deep** | Brief + team panel + activity/evidence/steps per item + portfolio detail + delete affordances | — |

Rules:
- Altitude is **presentation-only**: the fetched world payload is identical at
  all three (invariant I7, checked by the UI metamorphic suite).
- The choice persists per view per tab (already true) and the control is
  controlled state on every page (fixed for Today/Projects/Calendar; audit
  remaining pages in Slice 5).
- Glance is the default for a first visit; a returning tab keeps its choice.
- Every Glance row is a link or peek target: glance must be actionable in one
  click, never a dead summary.

## 4. Empty and error states (tenancy-aware)

- Empty workspace: three actions (§1.2), no fake data.
- Non-member: join screen (§1.4), never an empty dashboard.
- Revoked mid-session: reason banner + re-sign-in, cookie preserved for resume.
- Octo unavailable: existing offline-labelled fallback, never silent seed data
  in owner mode.

## 5. Acceptance (product-level, verified by hold-out + patchright suite)

1. Owner can create a workspace from the switcher in ≤3 clicks and lands on its
   empty-state Today.
2. Owner invites an email; a second browser signing in with that email lands
   in that workspace with the invited role and sees only its data.
3. A non-member session receives 403 for every data route of a foreign
   workspace, and the switcher never lists it.
4. Member cannot invite, cannot delete others' projects, cannot decide others'
   proposals; the UI hides or explains each.
5. Glance renders ≤3 attention rows and no card grids; Brief adds exactly the
   working cards; Deep adds evidence/activity; payload identical across all.
6. New project reachable from Projects header, project switcher, and ⌘K.
