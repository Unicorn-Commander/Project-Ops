-- Federation principals — idempotent seed.
--
-- UC suite apps that federate INTO Project-Ops (brokered by Brigade) authenticate
-- as a SYNTHETIC principal — JwtStrategy → AuthService.buildFederationPrincipal:
--   id = 'federation:<app>', keycloakId = null, and NO `users` row.
-- PO authorizes that principal by a `memberships` row whose userKey = its
-- membershipKey (= `keycloakId ?? id` = 'federation:<app>') — NOT the token `sub`,
-- and NOT a DB users row. A `users` row keyed on the KC service-account sub is
-- DEAD WEIGHT: PO never resolves a DB user for a federation actor (the synthetic
-- branch in validateJwtPayload returns before any user lookup).
--
-- So provisioning a federating app = ONE membership per (app, workspace) +
-- listing the app in PROJECT_OPS_FEDERATION_ACTORS (env, provisioned separately).
--
-- Apply (idempotent) as the DB owner:
--   docker exec -i project-ops-postgres psql -U project_ops_admin -d project_ops -f - < federation-principals.sql
--
-- ⚠️ workspaceId is ENV-SPECIFIC. Below = the dogfood MU workspace; set the prod
-- workspace id when provisioning prod. `memberships` is NOT RLS-tenanted (control table).

-- customer-ops — read-only projects panel into Customer-Ops (2026-06-19).
INSERT INTO memberships ("userKey", "workspaceId", role, status, "isDefault")
VALUES ('federation:customer-ops', '019e50a3-d995-723f-ab66-0f765f92c0f4', 'MEMBER', 'ACTIVE', false)
ON CONFLICT ("userKey", "workspaceId") DO UPDATE SET role = 'MEMBER', status = 'ACTIVE';
