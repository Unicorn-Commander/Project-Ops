-- RLS + grants for the tenanted tables whose CREATE TABLE lives in a migration that
-- cannot run after `prisma db push` (push_b_collab, wave2_features, agent_events).
-- Same policy and grants as those migrations, but idempotent: a policy is created only
-- where it is missing, so this is a no-op on prod and dogfood and completes a fresh
-- hosted bring-up (db push + the tenancy SQL; see README.md in this folder).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_dependencies','notifications','saved_views',
    'custom_field_definitions','automation_rules','webhook_endpoints','webhook_deliveries',
    'approvals','agent_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = t AND policyname = 'workspace_isolation') THEN
      EXECUTE format(
        'CREATE POLICY workspace_isolation ON %I '
        || 'USING ("workspaceId" = current_workspace_id()) '
        || 'WITH CHECK ("workspaceId" = current_workspace_id())', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO project_ops_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
      EXECUTE format('GRANT SELECT ON %I TO project_ops_ro', t);
    END IF;
  END LOOP;
END $$;
