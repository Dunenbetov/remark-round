-- Уведомления по почте (ADR 009, аудит: no-notifications): флаг в профиле и очередь писем «вас ждёт кнопка».
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('awaiting_pm', 'defect', 'ready_for_retest', 'awaiting_business_close', 'cannot_tell');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'skipped', 'failed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "notifyByEmail" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "remarkId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_status_idx" ON "Notification"("userId", "status");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
