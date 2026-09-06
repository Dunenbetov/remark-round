-- Индексы горячих путей (фаза 11): карточка читает прогоны/цитаты/кадры/вердикты по remarkId, sweep — по статусу,
-- реиндекс удаляет чанки по documentId. HNSW-индекс DocumentChunk создан вручную в 20260903000000: DROP из автогенерации убран.

-- CreateIndex
CREATE INDEX "AgentRun_remarkId_idx" ON "AgentRun"("remarkId");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "EvidenceCitation_remarkId_idx" ON "EvidenceCitation"("remarkId");

-- CreateIndex
CREATE INDEX "HumanVerdict_remarkId_idx" ON "HumanVerdict"("remarkId");

-- CreateIndex
CREATE INDEX "RemarkScreenshot_remarkId_idx" ON "RemarkScreenshot"("remarkId");
