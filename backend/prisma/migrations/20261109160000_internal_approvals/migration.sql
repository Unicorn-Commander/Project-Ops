-- CreateEnum
CREATE TYPE "InternalApprovalType" AS ENUM ('INTERNAL');

-- CreateEnum
CREATE TYPE "InternalApprovalEntity" AS ENUM ('task', 'document', 'pr');

-- CreateEnum
CREATE TYPE "InternalApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'DEFER');

-- CreateTable
CREATE TABLE "internal_approvals" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "InternalApprovalType" NOT NULL DEFAULT 'INTERNAL',
    "entity" "InternalApprovalEntity" NOT NULL,
    "entityRef" VARCHAR(300) NOT NULL,
    "versionHash" VARCHAR(128) NOT NULL,
    "decision" "InternalApprovalDecision" NOT NULL,
    "reason" VARCHAR(5000) NOT NULL,
    "approverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_approvals_sequence_key" ON "internal_approvals"("sequence");

-- CreateIndex
CREATE INDEX "internal_approvals_workspaceId_projectId_sequence_idx" ON "internal_approvals"("workspaceId", "projectId", "sequence");

-- CreateIndex
CREATE INDEX "internal_approvals_binding_idx" ON "internal_approvals"("workspaceId", "entity", "entityRef", "versionHash", "sequence");

-- AddForeignKey
ALTER TABLE "internal_approvals" ADD CONSTRAINT "internal_approvals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "internal_approvals" ADD CONSTRAINT "internal_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Custom migration additions: Prisma cannot express RLS or append-only triggers.
-- Same workspace GUC as the existing tenancy policies; no database is touched
-- when generating this create-only migration artifact.
ALTER TABLE "internal_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "internal_approvals"
  USING ("workspaceId" = NULLIF(current_setting('app.current_workspace', true), ''))
  WITH CHECK ("workspaceId" = NULLIF(current_setting('app.current_workspace', true), ''));

CREATE FUNCTION reject_internal_approval_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Internal approvals are immutable; append a new decision instead';
END;
$$;
CREATE TRIGGER internal_approvals_immutable
  BEFORE UPDATE OR DELETE ON "internal_approvals"
  FOR EACH ROW EXECUTE FUNCTION reject_internal_approval_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "internal_approvals" FROM project_ops_app;
    GRANT SELECT, INSERT ON "internal_approvals" TO project_ops_app;
    GRANT USAGE, SELECT ON SEQUENCE "internal_approvals_sequence_seq" TO project_ops_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_ro') THEN
    GRANT SELECT ON "internal_approvals" TO project_ops_ro;
  END IF;
END $$;
