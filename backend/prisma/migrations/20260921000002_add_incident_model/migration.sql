-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable: Incident
CREATE TABLE "Incident" (
    "id"              TEXT             NOT NULL,
    "monitorId"       TEXT             NOT NULL,
    "userId"          TEXT             NOT NULL,
    "status"          "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "cause"           TEXT,
    "errorCode"       TEXT,
    "statusCode"      INTEGER,
    "startedAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"      TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Incident
CREATE INDEX "Incident_monitorId_idx"           ON "Incident"("monitorId");
CREATE INDEX "Incident_userId_idx"              ON "Incident"("userId");
CREATE INDEX "Incident_status_idx"              ON "Incident"("status");
CREATE INDEX "Incident_monitorId_status_idx"     ON "Incident"("monitorId", "status");
CREATE INDEX "Incident_monitorId_startedAt_idx"  ON "Incident"("monitorId", "startedAt");
CREATE INDEX "Incident_userId_startedAt_idx"     ON "Incident"("userId", "startedAt");

-- AddForeignKey: Incident → Monitor
ALTER TABLE "Incident"
    ADD CONSTRAINT "Incident_monitorId_fkey"
    FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Incident → User
ALTER TABLE "Incident"
    ADD CONSTRAINT "Incident_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
