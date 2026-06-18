-- Wave 2: automations, custom fields, recurring tasks/projects, webhooks, client approvals,
-- capacity planning. Structural DDL matches the Prisma datamodel; RLS + grants follow the
-- suite tenancy convention (workspace_isolation on workspaceId; project_ops_app gets DML,
-- project_ops_ro gets SELECT). Apply as the OWNER (project_ops_admin) — the NOBYPASSRLS
-- runtime role cannot run this DDL.

-- 1. Enums
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN');
CREATE TYPE "CustomFieldEntity" AS ENUM ('TASK', 'PROJECT');
CREATE TYPE "AutomationTrigger" AS ENUM ('TASK_CREATED', 'TASK_STATUS_CHANGED', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'PROJECT_CREATED', 'PROJECT_STATUS_CHANGED', 'COMMENT_CREATED');
CREATE TYPE "ClientApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');
CREATE TYPE "ApprovalEntityType" AS ENUM ('DOCUMENT', 'DELIVERABLE', 'PROJECT');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- 2. tasks: recurrence + estimate
ALTER TABLE "tasks" ADD COLUMN "recurrenceRule" TEXT;
ALTER TABLE "tasks" ADD COLUMN "recurrenceParentId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "estimatedHours" DECIMAL(8,2);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tasks_recurrenceParentId_idx" ON "tasks"("recurrenceParentId");

-- 3. projects: recurrence
ALTER TABLE "projects" ADD COLUMN "recurrenceRule" TEXT;
ALTER TABLE "projects" ADD COLUMN "recurrenceParentId" TEXT;
ALTER TABLE "projects" ADD CONSTRAINT "projects_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "projects_recurrenceParentId_idx" ON "projects"("recurrenceParentId");

-- 4. users: weekly capacity
ALTER TABLE "users" ADD COLUMN "weeklyCapacityHours" INTEGER DEFAULT 40;

-- 5. custom_field_definitions
CREATE TABLE "custom_field_definitions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "entity" "CustomFieldEntity" NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" "CustomFieldType" NOT NULL,
  "options" JSONB,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "custom_field_definitions_workspaceId_entity_key_key" ON "custom_field_definitions"("workspaceId", "entity", "key");
CREATE INDEX "custom_field_definitions_workspaceId_idx" ON "custom_field_definitions"("workspaceId");
CREATE INDEX "custom_field_definitions_workspaceId_entity_idx" ON "custom_field_definitions"("workspaceId", "entity");

-- 6. automation_rules
CREATE TABLE "automation_rules" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "trigger" "AutomationTrigger" NOT NULL,
  "conditions" JSONB,
  "actions" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "automation_rules_workspaceId_idx" ON "automation_rules"("workspaceId");
CREATE INDEX "automation_rules_workspaceId_trigger_enabled_idx" ON "automation_rules"("workspaceId", "trigger", "enabled");

-- 7. webhook_endpoints
CREATE TABLE "webhook_endpoints" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "events" TEXT[],
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_endpoints_workspaceId_idx" ON "webhook_endpoints"("workspaceId");

-- 8. webhook_deliveries
CREATE TABLE "webhook_deliveries" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "responseCode" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_deliveries_workspaceId_idx" ON "webhook_deliveries"("workspaceId");
CREATE INDEX "webhook_deliveries_endpointId_idx" ON "webhook_deliveries"("endpointId");
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. approvals (client portal)
CREATE TABLE "approvals" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "entityType" "ApprovalEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "projectId" TEXT,
  "requestedById" TEXT NOT NULL,
  "approverContactId" TEXT,
  "status" "ClientApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "decisionNote" TEXT,
  "decidedByContactId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approvals_workspaceId_idx" ON "approvals"("workspaceId");
CREATE INDEX "approvals_workspaceId_status_idx" ON "approvals"("workspaceId", "status");
CREATE INDEX "approvals_projectId_idx" ON "approvals"("projectId");
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. RLS + grants for the new tenanted tables (suite convention)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_field_definitions','automation_rules','webhook_endpoints','webhook_deliveries','approvals'] LOOP
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
