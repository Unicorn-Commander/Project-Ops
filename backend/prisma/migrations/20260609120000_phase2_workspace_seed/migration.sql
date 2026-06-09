-- ============================================================================
-- Suite Tenancy — Phase 2 (C4): dogfood workspace SEED — rebrand the bootstrap
-- workspace + introduce the second dogfood tenant "Brightwater Labs", and pin
-- the two authoritative operator memberships.
-- ============================================================================
--
-- Normative contract: SUITE-IDENTITY.md (binding). Implementation brief:
-- phase2-tenancy-blueprint.md (Phase C — C4). Builds on
-- 20260603051046_suite_tenancy_rls_roles (bootstrap workspace + roles + RLS) and
-- 20260609000000_phase2_tenancy_cols (triage/PAT workspace columns).
--
-- ROLLOUT POSTURE (identical to Phase A/Phase 1 — ADDITIVE / INERT):
--   * This migration only INSERTs/UPDATEs control-plane rows (workspaces +
--     memberships). Both control tables are NOT under RLS, and the running app
--     still connects as the BYPASSRLS owner with PROJECT_OPS_TENANCY_ENABLED
--     OFF, so nothing here changes runtime behavior until the flip. At the flip
--     these rows make Magic Unicorn + Brightwater Labs the two dogfood tenants
--     and gate Aaron/Shafen via membership.
--   * It is APPLIED AT THE FLIP exactly like the Phase A migration — never run
--     against a live DB ahead of the cutover.
--
-- WHY a migration AND a seed script:
--   * The migration is the deterministic, no-data-dependency half: it rebrands a
--     KNOWN workspace id and INSERTs a workspace with a KNOWN hardcoded id. It is
--     fully idempotent (guarded UPDATE + INSERT ... ON CONFLICT DO NOTHING) and
--     carries no per-user resolution.
--   * The membership rows depend on resolving users.keycloakId by email (the
--     uchub SSO link may not exist at migrate time), so they live in the
--     idempotent `seed-phase2-tenancy.ts` script (`npm run seed:phase2`), which
--     RE-DECLARES the same membership truth and is safe to run repeatedly.
--   * For belt-and-suspenders the migration ALSO seeds the two memberships for
--     any user whose keycloakId is ALREADY linked at apply time (same pattern as
--     the Phase 1 migration's section 4). The seed script is authoritative and
--     reconciles whatever the migration could not (unlinked users) later.
--
-- SUITE-IDENTITY: PO MUST NOT runtime-mint workspace ids (uc-registry owns real
--   ids). The Brightwater Labs id below is a HARDCODED dogfood SEED literal to
--   be RECONCILED with uc-registry in Phase E. It is a valid lowercase uuidv7.
--
-- Known ids:
--   Magic Unicorn (rebrand of the bootstrap) = 0190a000-7e57-7000-8000-00000000b007
--   Brightwater Labs (new dogfood tenant)    = 01924a3c-0000-7f1a-beef-67f1ab5c0001

-- ----------------------------------------------------------------------------
-- 1. Rebrand the bootstrap workspace -> "Magic Unicorn".
--    Phase 1 seeded it as slug='magic-unicorn', displayName='Magic Unicorn
--    (bootstrap)'. Drop the "(bootstrap)" suffix now that it is the real
--    internal tenant carrying ALL existing data. slug is already correct; set it
--    explicitly so the migration is self-contained + idempotent. We deliberately
--    touch ONLY displayName + slug (never isolationMode/hipaaMode etc.) so the
--    HIPAA ratchet trigger from Phase 1 sees no weakening.
-- ----------------------------------------------------------------------------
UPDATE "workspaces"
  SET "displayName" = 'Magic Unicorn',
      "slug"        = 'magic-unicorn',
      "updatedAt"   = now()
  WHERE "id" = '0190a000-7e57-7000-8000-00000000b007';

-- ----------------------------------------------------------------------------
-- 2. Introduce the second dogfood tenant "Brightwater Labs".
--    Hardcoded uuidv7 seed literal (see header) — NOT runtime-minted.
--    ON CONFLICT DO NOTHING keeps re-runs and a registry-reconciled id safe.
--    Defaults match the bootstrap (standard/shared/active), so the HIPAA
--    coupling CHECK constraint is satisfied (hipaaMode=false).
-- ----------------------------------------------------------------------------
INSERT INTO "workspaces"
  (id, slug, "displayName", "isolationMode", "isolationTier", status, "syncedAt", "createdAt", "updatedAt")
VALUES
  ('01924a3c-0000-7f1a-beef-67f1ab5c0001', 'brightwater-labs', 'Brightwater Labs',
   'standard', 'shared', 'active', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Authoritative operator memberships (best-effort here; the seed script is
--    the source of truth and reconciles unlinked users).
--    Keyed by userKey (== uchub sub == User.keycloakId). Seeded ONLY when the
--    user row exists AND is SSO-linked (keycloakId NOT NULL). These two
--    memberships are AUTHORITATIVE over PROJECT_OPS_ACCESS_LIST (R6): the
--    access-list still controls who may sign in + their UserRole, but the
--    workspace a user lands in is driven by these membership rows.
--
--    isDefault=true marks each user's PRIMARY workspace (the one
--    resolveAndAuthorize returns when no explicit workspace is requested):
--      * aaron@magicunicorn.tech  -> OWNER   of Magic Unicorn      (default)
--      * shafenkhan@users.noreply.github.com   -> MANAGER of Brightwater Labs  (default)
--
--    NOTE: Phase 1 already seeded BOTH operators as OWNER of the bootstrap
--    workspace (now Magic Unicorn) with isDefault=true. For Shafen we must flip
--    his Magic Unicorn membership's isDefault to false so GFL is his primary;
--    the seed script does this explicitly. Here we only ADD rows
--    (ON CONFLICT DO NOTHING), so a pre-existing Shafen@MagicUnicorn row is left
--    intact and the seed script performs the authoritative reconciliation.
-- ----------------------------------------------------------------------------

-- 3a. aaron@magicunicorn.tech -> OWNER of Magic Unicorn (default primary).
INSERT INTO "memberships" ("userKey", "workspaceId", role, status, "isDefault", "createdAt")
SELECT u."keycloakId", '0190a000-7e57-7000-8000-00000000b007', 'OWNER', 'ACTIVE', true, now()
FROM "users" u
WHERE u."keycloakId" IS NOT NULL
  AND lower(u.email) = 'aaron@magicunicorn.tech'
ON CONFLICT ("userKey", "workspaceId") DO NOTHING;

-- 3b. shafenkhan@users.noreply.github.com -> MANAGER of Brightwater Labs (default primary).
INSERT INTO "memberships" ("userKey", "workspaceId", role, status, "isDefault", "createdAt")
SELECT u."keycloakId", '01924a3c-0000-7f1a-beef-67f1ab5c0001', 'MANAGER', 'ACTIVE', true, now()
FROM "users" u
WHERE u."keycloakId" IS NOT NULL
  AND lower(u.email) = 'shafenkhan@users.noreply.github.com'
ON CONFLICT ("userKey", "workspaceId") DO NOTHING;
