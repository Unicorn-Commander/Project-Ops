#!/bin/bash
# Deploy Project Ops to the host this script is run on.
# Reads infrastructure/docker/.env for ${DOMAIN}, ${API_DOMAIN}, etc.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

if [ ! -f "$PROJECT_DIR/infrastructure/docker/.env" ]; then
  echo "ERROR: $PROJECT_DIR/infrastructure/docker/.env is missing." >&2
  echo "Copy .env.example and fill in real values before deploying." >&2
  exit 1
fi

# Load DOMAIN/API_DOMAIN for the final summary
set -a
. "$PROJECT_DIR/infrastructure/docker/.env"
set +a

echo "=== Project Ops Deployment ==="
echo "DOMAIN=${DOMAIN:-?}"
echo "API_DOMAIN=${API_DOMAIN:-?}"
echo ""

echo "1. Building + starting all containers..."
cd "$PROJECT_DIR/infrastructure/docker"
docker compose up -d --build

echo ""
echo "2. Waiting for backend to become healthy..."
for i in {1..30}; do
  status=$(docker inspect -f '{{.State.Health.Status}}' project-ops-backend 2>/dev/null || echo missing)
  if [ "$status" = "healthy" ]; then break; fi
  sleep 2
done
docker compose ps

echo ""
echo "3. Applying Prisma schema (db push) ..."
docker exec project-ops-backend npx prisma db push --skip-generate --accept-data-loss

echo ""
echo "=== Deployment Complete ==="
echo "Frontend: https://${DOMAIN:-?}"
echo "API:      https://${API_DOMAIN:-?}"
