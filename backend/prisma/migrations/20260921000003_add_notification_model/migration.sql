-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('MONITOR_DOWN', 'MONITOR_RECOVERED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WEBHOOK');

-- CreateTable: Notification
CREATE TABLE "Notification" (
    "id"          TEXT                  NOT NULL,
    "userId"      TEXT                  NOT NULL,
    "monitorId"   TEXT                  NOT NULL,
    "incidentId"  TEXT,
    "event"       "NotificationEvent"   NOT NULL,
    "channel"     "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipient"   TEXT                  NOT NULL,
    "subject"     TEXT,
    "body"        TEXT,
    "status"      "NotificationStatus"  NOT NULL DEFAULT 'PENDING',
    "error"       TEXT,
    "attempts"    INTEGER               NOT NULL DEFAULT 0,
    "sentAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Notification
CREATE INDEX "Notification_userId_idx"     ON "Notification"("userId");
CREATE INDEX "Notification_monitorId_idx"  ON "Notification"("monitorId");
CREATE INDEX "Notification_incidentId_idx" ON "Notification"("incidentId");
CREATE INDEX "Notification_status_idx"     ON "Notification"("status");
CREATE INDEX "Notification_createdAt_idx"  ON "Notification"("createdAt");

-- AddForeignKey: Notification → User
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Notification → Monitor
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_monitorId_fkey"
    FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Notification → Incident
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
