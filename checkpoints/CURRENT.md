# Current Continuity State

<!-- continuity:current {"active_task":"RI-0002","active_task_file":"tasks/TASK-RI-0002-console-product.md","protocol_version":"0.1.0-draft","schema":"project-continuity.current.v1"} -->

- Active issues: [#48 (RI-0018)](https://github.com/Pukujan/relationship-intelligence/issues/48), [#49 (RI-0019)](https://github.com/Pukujan/relationship-intelligence/issues/49), [#50 (RI-0020)](https://github.com/Pukujan/relationship-intelligence/issues/50)
- Active branch: `main` (`976478c`, all PRs #44, #45, #46, #51 merged)
- Primary writer: `dsh-lead`
- Parent program: [issue #1](https://github.com/Pukujan/relationship-intelligence/issues/1)
- Status:
  - Tenancy choke, role gates, 409 idempotency, UX research memo (`docs/RESEARCH-UX.md`), Approval Do/Don't triage, Glance 3-move agenda, and Person 1-hop intro paths merged (#44, #45).
  - Single-Octo Slack-like hierarchy (`ri_console.workspace`, `workspace_member`, `project_member`, `organization`, `app_user`; zero `OCTO_ACCOUNT_KEY` required), user-level connectors + OAuth + sync workers (`gmail`, `gcal`, `gdrive`, `zoom`, 11-provider catalog, `ri_console.connector_route`), and dual ledgers (`ri_console.ledger_event` + zero-dep OTLP/OpenInference exporter in `app/server/telemetry.ts`) merged (#46).
  - Starter agent templates (4), custom workspace agent builder, Zone 3 Co-Design Draft Plans → Lock (`POST /app-api/draft-plans/:id/lock`), and `POST /app-api/connectors/sync-all` merged (#51).
  - Live at `https://business.design-bakery.com/console/` (all new `/app-api/config`, `/app-api/connectors`, `/app-api/agent-templates`, `/app-api/draft-plans` verified `200`; `28/28` Vitest tests pass; live hold-out tenancy suite `7 pass, 0 red, 4 skip`).
- Next action:
  1. Fix `consoleDist` path resolution in `app/server/adapter.ts` (resolve relative to `import.meta.url` instead of `process.cwd()`) so the existing Komodo `Dockerfile` (`WORKDIR /app`) serves `/app/console/dist` cleanly on the VPS over Tailscale, then point `business.design-bakery.com` to Komodo instead of local `:8787`.
  2. Add `https://business.design-bakery.com/app-api/connectors/oauth/google/callback` to Google Cloud OAuth client (and optional `ZOOM_CLIENT_ID`/`SECRET` + `PHOENIX_COLLECTOR_ENDPOINT` or Octo `/api/workspaces/<id>/otel/*` endpoint) to run live OAuth & sync tests.
- Migration note: Octo's API is `https://octodb.design-bakery.com` with the single container `OCTO_WORKSPACE_ID` + `OCTO_API_KEY` from `.env`; Komodo CD on VPS (`octo-vps` over Tailscale) builds from root `Dockerfile`.
