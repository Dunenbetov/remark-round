# packages/db

Канон схемы: `prisma/schema.prisma`. Статусы не расширять без правки `docs/STATUS.md`.

После первой миграции (когда появится код):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- размерность = embedding-модель (пример 1536 для text-embedding-3-small)
ALTER TABLE "DocumentChunk"
  ALTER COLUMN embedding TYPE vector(1536)
  USING embedding::vector;

CREATE INDEX document_chunk_embedding_idx
  ON "DocumentChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

Каждый retrieve: `WHERE project_id = $current`. Индекс по embedding не заменяет тенанси.
