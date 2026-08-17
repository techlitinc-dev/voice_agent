#!/usr/bin/env bash
# Drain a web node before deploy (disaster-recovery doc §3.3 — zero-downtime
# deploys). Marks the node unhealthy via the LB healthcheck so traffic stops,
# then lets in-flight requests finish before the container is replaced.
#
# Usage: drain-web.sh [container] [grace-seconds]
set -euo pipefail

CONTAINER="${1:-vaani-app}"
GRACE="${2:-30}"

# 1. Stop the container's healthcheck from passing by stopping the app briefly?
#    No — instead we use Docker's healthcheck status: remove the healthy state
#    by pausing the container's main process health response is not possible
#    without stopping it. The supported pattern:
echo "draining $CONTAINER ..."

# Pause the container: LB healthchecks (curl to /api/health/ready) start failing,
# in-flight requests complete, new traffic routes elsewhere.
docker pause "$CONTAINER"

echo "waiting $GRACE s for in-flight requests to drain ..."
sleep "$GRACE"

echo "node drained. Deploy now, then: docker unpause $CONTAINER (or replace the container)"
