# Relationship Intelligence

A private, evidence-backed research and relationship CRM built on [Octo](https://octodb.design-bakery.com): people, organizations, projects, events, interactions, sourced claims, approval triage, user-level connectors, custom agents, and immutable audit tracing.

## Current state

**Live in production** at `https://business.design-bakery.com/console/` (deployed on `octo-vps` via `deploy/docker-compose.vps.yml` and `deploy/vps/autodeploy.sh`).

### Key capabilities on `main`
- **Single-Octo Slack-like hierarchy (`RI-0018`):** One backing Octo workspace container (`OCTO_WORKSPACE_ID`) hosts multiple App Workspaces, memberships (`owner > admin > operator > member`), projects, and invites (`ri_console.workspace`, `workspace_member`, `project_member`, `organization`, `app_user`) with zero `OCTO_ACCOUNT_KEY` required.
- **Tenancy, triage & relationship UX (`RI-0012`–`RI-0017`):** Single `resolveTenancy` choke point, atomic `409` double-decide idempotency, Approval Do/Don't triage with `stop | re_plan | snooze` decline paths, Glance 3-move agenda, and 1-hop "Who can introduce me" paths on person profiles.
- **User connectors, agent templates & Zone 3 Co-Design (`RI-0019`):** Incremental Google OAuth (`gmail`, `gcal`, `gdrive`), Zoom OAuth 2.0, 11-provider catalog, Workspace/Project routing rules (`ri_console.connector_route`), read-only sync workers (`POST /app-api/connectors/:provider/sync`, `POST /app-api/connectors/sync-all`), 4 starter agent templates, custom agent builder (`POST /app-api/agents`), and mutable **Draft Plans → Lock** (`POST /app-api/draft-plans/:id/lock`).
- **Dual ledgers & Arize Phoenix OTLP tracing (`RI-0020`):** Append-only `ri_console.ledger_event` plus zero-dependency OTLP/HTTP `application/x-protobuf` exporter (`app/server/telemetry.ts`) with secret/PII scrubbing, automatic Bearer auth, and `trace_id` propagation to Octo's Arize Phoenix collector.

### Documentation
- [Project contract](PROJECT.md)
- [Console architecture](docs/CONSOLE.md)
- [Production deployment (`business.design-bakery.com`)](docs/DEPLOY-BUSINESS.md)
- [UX research memo](docs/RESEARCH-UX.md)
- [UX screen contract](docs/UX-SCREENS.md)
- [Workspaces & roles design](docs/SDD-WORKSPACES-ROLES.md)
- [Full build plan](docs/PLAN.md)
- [Stack contract](docs/STACK.md)
- [Validation and metamorphic tests](docs/VALIDATION.md)
- [Issue program](docs/ISSUES.md)
- [Governance](docs/GOVERNANCE.md)
- [Current handoff](HANDOFF.md)

## Architecture

- **`app/server/`:** Node/TypeScript HTTP adapter serving `/app-api/*`, `/octo-auth/*` (adapter-owned Google sign-in), and the built SPA at `/console/`.
- **`console/`:** React + Vite + TypeScript frontend compiled into `console/dist` and served by the adapter.
- **`deploy/`:** Production `docker-compose.vps.yml` and `vps/autodeploy.sh` (healthchecked rolling swap with automatic rollback, joined to `study-os_edge`).
- **Octo (`https://octodb.design-bakery.com`):** Canonical store for entities, claims, evidence, beliefs, operational `ri_console.*` tables, and Arize Phoenix OTLP traces (`/api/workspaces/<id>/otel/v1/traces`).

## Local development

```bash
pnpm --dir console build
cd app && set -a && source .env && set +a && pnpm dev
```

## Verification & repository validation

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
cd app && pnpm typecheck && pnpm test && pnpm lint
pnpm --dir console typecheck && pnpm --dir console build
```

Live tenancy hold-out suite:

```bash
RI_PUBLIC_URL=https://business.design-bakery.com python3 scripts/validate_tenancy.py
```

## Governance

Read [GOVERNANCE.md](docs/GOVERNANCE.md). Source facts with evidence, keep uncertain identities separate, preserve corrections, and do not infer sensitive attributes or fabricate relationships.
