#!/bin/sh
# Telegram DM import (#120): one pass every RI_TG_INTERVAL_SECONDS (default 15
# minutes). A pass with no session or no RI_DM_TOKEN does nothing, so the
# service can sit idle until the owner signs in once with "login".
set -u
INTERVAL="${RI_TG_INTERVAL_SECONDS:-900}"
while true; do
  ./node_modules/.bin/tsx src/telegram.ts once || echo "[$(date -u +%FT%TZ)] Telegram pass ended with an error; retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done
