# Current Handoff

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

The issue-log shape and lifecycle are defined by the installed OIO ontology. For issue, pull-request, commit, and checkpoint prose, use the pinned CGM human-sounding-writing module: open with a concrete problem and observed result, explain identifiers on first use, distinguish evidence from inference, and state one next action. Link long logs rather than pasting them; never include private absolute paths, credentials, or session cookies. Pull requests use the reader-first template and `Closes #N` only when merge completes the issue; otherwise use `Refs #N`.
<!-- pcm:issue-log-format:end -->

## State

The console is now the defined product surface. The goal, trust-layer operating model, and UX map are recorded in [CONSOLE.md](docs/CONSOLE.md) and [PROJECT.md](PROJECT.md), filed as [issue #18](https://github.com/Pukujan/relationship-intelligence/issues/18). An ABA-generated console prototype lives in `console/` (React + Vite + shadcn): the restructure pass passed its build gate and produced the grouped nav, the Project→Objective→Mission→Plan hierarchy, sign-in/guest, and connectors/MCP/plugins. It runs on seed data behind one swappable data layer; the copilot is still a designed simulation, not a live model.

Local collection execution is proven ([issue #15](https://github.com/Pukujan/relationship-intelligence/issues/15), [COLLECTION-EXECUTION.md](docs/COLLECTION-EXECUTION.md)): a real browser profile attached over CDP keeps a LinkedIn session across a restart, while a test build cannot. The app build script was fixed so CI actually runs it ([issue #14](https://github.com/Pukujan/relationship-intelligence/issues/14)). The earlier authenticated shell (Google sign-in via Octo, workspace list, sources screen) is merged in `app/`.

## Next atomic action

Build the intelligence layer on the console: a real orchestrator plus a research/design mode that proposes a mission name, objective, and plan held for approval, the deadline/iteration loop, and the signal layer. Then wire the swappable data layer to Octo (workspace `social-engineering`) and integrate the console into `app/` behind Octo sign-in. Migration note: the console prototype and preview screenshots are committed in this repo; the ABA install and run env live on the VPS (`octo-vps`), which is a machine reached over Tailscale/SSH for administration. Octo itself is not reached that way: the platform API is `https://octodb.design-bakery.com` (`OCTO_API_URL` in `.env`), authenticated with the workspace key in `.env` (`OCTO_API_KEY`). Traces, eval scores, RAG, graph, and SQL are all capabilities of that same API — see "Reaching Octo" in `AGENTS.md`.

## TinyFish setup correction

The CLI-generated setup URL led to a TinyFish dashboard 404. Current documentation directs manual session setup through [TinyProfiles](https://agent.tinyfish.ai/profiles). The existing profile `prof_69098d3aaeb042ea` still reports no signed-in sites. Do not treat it as an authenticated collector session.

## Verification

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
.venv/bin/continuity validate --root "$PWD"
```

Stack: certified release train `3446a8024857afb84b7b51d044cefb400131fbf7`.
