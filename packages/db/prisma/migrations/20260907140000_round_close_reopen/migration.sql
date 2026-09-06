-- Закрытие раунда и повтор претензии (аудит: no-round-export-close, reopened-status-unreachable).
-- Round получает closedAt/closedByUserId (RoundStatus.closed становится достижимым), Remark — originRemarkId:
-- новая претензия в новом раунде помнит, какое закрытое замечание она повторяет.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- AlterTable
ALTER TABLE "Round" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Remark" ADD COLUMN     "originRemarkId" TEXT;

-- CreateIndex
CREATE INDEX "Remark_originRemarkId_idx" ON "Remark"("originRemarkId");

-- AddForeignKey
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_originRemarkId_fkey" FOREIGN KEY ("originRemarkId") REFERENCES "Remark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
