# Relationship Intelligence — Project Contract

<!-- continuity:project {"id":"relationship-intelligence","protocol_version":"0.1.0-draft","schema":"project-continuity.project.v1","title":"Relationship Intelligence"} -->

## Product

A self-hosted research and relationship CRM for answering:

> Who is relevant to this event, company, project, or deal; what do they publicly work on; how are they connected; and what evidence supports the answer?

It combines person/company/project/event records, dated source-backed claims, identity review, interaction history, research jobs, and relationship exploration.

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

1. Every externally sourced fact carries evidence or remains explicitly unverified.
2. Name + employer never authorizes an identity merge.
3. Corrections supersede claims; they do not erase history.
4. Agent output is a proposal until the accepted evidence/write rules allow it to land.
5. A displayed current profile is a projection of live claims, not a second biography database.
6. A stale graph is reported as stale rather than presented as current.
7. Source collection uses official exports/APIs where available; incremental authenticated collection is a separate slice.
8. No sensitive-attribute inference, fabricated relationships, automated outreach, or evasion of platform controls.

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
2. CSV import → identity review → sourced person profile.
3. Corrections, current-profile projection, and merge/split.
4. Event participation and sponsor views.
5. Research queue and agent proposal review.
6. Relationship graph and path exploration.
7. Incremental collection, scheduling, and historical analytics.

See `docs/PLAN.md` for the full plan and `HANDOFF.md` for the current next action.
