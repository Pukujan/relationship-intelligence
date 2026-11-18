# Relationship Intelligence

A private, evidence-backed research and relationship CRM built on Octo: people, organizations, projects, events, interactions, sourced claims, identity review, and relationship exploration.

## Current state

**Planning baseline.** The product contract, stack decision, full plan, validation strategy, OIO issue program, and ABA build brief are ready for owner acceptance. No production application has been generated yet.

- [Project contract](PROJECT.md)
- [Full build plan](docs/PLAN.md)
- [Stack and ABA contract](docs/STACK.md)
- [Validation and metamorphic tests](docs/VALIDATION.md)
- [Slice packet template](docs/SLICES.md)
- [Issue program](docs/ISSUES.md)
- [Current next action](HANDOFF.md)

## Architecture

Octo is canonical for entities, claims, evidence, beliefs, source files, RAG, graph projection, and workspace authorization. The application uses ABA's React + Vite + TypeScript output. Existing importers and n8n supply typed data to Octo. Operational import/research queues live in the Octo workspace database; no second canonical person database is created.

The first vertical slice is CSV import → identity review → sourced person profile. Autonomous collection, graph UI, research proposals, and analytics follow only after that path is verified.

## Prototypes

`seed/`, `queries/`, and `viz/` contain early Octo integration experiments. They are useful references but are not the production identity model or UI. In particular, name-keyed identity and JSON-substring graph traversal must be replaced by stable IDs and explicit typed contracts.

## Governance

Read [GOVERNANCE.md](docs/GOVERNANCE.md). Source facts with evidence, keep uncertain identities separate, preserve corrections, and do not infer sensitive attributes or fabricate relationships.

## Repository validation

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
```

Application gates (strict TypeScript, Biome, runtime schemas, unit/property tests, architecture/orphan checks, Playwright, and real Octo contracts) are specified in [VALIDATION.md](docs/VALIDATION.md) and added with the corresponding application slices.
