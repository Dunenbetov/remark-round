-- Фаза 6: GraphCheckpoint становится хранилищем чекпоинтов LangGraph (thread_id = AgentRun.id)
ALTER TABLE "GraphCheckpoint"
  ADD COLUMN "ns" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "checkpointId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "writes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "GraphCheckpoint" ALTER COLUMN "checkpointId" DROP DEFAULT;

CREATE UNIQUE INDEX "GraphCheckpoint_runId_ns_checkpointId_key" ON "GraphCheckpoint"("runId", "ns", "checkpointId");
