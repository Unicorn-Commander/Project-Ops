-- ============================================================================
-- Suite Tenancy — Phase 3: make the tenanted workspaceId columns NOT NULL.
-- ============================================================================
--
-- Normative contract: SUITE-IDENTITY.md (§5 isolation columns). Implementation
-- brief: docs/phase2-tenancy-blueprint.md ("Phase 3 — make tenanted workspaceId
-- NOT NULL"). Builds on:
--   * 20260603051046_suite_tenancy_rls_roles  — backfilled the 9 Phase-1 scoped
--     tables' NULL workspaceId to the bootstrap workspace (step 5 there).
--   * 20260609000000_phase2_tenancy_cols       — backfilled triage_proposals
--     (and added the nullable PAT column) to bootstrap (step 2 there).
--   * 20260610090000_mu_canonical_rekey        — re-keyed the bootstrap MU id to
--     the suite-canonical one; both ids are real Workspace rows.
--
-- WHY NOW (safe): by the time this migration runs, every tenanted row already
-- carries a non-NULL workspaceId (the two backfills above leave NO NULL rows).
-- The deploy driver is `prisma db push` against schema.prisma, where these
-- columns are now `String` (NOT NULL); this migration file is the
-- history/CI-parity record of the same change and is applied verbatim by the
-- §9 RLS harness (tests/integration/rls/run.sh) on a from-scratch DB.
--
-- ROLLOUT POSTURE: additive + safe with tenancy OFF. NOT NULL is a pure
-- tightening of an already-populated column — it does not change the
-- owner-path runtime behavior and does not depend on RLS being enforced. It is
-- ALSO safe to deploy while the runtime still connects as the BYPASSRLS owner.
--
-- IDEMPOTENT: the defensive re-backfill is `WHERE workspaceId IS NULL` (a no-op
-- once clean) and `SET NOT NULL` is a no-op when the column is already NOT NULL,
-- so re-applying this migration by hand (as run.sh does) is free.
--
-- bootstrap workspace_id = 0190a000-7e57-7000-8000-00000000b007 (minted in
--   20260603051046; re-keyed to the suite-canonical 019e50a3-…-c0f4 by
--   20260610090000_mu_canonical_rekey). PO never mints in production —
--   uc-registry owns real ids.

-- ----------------------------------------------------------------------------
-- 1. DEFENSIVE RE-BACKFILL. The prior migrations already cleared all NULLs;
--    this is belt-and-suspenders for any row inserted between those migrations
--    and this one (e.g. on a long-lived dogfood DB). Backfill to whichever
--    bootstrap id currently exists as a Workspace row — prefer the
--    suite-canonical MU id, fall back to the original self-minted id — so the
--    FK-free workspaceId always points at a real workspace. If NEITHER exists
--    (a pristine DB where the seed hasn't run) there are also no scoped rows
--    yet, so the UPDATEs match nothing and the NOT NULL below still holds.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  bootstrap_ws text;
BEGIN
  SELECT id INTO bootstrap_ws FROM "workspaces"
   WHERE id IN (
     '019e50a3-d995-723f-ab66-0f765f92c0f4',  -- suite-canonical Magic Unicorn
     '0190a000-7e57-7000-8000-00000000b007'   -- original self-minted bootstrap
   )
   ORDER BY (id = '019e50a3-d995-723f-ab66-0f765f92c0f4') DESC
   LIMIT 1;

  IF bootstrap_ws IS NOT NULL THEN
    UPDATE "organizations"         SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "organization_contacts" SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "contacts"              SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "projects"              SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "tasks"                 SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "task_comments"         SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "documents"             SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "comments"              SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
    UPDATE "triage_proposals"      SET "workspaceId" = bootstrap_ws WHERE "workspaceId" IS NULL;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. HARD GUARD before tightening. If — against expectation — any tenanted row
--    still has a NULL workspaceId (e.g. the bootstrap workspace row was deleted
--    so the re-backfill above found no target), FAIL the migration with a clear
--    message rather than letting the SET NOT NULL throw an opaque error or, on
--    `db push`, silently diverge. Conservative over clever: a loud stop beats a
--    half-applied tenancy boundary.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  n bigint;
  tenanted text[] := ARRAY[
    'organizations', 'organization_contacts', 'contacts', 'projects', 'tasks',
    'task_comments', 'documents', 'comments', 'triage_proposals'
  ];
BEGIN
  FOREACH t IN ARRAY tenanted LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "workspaceId" IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'Phase 3 abort: % row(s) in table % still have a NULL workspaceId and could not be backfilled (is the bootstrap workspace row present?). Refusing to SET NOT NULL.',
        n, t USING ERRCODE = 'not_null_violation';
    END IF;
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. SET NOT NULL on every genuinely-tenanted column. These mirror the
--    `workspaceId String` (no `?`) fields in schema.prisma. Each statement is a
--    no-op if the column is already NOT NULL, so re-runs are free.
-- ----------------------------------------------------------------------------
ALTER TABLE "organizations"         ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "organization_contacts" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "contacts"              ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "projects"              ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "tasks"                 ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "task_comments"         ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "documents"             ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "comments"              ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "triage_proposals"      ALTER COLUMN "workspaceId" SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. INTENTIONALLY LEFT NULLABLE (do NOT add NOT NULL here):
--
--    * personal_access_tokens.workspaceId — the v1.8.1 "claimless MCP/PAT
--      callers resolve to default membership" exception. A PAT may be minted
--      with no workspace binding (legacy/claimless), and the blueprint says do
--      NOT 'fix' the PAT exception. PATs are app-enforced (no RLS), so a NULL
--      here is fenced at the JWT/MCP chokepoint, not the DB.
--
--    * audit_logs.workspaceId — AuditService.log() tolerates an UNSTAMPED DTO
--      by design: a workspace-less system event (a future LOGIN/LOGOUT audit, or
--      any failure recorded before workspace resolution) must still be
--      recordable. The audit write contract is never-throw, so forcing NOT NULL
--      would turn that fallback into a hard PG error that the catch SILENTLY
--      SWALLOWS — i.e. we'd lose audit rows with no signal. Every CURRENT caller
--      stamps workspaceId (so RLS still fences live rows via the
--      workspaceId = current_workspace_id() predicate, under which a NULL row is
--      invisible/un-writable), but we keep the column as the safety valve.
--      Conservative over clever (blueprint Phase 3 guidance).
-- ----------------------------------------------------------------------------
