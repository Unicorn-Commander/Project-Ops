-- Project Ops — Database Initialization Script
-- Runs once on first postgres container start, as the superuser, BEFORE the
-- backend applies Prisma migrations. Prisma Migrate owns the actual schema +
-- RLS + grants (see backend/prisma/migrations). This file only enables shared
-- extensions, confirms the legacy admin grant, and pre-creates the suite
-- tenancy role split so a brand-new node has the roles the runtime expects.
--
-- ROLLOUT NOTE: Phase 1 keeps the runtime connecting as project_ops_admin (the
-- object owner). The project_ops_app role created here is the NOBYPASSRLS
-- runtime role for a LATER phase; creating it now is additive and inert. The
-- suite_tenancy_rls_roles migration re-asserts these roles + their grants
-- idempotently, so this block and the migration cannot diverge.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Grants (idempotent; the user is created by the postgres image from
-- POSTGRES_USER, this just makes the privilege grants explicit).
GRANT ALL PRIVILEGES ON DATABASE project_ops TO project_ops_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO project_ops_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO project_ops_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO project_ops_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO project_ops_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO project_ops_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON FUNCTIONS TO project_ops_admin;

-- ---------------------------------------------------------------------------
-- Suite tenancy role split (SUITE-IDENTITY §D3, brief §3). Cluster-global,
-- guarded so re-runs are free. Passwords are placeholders for fresh dev/CI
-- nodes; production rotates them out-of-band via ADMIN_DATABASE_URL. The
-- security-critical attribute is project_ops_app being NOBYPASSRLS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_owner') THEN
    CREATE ROLE project_ops_owner NOLOGIN;
  END IF;
  ALTER ROLE project_ops_owner BYPASSRLS;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
    CREATE ROLE project_ops_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'change_me_app';
  END IF;
  ALTER ROLE project_ops_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_audit') THEN
    CREATE ROLE project_ops_audit LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'change_me_audit';
  END IF;
  ALTER ROLE project_ops_audit LOGIN NOSUPERUSER NOBYPASSRLS;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
    CREATE ROLE project_ops_ro LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'change_me_ro';
  END IF;
  ALTER ROLE project_ops_ro LOGIN NOSUPERUSER NOBYPASSRLS;

  -- The migration runner (project_ops_admin) co-administers owned objects.
  GRANT project_ops_owner TO project_ops_admin;
END
$$;

GRANT USAGE ON SCHEMA public TO project_ops_app, project_ops_audit, project_ops_ro, project_ops_owner;

COMMENT ON DATABASE project_ops IS 'Project Ops — primary application database';
