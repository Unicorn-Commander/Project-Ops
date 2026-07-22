-- Federation principals — idempotent seed / helper.
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
-- Durable path: migration 20260722000000_federation_customer_ops_membership
-- bakes the customer-ops row so it survives DB reset / migrate deploy.
-- This SQL is the manual re-run helper and the TEMPLATE for future consumers.
--
-- Apply (idempotent) as the DB owner:
--   docker exec -i project-ops-postgres psql -U project_ops_admin -d project_ops -f - < federation-principals.sql
--
-- ⚠️ workspaceId is ENV-SPECIFIC. Below = the dogfood MU workspace; set the prod
-- workspace id when provisioning prod. `memberships` is NOT RLS-tenanted (control table).
--
-- ---------------------------------------------------------------------------
-- Helper pattern — copy for each new federation consumer:
--
--   -- <app> — <one-line why it federates>
--   DELETE FROM memberships
--   WHERE "userKey" = '<legacy-wrong-users-uuid-if-any>';
--   DELETE FROM users
--   WHERE id = '<legacy-wrong-users-uuid-if-any>'
--     AND email = '<app>@federation.local';  -- optional safety scope
--
--   INSERT INTO memberships ("userKey", "workspaceId", role, status, "isDefault")
--   VALUES (
--     'federation:<app>',                       -- membershipKey of synthetic principal
--     '<workspace-uuid>',                       -- suite-canonical or target tenant
--     'MEMBER',
--     'ACTIVE',
--     false
--   )
--   ON CONFLICT ("userKey", "workspaceId") DO UPDATE
--   SET role = 'MEMBER', status = 'ACTIVE';
--
-- Examples of future apps: federation:meeting-ops, federation:email-ops, …
-- Also set PROJECT_OPS_FEDERATION_ACTORS=<app>,… for allow-listed federation routes.
-- ---------------------------------------------------------------------------

-- Cleanup: wrong fe34225 STAFF users-row model (id = KC service-account sub).
-- Safe no-op when already removed (live dogfood already dropped it).
DELETE FROM memberships
WHERE "userKey" = 'd0b3c214-5350-4b99-a722-8803444c2750';

DELETE FROM users
WHERE id = 'd0b3c214-5350-4b99-a722-8803444c2750'
  AND email = 'customer-ops@federation.local';

-- customer-ops — read-only projects panel into Customer-Ops (2026-06-19).
INSERT INTO memberships ("userKey", "workspaceId", role, status, "isDefault")
VALUES ('federation:customer-ops', '019e50a3-d995-723f-ab66-0f765f92c0f4', 'MEMBER', 'ACTIVE', false)
ON CONFLICT ("userKey", "workspaceId") DO UPDATE SET role = 'MEMBER', status = 'ACTIVE';
