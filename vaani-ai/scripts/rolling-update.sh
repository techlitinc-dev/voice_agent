#!/usr/bin/env bash
# Rolling deploy with zero downtime (deployment runbook §4.2).
#
# With a single `app` service in docker-compose.prod.yml, "rolling" means:
#   1. pull the new image (IMAGE_TAG env or :latest)
#   2. run migrations against the running DB (migrations are additive)
#   3. recreate the app container
#   4. wait for /api/health/ready
#   5. roll back to the previous tag automatically on failure
#
# With `--scale app=N` (docker-compose.scale.yml) the compose `up -d` recreates
# containers one at a time; this script still gates each stage on health.
#
# Usage: IMAGE_TAG=<sha> ./scripts/rolling-update.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"
TAG="${IMAGE_TAG:-latest}"
IMAGE="ghcr.io/techlitinc-dev/voice_agent/vaani-web:${TAG}"
PREV_TAG="$(docker inspect --format '{{.Config.Image}}' vaani-app 2>/dev/null || echo "")"

echo "==> pulling ${IMAGE}"
docker pull "$IMAGE" || { echo "pull failed — aborting (no change made)"; exit 1; }

echo "==> running migrations (additive — safe against the running app)"
docker compose -f docker-compose.prod.yml run --rm -T web npx prisma migrate deploy

echo "==> recreating app with ${IMAGE}"
export IMAGE_TAG="$TAG"
$COMPOSE up -d --no-deps app

echo "==> waiting for readiness"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health/ready >/dev/null 2>&1; then
    echo "app healthy after ${i} checks ✓"
    break
  fi
  [ "$i" -eq 30 ] && {
    echo "!! health check failed — rolling back to ${PREV_TAG:-previous image}"
    [ -n "$PREV_TAG" ] && docker tag "$PREV_TAG" "$IMAGE" 2>/dev/null || true
    $COMPOSE up -d --no-deps app
    exit 1
  }
  sleep 3
done

echo "==> post-deploy smoke"
BASE_URL=http://localhost:3000 SMOKE_PROFILE=prod ./scripts/smoke-test.sh
echo "==> deploy ok (${TAG})"
