-- История замечания (аудит: remark-history-missing): строка на переход, updatedAt у Remark, снимок предложения модели в AgentRun.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- AlterTable: существующим строкам — момент миграции, дальше пишет Prisma (@updatedAt)
ALTER TABLE "Remark" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Remark" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "proposedClass" "ProposedClass",
ADD COLUMN "rationale" TEXT,
ADD COLUMN "visionFacts" TEXT;

-- CreateTable
CREATE TABLE "RemarkStatusChange" (
    "id" TEXT NOT NULL,
    "remarkId" TEXT NOT NULL,
    "fromStatus" "RemarkStatus",
    "toStatus" "RemarkStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "runId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemarkStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemarkStatusChange_remarkId_createdAt_idx" ON "RemarkStatusChange"("remarkId", "createdAt");

-- AddForeignKey
ALTER TABLE "RemarkStatusChange" ADD CONSTRAINT "RemarkStatusChange_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemarkStatusChange" ADD CONSTRAINT "RemarkStatusChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
