# Current Continuity State

<!-- continuity:current {"active_task":"RI-0002","active_task_file":"tasks/TASK-RI-0002-console-product.md","protocol_version":"0.1.0-draft","schema":"project-continuity.current.v1"} -->

- Active issues: [#49 (RI-0019)](https://github.com/Pukujan/relationship-intelligence/issues/49) open — the live Zoom connector test and the installed-agent execution gap remain; Gmail/Calendar live sync observed by the owner 2026-11-20. [#83 (RI-0021)](https://github.com/Pukujan/relationship-intelligence/issues/83) open — owner-directed connector OAuth wiring + consent-gated runner. [#78](https://github.com/Pukujan/relationship-intelligence/issues/78), [#73](https://github.com/Pukujan/relationship-intelligence/issues/73), [#62](https://github.com/Pukujan/relationship-intelligence/issues/62) open pending live closure (fixes merged as #77, #74, #63). (closed: `#2`–`#7`, `#14`, `#18`, `#23`–`#27`, `#37`–`#42`, `#48`, `#50`, `#80`)
- Active branch: `main` (`4d33a09`, PRs #58–#82 merged)
- Primary writer: `dsh-lead`
- Parent program: [issue #1](https://github.com/Pukujan/relationship-intelligence/issues/1)
- Status:
  - Production live at `https://business.design-bakery.com/console/` on `octo-vps`; Komodo GitOps registered (`Pukujan-lab/server-management#98` merged 2026-11-20) so `main` merges auto-deploy via `deploy/vps/autodeploy.sh` (observed: #81's bundle live within minutes of merge).
  - Copilot seeded-ask thread entry and `/copilot` pane height fixed and live (#81; #80 closed after 12/12 headless checks against production guest mode).
  - OTLP/HTTP `application/x-protobuf` tracing with Bearer auth live (#56); connector sync spans are `connector.sync.<provider>` (`app/server/sync.ts`). Read-back from the owner's Mac on 2026-11-20 was blocked (public Phoenix hostname behind a Cloudflare challenge; SSH publickey denied; tailnet :6006 unreachable) — needs an owner Phoenix session or a VPS-side check.
  - App suite `56/56` Vitest (8 files, run 2026-11-20 19:57 local); console machine contracts, `pnpm typecheck`, eslint (0 errors), and `console` build green on #81.
- Next action:
  1. #83: wire Slack/Calendly/Discord/Zoom OAuth and collection slice 2; owner adds `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` on `octo-vps`; then run the live Zoom test for #49.
  2. Read back `connector.sync.*` spans in Octo Phoenix from an owner session or on the VPS; attach the waterfall to #49.
  3. Assign an owner for installed-agent execution (the scheduler only queues runs; noted on #49 on 2026-11-20).
  4. Live-close #78, #73, #62 after owner checks on the deployed console.
- Migration note: Octo's API is `https://octodb.design-bakery.com` with single container `OCTO_WORKSPACE_ID` + `OCTO_API_KEY` + `PHOENIX_COLLECTOR_ENDPOINT` in `~/apps/relationship-intelligence.env` on `octo-vps`.
