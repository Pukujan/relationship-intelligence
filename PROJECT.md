# Relationship Intelligence — Project Contract

<!-- continuity:project {"id":"relationship-intelligence","protocol_version":"0.1.0-draft","schema":"project-continuity.project.v1","title":"Relationship Intelligence"} -->

## Product

A self-hosted research and relationship CRM for answering:

> Who is relevant to this event, company, project, or deal; what do they publicly work on; how are they connected; and what evidence supports the answer?

It combines person/company/project/event records, dated source-backed claims, identity review, interaction history, research jobs, and relationship exploration.

## Product surface — the console

The product is operated through a **console**: one command center where a person directs a
team of specialized AI agents (sales, marketing, research, and more) that work the
relationship graph. The full goal, operating model, and UX map live in
[docs/CONSOLE.md](docs/CONSOLE.md). Its governing principles extend, not replace, the rules
below:

- **Human always in control.** Agents propose (names, objectives, plans, drafts, research);
  the human decides. Nothing sends, calls, publishes, or commits without consent.
- **No silent stalls.** Milestones and objectives carry deadlines; blocked or overdue work is
  surfaced as a signal with a proposed way forward, never left to drift.
- **State is legible.** Progress, decay, and "needs you" are represented as data signals,
  aggregated so the person always knows what needs them.
- **Organized work, graph-backed people.** Every project carries a mission — its enduring
  purpose, never time-boxed. Bounded work is grouped as Project (mission) → Objective
  (bounded goal) → Milestone (time-boxed unit) → Plan; people/companies/events stay a single
  evidence-backed graph that work references, never duplicates.

## Authority and ownership

- **Product owner:** `Pukujan`.
- **Canonical product intent:** the accepted program issue and accepted slice issues.
- **Canonical facts:** Octo's epistemic ledger (`epistemic_entities`, `claims`, `evidence`, `beliefs`, and claim relations).
- **Canonical source bytes:** Octo Files.
- **Searchable source text:** Octo RAG, derived from source files.
- **Relationship graph:** Octo graph projection, rebuildable from the ledger.
- **Operational state:** the Octo workspace database (imports, review tasks, research queue, cursors, budgets).
- **Issue-log semantics:** the installed, pinned OIO package.
- **Execution continuity:** repository issues and the current handoff.

This repository is an Octo adopter. It does not modify Octo, create a competing canonical database, or add a second graph engine without an explicit owner decision.

## Product rules

1. Teammates authenticate with their own Google accounts and receive individual Octo principals and workspace memberships.
2. Each teammate connects their own TinyFish account and source sessions; no source session is shared or inherited.
3. Private mail, calendar, and personal interaction records remain in per-person workspaces until explicitly published to the team workspace.
4. Collection plans, run checkpoints, and source ownership are durable operational records.
5. Every externally sourced fact carries evidence or remains explicitly unverified.
6. Name + employer never authorizes an identity merge.
7. Corrections supersede claims; they do not erase history.
8. Agent output is a proposal until the accepted evidence/write rules allow it to land.
9. A displayed current profile is a projection of live claims, not a second biography database.
10. A stale graph is reported as stale rather than presented as current.
11. No sensitive-attribute inference, fabricated relationships, automated outreach, or evasion of platform controls.

## Non-goals for the initial product

- A LinkedIn clone or public social network.
- A general-purpose BI platform.
- A new graph database, vector database, identity service, or workflow engine.
- Bulk crawling before the import/profile path is proven.
- Fully autonomous identity merges or relationship assertions.
- Replacing Octo's backend or ABA's builder.

## Stack decision

Use ABA's normal app output for the application:

- React + Vite + TypeScript.
- Tailwind and shadcn/ui.
- TanStack Query for server state.
- Zod for runtime contracts shared with import/export payloads.
- Playwright for real user flows.
- Vitest and fast-check for deterministic and property tests.

Use Nitro only if a slice requires a thin server-side session/key adapter. Do not add a standalone backend framework merely for symmetry. Octo owns durable capabilities and authorization.

Existing Python ingestion/prototype scripts remain supported with Ruff and mypy; new application and adapter code is TypeScript.

## Delivery method

Each slice has a compact PDD/SDD/eval packet in its owning issue:

```text
owner intent
→ PDD/SDD/eval draft
→ independent critique
→ owner acceptance
→ implementation
→ public deterministic tests
→ real user-flow test
→ targeted metamorphic tests
→ production smoke when deployed
→ done or correction
```

A slice is not done because it compiles, passes lint, or has a screenshot. It is done when its accepted user job works end to end with the required evidence.

## Initial sequence

1. Repository, Octo connection, contracts, and gates.
2. Google-authenticated teammates with isolated source ownership and shared/private workspaces.
3. Durable TinyFish connections and source-specific collection plans.
4. LinkedIn profile exploration with scrolling, section expansion, checkpoints, and sourced person profiles.
5. Luma/X exploration, identity review, and event/organization records.
6. Private Gmail/calendar interaction ingestion.
7. Research proposals, relationship views, scheduling, and analytics.

See `docs/PLAN.md` for the full plan and `HANDOFF.md` for the current next action.
