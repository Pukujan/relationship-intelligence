# Current Handoff

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

The issue-log shape and lifecycle are defined by the installed OIO ontology. For issue, pull-request, commit, and checkpoint prose, use the pinned CGM human-sounding-writing module: open with a concrete problem and observed result, explain identifiers on first use, distinguish evidence from inference, and state one next action. Link long logs rather than pasting them; never include private absolute paths, credentials, or session cookies. Pull requests use the reader-first template and `Closes #N` only when merge completes the issue; otherwise use `Refs #N`.
<!-- pcm:issue-log-format:end -->

## State (2026-11-20, `main` at `976478c`)

Four PRs are merged into `main` and live on `https://business.design-bakery.com/console/`:
- **PR #44 & PR #45 (#37–#42 / RI-0012..RI-0017):** Single `resolveTenancy` choke, role gates (`owner > admin > operator > member`), atomic `409` double-decide idempotency, UX research memo (`docs/RESEARCH-UX.md`), Approval Do/Don't triage with `stop | re_plan | snooze` decline paths, Glance 3-move agenda (`I7` invariant preserved), and 1-hop "Who can introduce me" panel on `PersonProfile.tsx`.
- **PR #46 (#48–#50 / RI-0018..RI-0020):** Refactored to the **single-Octo Slack-like model** (one `OCTO_WORKSPACE_ID` container; `ri_console.workspace`, `workspace_member`, `project_member`, `organization`, `app_user` — unlocking live `POST /app-api/workspaces` with zero `OCTO_ACCOUNT_KEY`). Added user-level connectors (`app/server/connectors.ts`, `app/server/sync.ts`, `Connectors.tsx`) with incremental Google OAuth (`gmail`, `gcal`, `gdrive`), Zoom OAuth 2.0, 11-provider catalog, Workspace/Project routing rules, and live read-only sync workers. Added append-only `ri_console.ledger_event` and zero-dep OTLP/OpenInference telemetry (`app/server/telemetry.ts`) with secret/PII scrubbing and `trace_id` propagation.
- **PR #51 (#49 / RI-0019):** Added 4 starter agent templates (`GET /app-api/agent-templates`), custom workspace agent builder (`POST /app-api/agents`), Zone 3 Co-Design **Draft Plans → Lock** (`GET/POST /app-api/draft-plans`, `POST /app-api/draft-plans/:id/lock` with `409 ALREADY_LOCKED`), `POST /app-api/connectors/sync-all`, and updated `Agents.tsx`.

All 20 issue log packets (`docs/issues/RI-000.md`–`RI-0020.md`) validate green; `28/28` Vitest tests, `pnpm typecheck`, Biome lint, `console` production build, and live hold-out tenancy suite (`7 pass, 0 red, 4 skip`) all pass.

## Next atomic action

1. **Fix Komodo Docker static path:** Update `consoleDist` in `app/server/adapter.ts` to resolve relative to `import.meta.url` instead of `process.cwd()` (currently `WORKDIR /app` in `Dockerfile` makes `../console/dist` resolve to `/console/dist` instead of `/app/console/dist`), then deploy via Komodo on `octo-vps` (Tailscale) and switch `business.design-bakery.com` from the local Mac Cloudflare tunnel to the VPS container.
2. **Activate live OAuth & traces:** Add `https://business.design-bakery.com/app-api/connectors/oauth/google/callback` to Google Cloud Console, add `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` for Zoom, and set `PHOENIX_COLLECTOR_ENDPOINT` (Arize Phoenix or Octo `/api/workspaces/<id>/otel/*`) to verify end-to-end live sync + trace waterfalls.

## Verification

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
.venv/bin/continuity validate --root "$PWD"
cd app && pnpm typecheck && pnpm test && pnpm lint
```

Stack: certified release train `3446a8024857afb84b7b51d044cefb400131fbf7`.
