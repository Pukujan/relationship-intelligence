# Current Continuity State

<!-- continuity:current {"active_task":"RI-0002","active_task_file":"tasks/TASK-RI-0002-console-product.md","protocol_version":"0.1.0-draft","schema":"project-continuity.current.v1"} -->

- Active issue: [Pukujan/relationship-intelligence#18](https://github.com/Pukujan/relationship-intelligence/issues/18)
- Active branch: `task/RI-0002-console-prototype`
- Primary writer: `dsh-lead`
- Parent program: [issue #1](https://github.com/Pukujan/relationship-intelligence/issues/1)
- Status: console product defined (goal, trust-layer operating model, UX map) in docs/CONSOLE.md; ABA console prototype restructured and preserved in console/ (builds locally); local collection execution proven (#15). Copilot is still a seeded simulation.
- Next action: build the intelligence layer (real orchestrator + research/design mode held for approval + deadline/iteration loop + signal layer), then wire the data layer to Octo and integrate the console into app/ behind Octo sign-in.
- Migration note: console prototype + screenshots are committed here; the ABA install and run env live on the VPS (`octo-vps`), reached over Tailscale/SSH as a machine. Octo's API is `https://octodb.design-bakery.com` with the workspace key from `.env` — never over Tailscale/SSH; traces and evals are Octo capabilities (`/api/workspaces/<id>/otel/*`), not a separate collector to find. New MacBook (`pujans-macbook-air`) needs Remote Login enabled before DSH model setup.
