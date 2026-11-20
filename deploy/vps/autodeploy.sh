#!/usr/bin/env bash
# Deploy origin/main to octo-vps. Komodo's relationship-intelligence stack runs
# this as its pre-deploy, building main as relationship-intelligence:<12-char sha>,
# swapping the container, waiting for its health check, and rolling back on failure.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
OWNER="$(stat -c %U "$REPO_DIR")"
COMPOSE=(docker compose -f "$DEPLOY_DIR/docker-compose.vps.yml")

git_() {
  if [ "$(id -un)" = "$OWNER" ]; then git -C "$REPO_DIR" "$@"
  else sudo -u "$OWNER" git -C "$REPO_DIR" "$@"; fi
}

write_image() { printf 'RI_IMAGE=%s\n' "$1" > "$DEPLOY_DIR/.env"; }

git_ fetch --quiet origin main
SHA="$(git_ rev-parse origin/main)"
TAG="relationship-intelligence:${SHA:0:12}"
RUNNING="$(docker inspect relationship-intelligence --format '{{.Config.Image}}' 2>/dev/null || true)"

if [ "$RUNNING" = "$TAG" ]; then
  echo "relationship-intelligence already runs main ($TAG)"
  write_image "$TAG"
  exit 0
fi

if [ "$(cat "$DEPLOY_DIR/.deploy-failed" 2>/dev/null)" = "$SHA" ]; then
  echo "main ${SHA:0:12} failed to deploy before; keeping ${RUNNING:-nothing} (delete deploy/.deploy-failed to retry)"
  write_image "${RUNNING:-$TAG}"
  exit 0
fi

echo "main is ${SHA:0:12}, running ${RUNNING:-nothing}: deploying"
git_ checkout --quiet --detach "$SHA"
RI_IMAGE="$TAG" "${COMPOSE[@]}" build web
RI_IMAGE="$TAG" "${COMPOSE[@]}" up -d web

for _ in $(seq 1 30); do
  STATUS="$(docker inspect relationship-intelligence --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  if [ "$STATUS" = "healthy" ]; then
    echo "relationship-intelligence is healthy ($TAG)"
    rm -f "$DEPLOY_DIR/.deploy-failed"
    write_image "$TAG"
    exit 0
  fi
  sleep 2
done

echo "relationship-intelligence failed health check; rolling back to ${RUNNING:-none}"
printf '%s\n' "$SHA" > "$DEPLOY_DIR/.deploy-failed"
if [ -n "$RUNNING" ]; then
  RI_IMAGE="$RUNNING" "${COMPOSE[@]}" up -d web
  write_image "$RUNNING"
fi
exit 1
