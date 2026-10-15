-- Additive triage review metadata. Existing proposals remain valid and
-- nullable values preserve the single-item approval/rejection contract.
ALTER TABLE "triage_proposals" ADD COLUMN "reasonPreset" TEXT;
ALTER TABLE "triage_proposals" ADD COLUMN "duplicateOfTaskId" TEXT;
