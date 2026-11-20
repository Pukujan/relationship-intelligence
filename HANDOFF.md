# Current Handoff

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

The issue-log shape and lifecycle are defined by the installed OIO ontology. For issue, pull-request, commit, and checkpoint prose, use the pinned CGM human-sounding-writing module: open with a concrete problem and observed result, explain identifiers on first use, distinguish evidence from inference, and state one next action. Link long logs rather than pasting them; never include private absolute paths, credentials, or session cookies. Pull requests use the reader-first template and `Closes #N` only when merge completes the issue; otherwise use `Refs #N`.
<!-- pcm:issue-log-format:end -->

## State (2026-11-20, `main` at `a180d0f`)

Production is live at `https://business.design-bakery.com/console/` from `octo-vps` (`relationship-intelligence:a180d0fb697e` + `business-ri-cloudflared` on `study-os_edge`; local Mac adapter and tunnel stopped):
- **PR #44 & PR #45 (#37–#42 / RI-0012..RI-0017, closed):** Single `resolveTenancy` choke, role gates (`owner > admin > operator > member`), atomic `409` double-decide idempotency, UX research memo (`docs/RESEARCH-UX.md`), Approval Do/Don't triage (`stop | re_plan | snooze`), Glance 3-move agenda (`I7`), and 1-hop intro paths on `PersonProfile.tsx`.
- **PR #46 & PR #51 (#48 closed, #49 open for live OAuth test, #50 closed):** Single-Octo Slack-like workspace model (`ri_console.workspace`, `workspace_member`, `project_member`, `organization`, `app_user`; zero `OCTO_ACCOUNT_KEY`), user-level Google/Zoom connectors + routing rules + sync workers, 4 starter agent templates, custom agent builder, Zone 3 Draft Plans → Lock (`409 ALREADY_LOCKED`), and `ri_console.ledger_event`.
- **PR #53, #54, #55 (VPS + Komodo cutover):** Resolved `consoleDist` via `import.meta.url` in `app/server/adapter.ts`, bound `0.0.0.0` in production in `app/server/dev.ts`, switched `Dockerfile` to `tsx` + `--config.strict-dep-builds=false`, and added `deploy/docker-compose.vps.yml` + `deploy/vps/autodeploy.sh`. Opened `Pukujan-lab/server-management#98` to register the Komodo stack and 5-minute auto-deploy action.
- **PR #56 (#50 / RI-0020, closed):** Upgraded `app/server/telemetry.ts` to zero-dep OTLP/HTTP `application/x-protobuf` with automatic Bearer auth (`PHOENIX_API_KEY` or `OCTO_API_KEY`), cleared all 3 Biome warnings, enabled `PHOENIX_COLLECTOR_ENDPOINT` on `octo-vps` (`/app-api/config` returns `phoenixConfigured: true`), and verified live span export + read-back in Octo Phoenix (`https://octodb.design-bakery.com/phoenix/projects/UHJvamVjdDoyMA==`).

All 20 completed GitHub issues (`#2`–`#7`, `#18`, `#23`–`#27`, `#37`–`#42`, `#48`, `#50`) are closed. `29/29` Vitest tests, `pnpm typecheck`, Biome lint (0 errors, 0 warnings), `console` build, and live VPS tenancy suite (`7 pass, 0 red, 4 skip`) all pass.

## Next atomic action

1. **Merge & sync Komodo PR:** Merge `Pukujan-lab/server-management#98` and click **Sync** in Komodo (`http://octo-vps:9120`) so future `main` merges auto-deploy via `deploy/vps/autodeploy.sh`.
2. **Verify live Google/Zoom connector OAuth (`#49`):** Add `https://business.design-bakery.com/app-api/connectors/oauth/google/callback` to Google Cloud OAuth client (project `47218074770`), run a live Gmail/Calendar/Drive sync in `https://business.design-bakery.com/console/integrations/connectors`, inspect the trace in Octo Phoenix, and close `#49`.

## Verification

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
.venv/bin/continuity validate --root "$PWD"
cd app && pnpm typecheck && pnpm test && pnpm lint
```

Stack: certified release train `3446a8024857afb84b7b51d044cefb400131fbf7`.
