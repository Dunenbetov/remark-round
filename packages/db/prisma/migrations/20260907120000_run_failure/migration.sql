-- Причина сбоя прогона (аудит: no-error-tracking): до этого failed был без объяснения, а PM видел одно и то же
-- «Не получилось разобрать». Код — для логов и статистики, текст — для карточки.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "failureMessage" TEXT;
