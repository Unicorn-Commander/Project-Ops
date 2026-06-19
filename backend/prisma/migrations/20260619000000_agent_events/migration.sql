-- v1.11: agent activity & usage ledger. Workspace-tenanted (RLS workspace_isolation
-- + grants), same convention as the Wave-2 tables. Apply as the OWNER.
CREATE TYPE "AgentVia" AS ENUM ('MCP', 'API', 'ASSISTANT', 'GUI', 'SYSTEM');
CREATE TYPE "AgentActorKind" AS ENUM ('PAT', 'ASSISTANT', 'FEDERATED', 'USER', 'SYSTEM');

CREATE TABLE "agent_events" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "taskId" TEXT,
  "actorKind" "AgentActorKind" NOT NULL,
  "actorKey" TEXT NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "via" "AgentVia" NOT NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT,
  "resourceId" TEXT,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "costUsd" DECIMAL(12,6),
  "durationMs" INTEGER,
  "billable" BOOLEAN NOT NULL DEFAULT false,
  "details" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_events_workspaceId_idx" ON "agent_events"("workspaceId");
CREATE INDEX "agent_events_workspaceId_occurredAt_idx" ON "agent_events"("workspaceId", "occurredAt");
CREATE INDEX "agent_events_workspaceId_actorKey_idx" ON "agent_events"("workspaceId", "actorKey");
CREATE INDEX "agent_events_workspaceId_projectId_idx" ON "agent_events"("workspaceId", "projectId");
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE agent_events FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY workspace_isolation ON agent_events USING ("workspaceId" = current_workspace_id()) WITH CHECK ("workspaceId" = current_workspace_id())';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON agent_events TO project_ops_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
    EXECUTE 'GRANT SELECT ON agent_events TO project_ops_ro';
  END IF;
END $$;
