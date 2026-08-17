#!/usr/bin/env bash
# One-command deploy (deployment runbook §4). Orchestrates:
#   drain → rolling update → verification
#
# Usage:
#   ./scripts/deploy.sh                 # deploy ghcr latest
#   IMAGE_TAG=<git-sha> ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [1/4] draining web node (stop new traffic)"
./scripts/drain-web.sh vaani-app 5 || true

echo "==> [2/4] rolling update"
./scripts/rolling-update.sh

echo "==> [3/4] migration check (idempotent)"
docker compose -f docker-compose.prod.yml exec -T web npx prisma migrate status || true

echo "==> [4/4] verification"
./scripts/deploy-verify.sh http://localhost:3000
echo "==> deploy complete"
