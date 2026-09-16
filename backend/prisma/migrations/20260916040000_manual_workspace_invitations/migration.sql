-- Invitation control plane: exact-email admission and token acceptance happen
-- before a user has workspace context, like memberships. Never expose raw rows.
CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "tokenHash" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdByKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedByKey" TEXT,
  "acceptedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_status_idx" ON "workspace_invitations"("email","status");
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspaceId_idx" ON "workspace_invitations"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitations_pending_email" ON "workspace_invitations"("workspaceId","email") WHERE status='pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON "workspace_invitations" TO project_ops_app;

-- db push also creates this table in CI; enforce SQL-only constraints in both paths.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_invitations_status_check' AND conrelid='workspace_invitations'::regclass) THEN
    ALTER TABLE workspace_invitations ADD CONSTRAINT workspace_invitations_status_check CHECK (status IN ('pending','accepted','revoked','expired'));
  END IF;
END $$;
