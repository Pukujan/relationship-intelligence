#!/bin/sh
# Discord DM import (#120): one pass every RI_DC_INTERVAL_SECONDS (default 15
# minutes). With no DISCORD_USER_TOKEN or RI_DM_TOKEN a pass does nothing.
set -u
INTERVAL="${RI_DC_INTERVAL_SECONDS:-900}"
while true; do
  ./node_modules/.bin/tsx src/discord.ts once || echo "[$(date -u +%FT%TZ)] Discord pass ended with an error; retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done
