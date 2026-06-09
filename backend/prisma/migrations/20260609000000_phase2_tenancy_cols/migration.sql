-- ============================================================================
-- Suite Tenancy — Phase 2: workspace columns for triage_proposals + PATs,
-- workspace-scoped Contact email uniqueness, and RLS for triage_proposals.
-- ============================================================================
--
-- Normative contract: SUITE-IDENTITY.md (§5 isolation columns, §6 GUC name
-- `app.current_workspace`). Implementation brief: phase2-tenancy-blueprint.md
-- (Phase A — shared infra). Builds directly on
-- 20260603051046_suite_tenancy_rls_roles (roles, GUC chokepoint, base RLS).
--
-- ROLLOUT POSTURE (Phase 2 — ADDITIVE / INERT for the running app):
--   * Same posture as Phase 1: RLS is ENABLED + FORCED on triage_proposals, but
--     the running app still connects as the object owner (BYPASSRLS), so the
--     fence is inert until the runtime DATABASE_URL flips to project_ops_app
--     (NOBYPASSRLS) in a later phase. PROJECT_OPS_TENANCY_ENABLED also stays OFF
--     at the app layer, so every wire-through is a no-op until both flip.
--   * personal_access_tokens get a nullable workspaceId column ONLY — they are
--     intentionally NOT under RLS (PAT scope is app-enforced at the JWT/MCP
--     chokepoint, per the blueprint). No policy, no ENABLE/FORCE here.
--
-- NULL workspace_id handling (Phase 2 nullable columns):
--   The triage policy predicate is `workspaceId = current_workspace_id()`. SQL
--   three-valued logic makes a NULL-workspace row INVISIBLE + UN-WRITABLE under
--   RLS regardless of the GUC (fail-closed). To keep the running owner-path
--   behavior identical we BACKFILL every pre-existing NULL workspaceId below, so
--   no NULL rows exist after this migration.
--
-- bootstrap workspace_id = 0190a000-7e57-7000-8000-00000000b007 (minted in
--   20260603051046; PO never mints in production — uc-registry owns real ids).

-- ----------------------------------------------------------------------------
-- 1. ADD COLUMNS (nullable; additive). Guarded so re-runs are safe.
--    triage_proposals carried no workspaceId; personal_access_tokens neither.
-- ----------------------------------------------------------------------------
ALTER TABLE "triage_proposals"       ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

-- ----------------------------------------------------------------------------
-- 2. BACKFILL.
--    2a. triage_proposals: single-tenant dogfood → bootstrap workspace, so the
--        FORCED RLS policy below matches every existing row under the bootstrap
--        GUC and no NULL row remains.
-- ----------------------------------------------------------------------------
UPDATE "triage_proposals"
  SET "workspaceId" = '0190a000-7e57-7000-8000-00000000b007'
  WHERE "workspaceId" IS NULL;

--    2b. personal_access_tokens: a PAT is scoped to its owner-user's DEFAULT
--        workspace. Resolve via users.id -> users.keycloakId -> memberships
--        (the membership key is the uchub sub == User.keycloakId). Prefer the
--        user's default ACTIVE membership; if none (e.g. keycloakId still NULL
--        pre-SSO-link, or no membership yet), fall back to the bootstrap
--        workspace so no NULL row remains. PATs are NOT RLS-fenced, but we keep
--        the column populated for the app-layer scope check.
UPDATE "personal_access_tokens" pat
  SET "workspaceId" = COALESCE(
    (
      SELECT m."workspaceId"
      FROM "users" u
      JOIN "memberships" m ON m."userKey" = u."keycloakId"
      WHERE u."id" = pat."userId"
        AND m."status" = 'ACTIVE'
      ORDER BY m."isDefault" DESC, m."createdAt" ASC
      LIMIT 1
    ),
    '0190a000-7e57-7000-8000-00000000b007'
  )
  WHERE pat."workspaceId" IS NULL;

-- ----------------------------------------------------------------------------
-- 3. INDEXES on the new columns (match Prisma @@index naming convention).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "triage_proposals_workspaceId_idx"
  ON "triage_proposals"("workspaceId");
CREATE INDEX IF NOT EXISTS "personal_access_tokens_workspaceId_idx"
  ON "personal_access_tokens"("workspaceId");

-- ----------------------------------------------------------------------------
-- 4. UNIQUENESS, re-scoped to the workspace.
--    4a. triage_proposals: the source-idempotency key becomes per-workspace, so
--        two workspaces can ingest the same upstream action item id. Drop the
--        old global (sourceType, sourceActionItemId) unique and recreate it
--        prefixed by workspaceId. (Prisma names: old =
--        triage_proposals_sourceType_sourceActionItemId_key, new =
--        triage_proposals_workspaceId_sourceType_sourceActionItemId_key.)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS "triage_proposals_sourceType_sourceActionItemId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "triage_proposals_workspaceId_sourceType_sourceActionItemId_key"
  ON "triage_proposals"("workspaceId", "sourceType", "sourceActionItemId");

--    4b. contacts: email was globally unique (contacts_email_key, created in
--        20260603051018 via the live db-push baseline). contacts.workspaceId was
--        already backfilled in Phase 1, so re-scope email uniqueness to the
--        workspace: drop the global unique, create (workspaceId, email) unique.
--        (Prisma name: contacts_workspaceId_email_key.)
DROP INDEX IF EXISTS "contacts_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_workspaceId_email_key"
  ON "contacts"("workspaceId", "email");

-- ----------------------------------------------------------------------------
-- 5. GRANTS — give the runtime role full DML on triage_proposals (RLS fences
--    the rows). personal_access_tokens already has the grant from Phase 1
--    (6a reference-tables block); no change needed there.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "triage_proposals" TO project_ops_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
    GRANT SELECT ON "triage_proposals" TO project_ops_ro;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY for triage_proposals — same shape as the Phase 1
--    scoped tables: ENABLE + FORCE (so the owner is subject too; the runtime
--    role is non-owner + NOBYPASSRLS regardless) + a complete PERMISSIVE
--    workspace_isolation policy. USING gates reads/updates/deletes; WITH CHECK
--    gates the post-image of inserts/updates so a row can never be written into
--    a workspace other than the GUC's. (personal_access_tokens is deliberately
--    omitted — app-enforced, no RLS.)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  scoped_tables text[] := ARRAY[
    'triage_proposals'
  ];
BEGIN
  FOREACH t IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I '
      || 'USING ("workspaceId" = current_workspace_id()) '
      || 'WITH CHECK ("workspaceId" = current_workspace_id())',
      t
    );
  END LOOP;
END
$$;
