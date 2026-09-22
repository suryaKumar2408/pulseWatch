-- AlterTable: Add errorCode to CheckResult
ALTER TABLE "CheckResult" ADD COLUMN "errorCode" TEXT;

-- CreateIndex: Add composite index on monitorId, success, checkedAt
CREATE INDEX "CheckResult_monitorId_success_checkedAt_idx" ON "CheckResult"("monitorId", "success", "checkedAt");
