-- Apply only after reverting the invitation-aware backend, with a protected
-- backup of this control table. Existing users and memberships are preserved.
BEGIN;
DROP TABLE IF EXISTS workspace_invitations;
COMMIT;
