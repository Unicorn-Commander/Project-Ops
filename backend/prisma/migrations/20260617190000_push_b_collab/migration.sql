-- Push B: collaboration — subtasks, task dependencies, notifications, saved views.
-- Structural DDL matches the Prisma datamodel; RLS + grants follow the suite
-- tenancy convention (workspace_isolation on workspaceId; runtime role
-- project_ops_app gets DML, project_ops_ro gets SELECT). Apply as the table
-- OWNER (project_ops_admin) — the NOBYPASSRLS runtime role cannot run this DDL.

-- 1. Enum
CREATE TYPE "TaskDependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');

-- 2. Task subtasks: self-referential parent
ALTER TABLE "tasks" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks"("parentTaskId");

-- 3. task_dependencies (successor depends on predecessor)
CREATE TABLE "task_dependencies" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "predecessorId" TEXT NOT NULL,
  "successorId" TEXT NOT NULL,
  "type" "TaskDependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_dependencies_predecessorId_successorId_key" ON "task_dependencies"("predecessorId", "successorId");
CREATE INDEX "task_dependencies_workspaceId_idx" ON "task_dependencies"("workspaceId");
CREATE INDEX "task_dependencies_successorId_idx" ON "task_dependencies"("successorId");
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. notifications (per-user; RLS fences by workspace, query filters by userId)
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "actorId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_workspaceId_idx" ON "notifications"("workspaceId");
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "notifications_workspaceId_userId_idx" ON "notifications"("workspaceId", "userId");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. saved_views (per-user list view configs; sharable within a workspace)
CREATE TABLE "saved_views" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_views_workspaceId_idx" ON "saved_views"("workspaceId");
CREATE INDEX "saved_views_workspaceId_scope_idx" ON "saved_views"("workspaceId", "scope");
CREATE INDEX "saved_views_userId_idx" ON "saved_views"("userId");
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. RLS + grants for the new tenanted tables (suite convention)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_dependencies','notifications','saved_views'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I '
      || 'USING ("workspaceId" = current_workspace_id()) '
      || 'WITH CHECK ("workspaceId" = current_workspace_id())', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO project_ops_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
      EXECUTE format('GRANT SELECT ON %I TO project_ops_ro', t);
    END IF;
  END LOOP;
END $$;
