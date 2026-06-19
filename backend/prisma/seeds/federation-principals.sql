-- Federation principals — idempotent seed.
--
-- UC suite apps that federate INTO Project-Ops (reading / acting on behalf of
-- the workspace, brokered by Brigade) need a Project-Ops `users` row so their
-- KC service-account subject resolves to a real, role-scoped user. Without it,
-- the federated call authenticates but resolves to no user → 401 / empty panel.
--
-- Apply (idempotent — safe to re-run) as the DB OWNER:
--   docker exec -i project-ops-postgres \
--     psql -U project_ops_admin -d project_ops -f - < federation-principals.sql
--
-- Two more pieces, provisioned separately (NOT here, because they are
-- env-specific):
--   1. PROJECT_OPS_FEDERATION_ACTORS env must list the actor (see .env) so the
--      FederationActorGuard admits it.
--   2. A `memberships` row per workspace the actor may access
--      (userKey = the principal's id below, workspaceId = the target workspace,
--      role MEMBER, status ACTIVE) — workspace ids differ per environment.
--
-- Convention per principal: id = keycloakId = the app's KC service-account
-- `sub` (Brigade preserves it on the federated call). role = STAFF so it can
-- read across the workspace (CLIENT is org-restricted). password NULL (no login).

-- customer-ops — federates a read-only projects panel into Customer-Ops (2026-06-19).
INSERT INTO users (id, email, username, "firstName", "lastName", role, "keycloakId", "isActive", "updatedAt")
VALUES (
  'd0b3c214-5350-4b99-a722-8803444c2750',
  'customer-ops@federation.local',
  'customer-ops',
  'Customer-Ops',
  'Federation',
  'STAFF',
  'd0b3c214-5350-4b99-a722-8803444c2750',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  role = 'STAFF',
  "isActive" = true,
  "keycloakId" = EXCLUDED."keycloakId",
  "updatedAt" = now();
