#!/usr/bin/env bash
# =============================================================================
# SUITE-IDENTITY §9 — RLS workspace-isolation: full local bring-up + run.
# =============================================================================
#
# Provisions a THROWAWAY Postgres in Docker on a NON-default port (so it never
# collides with a real local Postgres / another project's container), applies the
# documented db-push-managed bring-up (prisma db push as superuser -> the
# tenancy migrations' SQL by hand -> seeds), then runs the §9 and invitation/public-user acceptance tests as
# the NOBYPASSRLS role `project_ops_app`.
#
# Run from the backend/ directory:
#     bash tests/integration/rls/run.sh
#
# All paths below are relative to backend/. The container is force-removed on
# EXIT (success, failure, or Ctrl-C) by the teardown trap.
#
# Requirements: docker + a populated node_modules (npx/ts-node/jest/prisma) in
# backend/. The orchestrator runs npm install separately.

set -euo pipefail

# --- Tunables ----------------------------------------------------------------
CONTAINER="${PO_RLS_CONTAINER:-po-rls-test}"  # throwaway container name (unlikely to clash)
# NON-default host port -> no 5432 collision. Env-overridable (PG_PORT) so a run
# never wedges when a sibling project already holds the default on this host.
PG_PORT="${PG_PORT:-55432}"
PG_PASSWORD="pw"
PG_DB="project_ops"
PG_IMAGE="postgres:17-alpine"

MIGRATIONS_DIR="prisma/migrations"
# The tenancy migrations, IN APPLY ORDER. Each is idempotent.
MIGRATIONS=(
  "20260603051046_suite_tenancy_rls_roles"   # roles, GUC chokepoint, RLS, bootstrap ws
  "20260609000000_phase2_tenancy_cols"       # triage/PAT cols + triage RLS
  "20260609120000_phase2_workspace_seed"     # rebrand MU + add GFL + memberships
  "20260610090000_mu_canonical_rekey"        # re-key MU bootstrap uuid -> suite-canonical (MO/CO-shared)
  "20260617000000_phase3_workspace_not_null" # tenanted workspaceId -> NOT NULL (PAT + audit_logs stay nullable)
  "20260916040000_manual_workspace_invitations" # invitation grants and constraints, also applied in CI
  "20261025000000_rls_for_db_push_tables"     # RLS for the 9 tables whose migrations also CREATE TABLE
)

# --- Teardown trap: always remove the throwaway container ---------------------
cleanup() {
  echo "[run.sh] Tearing down throwaway container '${CONTAINER}'..."
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 0. Pre-flight: refuse to clobber a pre-existing container of the same name
if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "[run.sh] Removing a stale '${CONTAINER}' container from a previous run..."
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
fi

# --- 1. Start the throwaway Postgres -----------------------------------------
echo "[run.sh] Starting throwaway Postgres (${PG_IMAGE}) on host port ${PG_PORT}..."
docker run -d \
  --name "${CONTAINER}" \
  -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
  -e POSTGRES_DB="${PG_DB}" \
  -p "${PG_PORT}:5432" \
  "${PG_IMAGE}" >/dev/null

echo -n "[run.sh] Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -U postgres -d "${PG_DB}" >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  echo -n "."
  sleep 1
  if [ "${i}" -eq 60 ]; then
    echo
    echo "[run.sh] ERROR: Postgres did not become ready in time." >&2
    docker logs "${CONTAINER}" >&2 || true
    exit 1
  fi
done

# --- 2. Owner/admin URL (superuser) for db push + migrations + seeds ----------
#   prisma db push and the seeds run as the BYPASSRLS owner (here: the postgres
#   superuser). This is the app's normal DATABASE_URL posture (owner/admin).
export DATABASE_URL="postgresql://postgres:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}?schema=public"

# --- 3. Create the schema as superuser (db-push managed; no _prisma_migrations)
echo "[run.sh] prisma db push (creating schema as superuser)..."
npx prisma db push --skip-generate

# --- 4. Apply the four RLS migrations' SQL BY HAND, in order -------------------
#   The migrations contain DO $$ ... $$ blocks; piping the file into psql via
#   `docker exec -i` preserves dollar-quoting. ON_ERROR_STOP aborts on a real
#   error (the migrations are guarded/idempotent, so re-applying is safe).
for m in "${MIGRATIONS[@]}"; do
  file="${MIGRATIONS_DIR}/${m}/migration.sql"
  if [ ! -f "${file}" ]; then
    echo "[run.sh] ERROR: missing migration ${file}" >&2
    exit 1
  fi
  echo "[run.sh] Applying migration: ${m}"
  docker exec -i "${CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U postgres -d "${PG_DB}" -f - < "${file}"
done

# --- 5. Seed: base users -> phase2 workspaces/memberships -> §9 fixtures -------
#   prisma:seed   = ts-node prisma/seed.ts                  (users + legacy data)
#   seed:phase2   = ts-node scripts/seed-phase2-tenancy.ts  (workspaces + members)
#   the §9 fixtures (this dir) plant 2 projects + 1 task per workspace and pin the
#   keycloakId-keyed memberships the §9 Invariant-5 JOIN reads.
echo "[run.sh] Seeding base users (prisma:seed)..."
npm run prisma:seed

echo "[run.sh] Seeding phase2 workspaces + memberships (seed:phase2)..."
npm run seed:phase2

echo "[run.sh] Seeding §9 RLS fixtures (projects/tasks/memberships)..."
npx ts-node tests/integration/rls/seed-rls-fixtures.ts

# --- 6. App (NOBYPASSRLS) URL for the test ------------------------------------
#   project_ops_app's dev password is set to 'verify_app' by the rls_roles
#   migration (CREATE/ALTER ROLE ... PASSWORD 'verify_app'). The §9 test connects
#   as THIS role; its beforeAll guard fails loudly if the role is BYPASSRLS/super.
export PROJECT_OPS_APP_DATABASE_URL="postgresql://project_ops_app:REMOVED@localhost:${PG_PORT}/${PG_DB}?schema=public"

# --- 7. Run the §9 acceptance test --------------------------------------------
echo "[run.sh] Running §9 RLS workspace-isolation test..."
npx jest --config ./tests/jest-integration.json \
  tests/integration/rls/workspace-isolation.integration.test.ts

echo "[run.sh] §9 RLS test PASSED."

# Auth changes must also pass the HTTP invitation and public-user suites that
# CI runs separately. Reuse ONLY this throwaway database, never live services.
export INVITATION_ADMIN_DATABASE_URL="$DATABASE_URL"
export INVITATION_APP_DATABASE_URL="$PROJECT_OPS_APP_DATABASE_URL"
npx jest --config tests/jest-integration.json --runInBand --runTestsByPath \
  tests/integration/invitations/workspace-invitations.integration.test.ts \
  tests/integration/users/public-user.integration.test.ts
echo "[run.sh] Invitation/public-user auth tests PASSED."
# (container removed by the EXIT trap)
