#!/bin/sh
# Start one crawl pass, then wait. The server hands out at most the day's
# remaining cap (40 profiles a day) and returns a cooldown for 24 hours after
# any block, so retrying every hour never adds pressure on LinkedIn. A pass that
# fails (browser not reachable, not signed in) also just waits for the next hour.
set -u
INTERVAL="${RI_CRAWL_INTERVAL_SECONDS:-3600}"
while true; do
  echo "[$(date -u +%FT%TZ)] crawl pass starting"
  ./node_modules/.bin/tsx src/crawl.ts loop || echo "[$(date -u +%FT%TZ)] crawl pass ended with an error; retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done
