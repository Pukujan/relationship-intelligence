# Current Handoff

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

The issue-log shape and lifecycle are defined by the installed OIO ontology. For issue, pull-request, commit, and checkpoint prose, use the pinned CGM human-sounding-writing module: open with a concrete problem and observed result, explain identifiers on first use, distinguish evidence from inference, and state one next action. Link long logs rather than pasting them; never include private absolute paths, credentials, or session cookies. Pull requests use the reader-first template and `Closes #N` only when merge completes the issue; otherwise use `Refs #N`.
<!-- pcm:issue-log-format:end -->

## State (2026-11-20, `main` at `4d33a09`)

Production is live at `https://business.design-bakery.com/console/` from `octo-vps`; Komodo autodeploy is registered (`Pukujan-lab/server-management#98` merged), so merges to `main` deploy without manual steps (observed with #81):
- **PR #58–#61:** Sidebar collapsed to five daily surfaces; Voice page listens and speaks with browser speech; Agents page lists installed agents and stops duplicate installs (#61 fixes the saved install shape; 34 tests at that point).
- **PR #63–#68:** Model providers reached through the Octo vault with Claude in the chain; copilot server runs in production behind a signed-in proxy; copilot closed to accounts with no workspace and to personal-workspace guests.
- **PR #70–#75:** Talk and the call hold live-model conversations; the owner's relationship records imported and sample people retired (#72); canonical people/companies/private claims scoped per workspace and principal (#74); VPS speech-gateway (Parakeet STT + Kokoro/Pocket-TTS) wired into Voice (#75).
- **PR #76–#77:** Persistent bottom-right voice + chat dock with animated agent cursor and UI actuation; Today decisions/moves/cold list scoped to the active project.
- **PR #81 (#80 closed):** Seeded copilot asks open a fresh person-scoped draft thread instead of appending to the active thread; `/copilot` gets a bounded pane so the message list scrolls; 12/12 headless checks, re-run against production guest mode after deploy.
- **PR #79, #82:** People directory and RAG grounded in sourced ledger evidence; events and where-we-met attendees read from the ledger.

Open: #49 (live Zoom test + installed-agent execution gap; Gmail/Calendar sync observed live by the owner 2026-11-20 19:14), #83 (RI-0021, owner-directed 2026-11-20), #78/#73/#62 pending live closure, #15/#12/#9 (collection program). Evidence labels: test counts and deploy bundle markers measured; a fresh Phoenix read-back was not possible from the owner's Mac today (Cloudflare challenge on the public hostname, SSH publickey denied, tailnet :6006 unreachable) — inference: spans exist server-side because #56 verified export, but today's waterfall is unobserved.

## Next atomic action

1. **#83 connector OAuth wiring:** ship Slack/Calendly/Discord/Zoom OAuth + collection slice 2; owner supplies `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` on `octo-vps`; then run the live Zoom sync and attach evidence to #49.
2. **Phoenix read-back:** inspect `connector.sync.*` waterfalls from an owner Phoenix session or on the VPS; attach to #49.
3. **Agent execution owner:** decide who builds installed-agent execution (the scheduler currently only queues runs).
4. **Live closures:** owner checks on the deployed console, then close #78, #73, #62.

## Verification

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
cd app && pnpm typecheck && pnpm test && pnpm lint
```

(`.venv/bin/continuity` is not installed on the owner's Mac as of 2026-11-20; the CI "Planning, ontology, and continuity" gate covers it.)

Stack: certified release train `3446a8024857afb84b7b51d044cefb400131fbf7`.
