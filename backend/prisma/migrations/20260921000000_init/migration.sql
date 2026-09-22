-- PulseWatch initial schema migration
-- Applied by: prisma migrate deploy (production) / prisma migrate dev (development)

-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

-- CreateTable: User
CREATE TABLE "User" (
    "id"        TEXT        NOT NULL,
    "email"     TEXT        NOT NULL,
    "password"  TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Monitor
CREATE TABLE "Monitor" (
    "id"                   TEXT            NOT NULL,
    "userId"               TEXT            NOT NULL,
    "name"                 TEXT            NOT NULL,
    "url"                  TEXT            NOT NULL,
    "method"               TEXT            NOT NULL DEFAULT 'GET',
    "intervalSeconds"      INTEGER         NOT NULL DEFAULT 60,
    "timeoutSeconds"       INTEGER         NOT NULL DEFAULT 10,
    "expectedCodes"        INTEGER[]                DEFAULT ARRAY[200]::INTEGER[],
    "enabled"              BOOLEAN         NOT NULL DEFAULT true,
    "status"               "MonitorStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consecutiveFailures"  INTEGER         NOT NULL DEFAULT 0,
    "consecutiveSuccesses" INTEGER         NOT NULL DEFAULT 0,
    "lastCheckedAt"        TIMESTAMP(3),
    "lastResponseTimeMs"   INTEGER,
    "createdAt"            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CheckResult
CREATE TABLE "CheckResult" (
    "id"             TEXT         NOT NULL,
    "monitorId"      TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "success"        BOOLEAN      NOT NULL,
    "statusCode"     INTEGER,
    "responseTimeMs" INTEGER,
    "errorMessage"   TEXT,
    "checkedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: User
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex: Monitor
CREATE INDEX "Monitor_userId_idx"         ON "Monitor"("userId");
CREATE INDEX "Monitor_enabled_idx"        ON "Monitor"("enabled");
CREATE INDEX "Monitor_status_idx"         ON "Monitor"("status");
CREATE INDEX "Monitor_userId_enabled_idx" ON "Monitor"("userId", "enabled");

-- CreateIndex: CheckResult
CREATE INDEX "CheckResult_monitorId_idx"            ON "CheckResult"("monitorId");
CREATE INDEX "CheckResult_monitorId_checkedAt_idx"  ON "CheckResult"("monitorId", "checkedAt");
CREATE INDEX "CheckResult_userId_checkedAt_idx"     ON "CheckResult"("userId", "checkedAt");

-- AddForeignKey: Monitor → User
ALTER TABLE "Monitor"
    ADD CONSTRAINT "Monitor_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CheckResult → Monitor
ALTER TABLE "CheckResult"
    ADD CONSTRAINT "CheckResult_monitorId_fkey"
    FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
