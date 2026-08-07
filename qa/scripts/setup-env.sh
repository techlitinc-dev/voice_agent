#!/usr/bin/env bash
# =============================================================================
# setup-env.sh — deterministic environment bootstrap for the test suite.
# Idempotent. Zero human intervention. Fails hard (exit 2) on missing infra.
# =============================================================================
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QA_DIR="$REPO_ROOT/qa"

log() { printf '[setup] %s\n' "$*"; }

# ------------------------------------------------------------------ 1. deps
for cmd in node npm docker jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "MISSING_BIN:$cmd"; exit 2
  fi
done
log "toolchain present (node/npm/docker/jq/curl)"

# ------------------------------------------------------------------ 2. vaani-ai install
if [[ ! -d "$REPO_ROOT/vaani-ai/node_modules" ]]; then
  log "installing vaani-ai deps..."
  (cd "$REPO_ROOT/vaani-ai" && npm ci --no-audit --no-fund) || { echo "NPM_CI_FAILED"; exit 2; }
else
  log "vaani-ai node_modules present"
fi

# ------------------------------------------------------------------ 3. dograh python env
if [[ ! -d "$REPO_ROOT/dograh/.venv" ]]; then
  log "creating dograh venv..."
  (cd "$REPO_ROOT/dograh" && python3 -m venv .venv) || { echo "VENV_FAILED"; exit 2; }
fi
log "dograh venv present"

# ------------------------------------------------------------------ 4. env files (never overwrite real secrets)
for pair in "vaani-ai/.env:.env.example" "dograh/api/.env.test:.env.test.example"; do
  dst="$REPO_ROOT/${pair%%:*}"; src="$REPO_ROOT/${pair%%:*}/$(dirname "$dst")/${pair##*:}"
  # simpler: resolve explicitly
done
[[ -f "$REPO_ROOT/vaani-ai/.env" ]] || { echo "MISSING:vaani-ai/.env (copy from .env.example and fill DOGRAH_* + SESSION_SECRET)"; exit 2; }
[[ -f "$REPO_ROOT/dograh/api/.env.test" ]] || { echo "MISSING:dograh/api/.env.test (copy from .env.test.example)"; exit 2; }
log "env files present"

# ------------------------------------------------------------------ 5. vaani-ai infra (postgres/redis/minio)
VAANI_UP="$(docker compose -f "$REPO_ROOT/vaani-ai/docker-compose.yml" ps -q 2>/dev/null | wc -l)"
if [[ "$VAANI_UP" -lt 3 ]]; then
  log "starting vaani-ai infra (db/redis/minio)..."
  (cd "$REPO_ROOT/vaani-ai" && docker compose up -d) || { echo "VAANI_INFRA_FAILED"; exit 2; }
fi
log "vaani-ai infra up"

# ------------------------------------------------------------------ 6. dograh infra (postgres/redis/minio on same host)
# Dograh tests need a test_db on the same postgres. Postgres 16 from vaani compose
# is fine; create test_db if missing. Dev compose uses container_name vaani-db-dev.
DEV_DB=vaani-db-dev
DEV_REDIS=vaani-redis-dev

for i in $(seq 1 30); do
  docker exec "$DEV_DB" pg_isready -U vaani -d vaani >/dev/null 2>&1 && break
  sleep 2
  [[ $i -eq 30 ]] && { echo "DB_START_TIMEOUT"; exit 2; }
done

docker exec "$DEV_DB" psql -U vaani -d vaani -tc "SELECT 1 FROM pg_database WHERE datname='test_db'" | grep -q 1 \
  || docker exec "$DEV_DB" psql -U vaani -d postgres -c "CREATE DATABASE test_db" \
  || { echo "TEST_DB_CREATE_FAILED"; exit 2; }
log "dograh test_db present on vaani-db-dev postgres"

# ------------------------------------------------------------------ 7. wait for health
for i in $(seq 1 30); do
  docker exec "$DEV_DB" pg_isready -U vaani -d vaani >/dev/null 2>&1 \
    && docker exec "$DEV_REDIS" redis-cli ping 2>/dev/null | grep -q PONG \
    && curl -sf "http://localhost:9000/minio/health/live" >/dev/null 2>&1 \
    && break
  sleep 2
  [[ $i -eq 30 ]] && { echo "INFRA_TIMEOUT"; exit 2; }
done
log "infra healthy"

# ------------------------------------------------------------------ 8. prisma migrate + generate
log "prisma migrate + generate..."
(cd "$REPO_ROOT/vaani-ai" && npx prisma migrate deploy && npx prisma generate) || { echo "PRISMA_FAILED"; exit 2; }
log "prisma schema applied"

echo "SETUP_OK"
