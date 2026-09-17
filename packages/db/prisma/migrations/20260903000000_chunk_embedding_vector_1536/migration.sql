-- Размерность = text-embedding-3-small (apps/api/src/llm/embeddings.service.ts). Одна модель на индекс.
ALTER TABLE "DocumentChunk"
  ALTER COLUMN "embedding" TYPE vector(1536)
  USING "embedding"::vector(1536);

-- HNSW вместо ivfflat: не требует обучения на заполненной таблице и стабилен при малых индексах.
-- Индекс ускоряет ORDER BY <=>, но не заменяет фильтр "projectId" (packages/db/README.md).
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops);
