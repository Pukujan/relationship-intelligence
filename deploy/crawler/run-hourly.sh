#!/bin/sh
# Start one crawl pass, then wait. The server hands out at most the day's
# remaining cap (40 profiles a day) and returns a cooldown for 24 hours after
# any block, so retrying every hour never adds pressure on LinkedIn. A pass that
# fails (browser not reachable, not signed in) also just waits for the next hour.
# Each pass then reads changed LinkedIn DM threads when RI_DM_TOKEN is set.
set -u
INTERVAL="${RI_CRAWL_INTERVAL_SECONDS:-3600}"
while true; do
  echo "[$(date -u +%FT%TZ)] crawl pass starting"
  ./node_modules/.bin/tsx src/crawl.ts loop || echo "[$(date -u +%FT%TZ)] crawl pass ended with an error; retrying in ${INTERVAL}s"
  # LinkedIn DMs (#120): only when the owner has set RI_DM_TOKEN.
  if [ -n "${RI_DM_TOKEN:-}" ]; then
    ./node_modules/.bin/tsx src/dms.ts || echo "[$(date -u +%FT%TZ)] DM pass ended with an error; retrying in ${INTERVAL}s"
  fi
  sleep "$INTERVAL"
done
