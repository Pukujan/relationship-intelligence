#!/bin/sh
# Container entry point: the copilot server on loopback, the adapter in front.
#
# The copilot server is restarted if it exits, so a crash costs a few seconds
# of model answers and not the whole site: while it is down the adapter answers
# /api/* with 502 and the console uses its offline router.
set -eu

# The copilot server needs the same Octo credentials as the adapter for RAG.
OCTO_ENV_FILE=${OCTO_ENV_FILE:-app/.env}
(
  while true; do
    node --env-file-if-exists="$OCTO_ENV_FILE" console/server/index.ts || true
    echo "copilot server exited; restarting in 2s"
    sleep 2
  done
) &

exec ./app/node_modules/.bin/tsx --env-file-if-exists="$OCTO_ENV_FILE" app/server/dev.ts
