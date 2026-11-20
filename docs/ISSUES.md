# Issue Program

Issues are filed in `Pukujan/relationship-intelligence` using the installed OIO ontology and form. Local copies live in `docs/issues/` for review and durable planning.

| Local ID | GitHub issue | Scope | Priority |
|---|---|---|---|
| RI-000 | [#1](https://github.com/Pukujan/relationship-intelligence/issues/1) | Accepted product program and delivery contract | 3 |
| RI-001 | [#2](https://github.com/Pukujan/relationship-intelligence/issues/2) | Slice 000: authenticated Octo-connected app bootstrap and gates | 3 |
| RI-002 | [#3](https://github.com/Pukujan/relationship-intelligence/issues/3) | Slice 001: CSV import → identity review → sourced person profile | 3 |
| RI-003 | [#4](https://github.com/Pukujan/relationship-intelligence/issues/4) | Slice 002: stable identity, merge/split lineage, corrections | 4 |
| RI-004 | [#5](https://github.com/Pukujan/relationship-intelligence/issues/5) | Slice 003: event participation and sponsor views | 5 |
| RI-005 | [#6](https://github.com/Pukujan/relationship-intelligence/issues/6) | Slice 004: research queue, agent proposals, approval | 5 |
| RI-006 | [#7](https://github.com/Pukujan/relationship-intelligence/issues/7) | Slice 005: graph projection, freshness, and path exploration | 5 |
| RI-007 | [#9](https://github.com/Pukujan/relationship-intelligence/issues/9) | Supersedes #2/#3: Google teammates, isolated TinyFish sessions, durable collector plans | 3 |
| RI-008 | [#15](https://github.com/Pukujan/relationship-intelligence/issues/15) | Proposal: local collector daemon per teammate, device identity, Tauri packaging later | 3 |
| RI-009 | [#18](https://github.com/Pukujan/relationship-intelligence/issues/18) | Console product definition: goal, trust-layer operating model, and UX map | 3 |
| RI-0010 | [#23](https://github.com/Pukujan/relationship-intelligence/issues/23) | Slice 006: session copilot — tabbed research threads, visual parts, streaming | 3 |
| RI-0012 | [#37](https://github.com/Pukujan/relationship-intelligence/issues/37) | Slice 007: tenancy choke, roles, membership-scoped sessions | 3 |
| RI-0013 | [#38](https://github.com/Pukujan/relationship-intelligence/issues/38) | Slice 008: workspace create/provision, invite/join lifecycle | 3 |
| RI-0014 | [#39](https://github.com/Pukujan/relationship-intelligence/issues/39) | Slice 009: approval triage UX (research-gated by #42) | 2 |
| RI-0015 | [#40](https://github.com/Pukujan/relationship-intelligence/issues/40) | Slice 010: altitude layering + Glance agenda redesign (research-gated by #42) | 2 |
| RI-0016 | [#41](https://github.com/Pukujan/relationship-intelligence/issues/41) | Slice 011: competitive borrowings (research-gated by #42) | 2 |
| RI-0017 | [#42](https://github.com/Pukujan/relationship-intelligence/issues/42) | UX research gate before any redesign | 3 |

Implementation begins with RI-007 / issue #9. The CSV-first RI-001/RI-002 scope is superseded; later identity, event, research, and graph slices are re-sequenced by the authenticated collection plan in `docs/COLLECTION-AND-TEAM-PLAN.md`. RI-008 proposes where collection executes and must be decided before the source-connection schema in #12 is implemented; see `docs/COLLECTION-EXECUTION.md`. RI-009 defines the console product surface (goal, operating model, UX map) in `docs/CONSOLE.md` and is the canonical target for the console UI and intelligence slices.

RI-0012/RI-0013 are correctness/security and may proceed. RI-0014/RI-0015/RI-0016 are redesigns and are **blocked by RI-0017 (#42)** until a research memo (docs/RESEARCH-UX.md) and owner sign-off exist; see docs/UX-SCREENS.md and docs/VALIDATIONS-WORKSPACES-ROLES.md for the contract and hold-out suite they must satisfy.
