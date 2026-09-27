ALTER TABLE "projects" ADD COLUMN "clientDescription" TEXT;
ALTER TABLE "documents" ADD COLUMN "isClientVisible" BOOLEAN NOT NULL DEFAULT false;
