#!/bin/bash
set -e

echo "=== Project Ops Deployment ==="
echo ""

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)

echo "1. Starting infrastructure..."
cd infrastructure/docker
docker compose up -d project-ops-postgres project-ops-redis project-ops-minio
echo "Waiting for services to be healthy..."
sleep 10

echo ""
echo "2. Running Prisma migrations..."
cd "$PROJECT_DIR/backend"
npx prisma migrate deploy

echo ""
echo "3. Seeding database..."
npx prisma db seed

echo ""
echo "4. Starting application..."
cd "$PROJECT_DIR/infrastructure/docker"
docker compose up -d --build project-ops-backend project-ops-frontend

echo ""
echo "5. Checking service health..."
sleep 15
docker compose ps

echo ""
echo "=== Deployment Complete ==="
echo "Frontend: https://projectops.unicorncommander.ai"
echo "Backend: https://api.projectops.unicorncommander.ai"
echo ""
echo "To register in Ops-Center, run:"
echo "  docker exec ops-center-db psql -U ops_center -d ops_center -f /tmp/ops-center-register.sql"
