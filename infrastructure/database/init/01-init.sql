-- Project Ops — Database Initialization Script
-- Runs once on first postgres container start. Prisma owns the actual schema
-- (via `prisma db push` from the backend container). This file only enables
-- shared extensions and confirms grants for the application user.

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

COMMENT ON DATABASE project_ops IS 'Project Ops — primary application database';
