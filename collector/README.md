# Collector proof (slice 1)

The cheapest experiment from [COLLECTION-EXECUTION.md](../docs/COLLECTION-EXECUTION.md):
does a persistent local browser profile keep a LinkedIn session across a
full process restart, from a residential connection, without a
re-authentication challenge?

This is a proof, not the daemon. No pairing, no localhost API, no plan
execution. If it passes, slice 2 builds the real contract on top.

## Run

```bash
pnpm install --store-dir "$HOME/Library/pnpm/store"
PLAYWRIGHT_BROWSERS_PATH=/tmp/ri-daemon-proof/browsers pnpm exec playwright install chromium

pnpm signin   # opens a browser window; a human signs into LinkedIn manually
pnpm fetch    # one read-only visit to the signed-in user's own profile
pnpm check    # fresh process: did the session survive the restart?
```

Each command is a separate process against the same profile directory, so
`check` after `fetch` is a genuine restart test.

## Where the data lives

Everything sensitive stays outside the repository, under
`/tmp/ri-daemon-proof` (override with `RI_PROOF_ROOT`):

- `profile/` — the persistent browser profile, including live session
  cookies. Created with mode 0700. Never commit it, back it up, or sync it.
- `evidence/` — JSON results and one viewport screenshot per fetch. Mode
  0600/0700. The screenshot shows the signed-in user's own profile; treat
  it as personal data and do not attach it to public issues.
- `browsers/` — the Playwright Chromium build.

`/tmp` is deliberate for the proof: it is wiped on reboot, so a live
session does not linger on the machine after the experiment. The real
daemon will choose a durable, permission-restricted location.

## Boundaries

- A human signs in manually. This code never sees a password or one-time
  code.
- Read-only: navigation to the login page, the user's own profile, and the
  feed. No scrolling, clicking, connecting, or messaging.
- No stealth flags and no challenge bypass. If LinkedIn presents a
  checkpoint, that is recorded as evidence, not worked around.
- Results are reported as `RESULT {json}` lines and saved under
  `evidence/`.
