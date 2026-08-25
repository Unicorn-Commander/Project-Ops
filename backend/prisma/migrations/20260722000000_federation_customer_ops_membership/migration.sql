-- ============================================================================
-- Federation seed: durable membership for federation:customer-ops
-- ============================================================================
--
-- Corrects the wrong fe34225 model (STAFF `users` row id=d0b3c214-…) with the
-- synthetic-principal membership from 0ea9706, baked into a Prisma migration
-- so it survives DB reset / `prisma migrate deploy` without a manual seed apply.
--
-- Auth path (see AuthService.buildFederationPrincipal):
--   JwtStrategy builds a SYNTHETIC principal:
--     id = 'federation:<app>', keycloakId = null, NO `users` row.
--   MembershipService.membershipKey(user) = keycloakId ?? id
--     → 'federation:<app>'.
--   Non-ingest routes (e.g. Customer-Ops read-only projects panel) authorize
--   via WorkspaceMembershipGuard → ACTIVE membership on that userKey.
--   Triage ingest short-circuits membership via FederationActorGuard +
--   PROJECT_OPS_FEDERATION_ACTORS (env, provisioned separately).
--
-- Pattern for future federation consumers (meeting-ops, email-ops, …):
--   1. INSERT memberships row: userKey='federation:<app>',
--      workspaceId=<suite-canonical or target workspace>,
--      role MEMBER, status ACTIVE, isDefault false
--      ON CONFLICT ("userKey","workspaceId") DO UPDATE SET role/status.
--   2. List <app> in PROJECT_OPS_FEDERATION_ACTORS for allow-listed routes.
--   3. Do NOT create a `users` row for the KC service-account sub — dead weight.
--   Manual / re-run helper: backend/prisma/seeds/federation-principals.sql
--
-- workspaceId below = suite-canonical Magic Unicorn (dogfood; post rekey
-- 20260610090000_mu_canonical_rekey). Prod must use the prod workspace id
-- (env-specific). `memberships` is control-plane (NOT RLS-tenanted).
-- Idempotent / replay-safe. ADDITIVE only (plus the scoped d0b3c214 cleanup).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop dead-weight d0b3c214 STAFF principal (fe34225 wrong model), if present.
--    Memberships first (no FK to users). Users DELETE is scoped to the known
--    id+email so we never touch unrelated rows. No-op when already gone.
-- ----------------------------------------------------------------------------
DELETE FROM memberships
WHERE "userKey" = 'd0b3c214-5350-4b99-a722-8803444c2750';

DELETE FROM users
WHERE id = 'd0b3c214-5350-4b99-a722-8803444c2750'
  AND email = 'customer-ops@federation.local';

-- ----------------------------------------------------------------------------
-- 2. Durable membership for synthetic federation:customer-ops principal.
--    Only insert when the target workspace row exists (fresh migrate always
--    has it after mu_canonical_rekey; partial envs stay safe).
-- ----------------------------------------------------------------------------
INSERT INTO memberships ("userKey", "workspaceId", role, status, "isDefault")
SELECT
  'federation:customer-ops',
  '019e50a3-d995-723f-ab66-0f765f92c0f4',
  'MEMBER',
  'ACTIVE',
  false
WHERE EXISTS (
  SELECT 1 FROM workspaces WHERE id = '019e50a3-d995-723f-ab66-0f765f92c0f4'
)
ON CONFLICT ("userKey", "workspaceId") DO UPDATE
SET role = 'MEMBER',
    status = 'ACTIVE';
