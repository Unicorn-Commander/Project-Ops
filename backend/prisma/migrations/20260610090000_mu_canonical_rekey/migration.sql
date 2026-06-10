-- ============================================================================
-- Re-key the Magic Unicorn workspace to the SUITE-CANONICAL tenant uuid.
--
--   old: 0190a000-7e57-7000-8000-00000000b007  (PO's self-minted bootstrap id)
--   new: 019e50a3-d995-723f-ab66-0f765f92c0f4  (the id Meeting-Ops [192
--        sessions] and Contact-Ops [1,441 people] already share)
--
-- WHY: uc-registry (the one minting authority per SUITE-IDENTITY) is not
-- deployed yet, and the apps diverged: PO self-minted its bootstrap id while
-- MO + CO converged on 019e50a3…. PO is the 3-way outlier and holds the least
-- data (116 projects vs 1,441 CO people), so PO adopts the shared value.
-- Brightwater Labs (01924a3c-0000-7f1a-beef-67f1ab5c0001) is unchanged.
--
-- Idempotent + replay-safe:
--   * no-op when the old workspace row is absent (fresh canonical DB, or
--     already re-keyed);
--   * tolerates a partial earlier run (canonical row already present);
--   * moves EVERY row of EVERY public table that has a "workspaceId" column
--     (discovered from information_schema, so a future tenant table cannot be
--     silently missed), including memberships + personal_access_tokens.
-- Runs as the migration/owner role (BYPASSRLS), as with the other tenancy
-- migrations. In the §9 harness this runs right after the workspace-seed
-- migration, before any seeds plant data.
-- ============================================================================

DO $$
DECLARE
  old_id   text := '0190a000-7e57-7000-8000-00000000b007';
  new_id   text := '019e50a3-d995-723f-ab66-0f765f92c0f4';
  mu_slug  text;
  r        record;
  moved    bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = old_id) THEN
    RAISE NOTICE 'mu_canonical_rekey: old workspace % absent - nothing to do', old_id;
    RETURN;
  END IF;

  -- 1. Make sure the canonical workspace row exists BEFORE moving children
  --    (memberships has a real FK to workspaces). Copy the old row column-
  --    order-proof via jsonb_populate_record; park it on a temp slug so the
  --    unique(slug) on "magic-unicorn" cannot collide.
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = new_id) THEN
    RAISE NOTICE 'mu_canonical_rekey: canonical workspace % already present - moving children only', new_id;
  ELSE
    SELECT slug INTO mu_slug FROM workspaces WHERE id = old_id;
    INSERT INTO workspaces
    SELECT (jsonb_populate_record(
              w,
              jsonb_build_object('id', new_id, 'slug', mu_slug || '-rekey-tmp')
           )).*
    FROM workspaces w
    WHERE w.id = old_id;
  END IF;

  -- 2. Move every workspace-scoped row. Covers the 12 RLS tables, triage
  --    proposals, personal access tokens, AND memberships (all carry a
  --    "workspaceId" column), plus anything added later.
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'workspaceId'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('UPDATE %I SET "workspaceId" = $1 WHERE "workspaceId" = $2', r.table_name)
      USING new_id, old_id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved > 0 THEN
      RAISE NOTICE 'mu_canonical_rekey: % -> % rows moved in %', old_id, moved, r.table_name;
    END IF;
  END LOOP;

  -- 3. Retire the old row and give the canonical row the original slug.
  SELECT slug INTO mu_slug FROM workspaces WHERE id = old_id;
  DELETE FROM workspaces WHERE id = old_id;
  UPDATE workspaces
  SET slug = mu_slug
  WHERE id = new_id AND slug LIKE '%-rekey-tmp';

  RAISE NOTICE 'mu_canonical_rekey: done - Magic Unicorn is now %', new_id;
END $$;
