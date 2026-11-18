# Current Handoff

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

The issue-log shape and lifecycle are defined by the installed OIO ontology. For issue, pull-request, commit, and checkpoint prose, use the pinned CGM human-sounding-writing module: open with a concrete problem and observed result, explain identifiers on first use, distinguish evidence from inference, and state one next action. Link long logs rather than pasting them; never include private absolute paths, credentials, or session cookies. Pull requests use the reader-first template and `Closes #N` only when merge completes the issue; otherwise use `Refs #N`.
<!-- pcm:issue-log-format:end -->

## State

Full ACS is merged through PR #8. The required `gates` check protects `main`. No application implementation has landed.

The owner has replaced CSV-first intake with authenticated exploration: teammates sign in using Google, use their own TinyFish and source sessions, and save durable collection plans in Octo. The accepted direction is in [COLLECTION-AND-TEAM-PLAN.md](docs/COLLECTION-AND-TEAM-PLAN.md) and [issue #9](https://github.com/Pukujan/relationship-intelligence/issues/9), which supersedes issues #2 and #3.

## Next atomic action

Application shell exists on `task/RI-0001-auth-app`: Google sign-in via Octo, workspace membership view, sources screen, 11 contract tests, and the app CI job. Next: merge the shell PR, then implement the TinyFish profile registration and durable collection-plan schema.

## TinyFish setup correction

The CLI-generated setup URL led to a TinyFish dashboard 404. Current documentation directs manual session setup through [TinyProfiles](https://agent.tinyfish.ai/profiles). The existing profile `prof_69098d3aaeb042ea` still reports no signed-in sites. Do not treat it as an authenticated collector session.

## Verification

```bash
python .github/scripts/oio_installer.py --target "$PWD" --check
python scripts/validate_planning.py
.venv/bin/continuity validate --root "$PWD"
```

Stack: certified release train `3446a8024857afb84b7b51d044cefb400131fbf7`.
