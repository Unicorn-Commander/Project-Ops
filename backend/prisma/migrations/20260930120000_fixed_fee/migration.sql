-- Flat fee on a project or a task. Nullable, no backfill: existing rows stay hourly.
ALTER TABLE "projects" ADD COLUMN "flatFeeAmount" DECIMAL(12,2);
ALTER TABLE "projects" ADD COLUMN "flatFeeInvoicedAt" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN "customerOpsCustomerId" TEXT;
ALTER TABLE "projects" ADD COLUMN "contactOpsContactId" TEXT;

ALTER TABLE "tasks" ADD COLUMN "fixedAmount" DECIMAL(12,2);
ALTER TABLE "tasks" ADD COLUMN "invoicedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "invoiceExternalRef" TEXT;
