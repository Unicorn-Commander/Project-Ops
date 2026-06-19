-- v1.10: per-user EMAIL notification preferences (in-app notifications are always on).
-- users is a global (non-tenanted) table; no RLS policy needed. Apply as owner.
ALTER TABLE "users" ADD COLUMN "notificationPreferences" JSONB;
