# Current Continuity State

<!-- continuity:current {"active_task":"RI-0002","active_task_file":"tasks/TASK-RI-0002-console-product.md","protocol_version":"0.1.0-draft","schema":"project-continuity.current.v1"} -->

- Active issues: [#49 (RI-0019)](https://github.com/Pukujan/relationship-intelligence/issues/49) (closed: `#2`–`#7`, `#14`, `#18`, `#23`–`#27`, `#37`–`#42`, `#48`, `#50`)
- Active branch: `main` (`a180d0f`, PRs #44–#46, #51–#56 merged)
- Primary writer: `dsh-lead`
- Parent program: [issue #1](https://github.com/Pukujan/relationship-intelligence/issues/1)
- Status:
  - Production live at `https://business.design-bakery.com/console/` on `octo-vps` (`relationship-intelligence:a180d0fb697e` + `business-ri-cloudflared` on `study-os_edge`; local Mac adapter and tunnel stopped; #53–#55).
  - Komodo GitOps registration open in `Pukujan-lab/server-management#98`; `deploy/vps/autodeploy.sh` verified end-to-end on `octo-vps`.
  - OTLP/HTTP `application/x-protobuf` tracing with Bearer auth live on `octo-vps` (`phoenixConfigured: true`, span export + read-back verified in Octo Phoenix; #56).
  - `29/29` Vitest tests, `pnpm typecheck`, Biome lint (0 errors, 0 warnings), and live VPS tenancy suite (`7 pass, 0 red, 4 skip`) all pass.
- Next action:
  1. Merge `Pukujan-lab/server-management#98` and sync Komodo (`http://octo-vps:9120`).
  2. Add `https://business.design-bakery.com/app-api/connectors/oauth/google/callback` to Google Cloud OAuth client (project `47218074770`), verify live connector sync + Phoenix trace waterfall, and close `#49`.
- Migration note: Octo's API is `https://octodb.design-bakery.com` with single container `OCTO_WORKSPACE_ID` + `OCTO_API_KEY` + `PHOENIX_COLLECTOR_ENDPOINT` in `~/apps/relationship-intelligence.env` on `octo-vps`.
