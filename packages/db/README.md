# packages/db

Канон схемы: `prisma/schema.prisma`. Статусы не расширять без правки `docs/STATUS.md`. Миграции — только вперёд (`prisma migrate deploy`), откат данных — restore дампа (`docs/PROD.md`).

## Что живёт вне Prisma

- **HNSW-индекс** `DocumentChunk_embedding_hnsw_idx` (`USING hnsw ("embedding" vector_cosine_ops)`) создан вручную в миграции `20260903000000_chunk_embedding_vector_1536`: Prisma не описывает индексы по `Unsupported("vector")`, поэтому при `prisma migrate dev` автогенерация добавляет `DROP INDEX` — его нужно убирать из новой миграции руками (см. заголовки миграций). Наличие индекса проверяет `RagService` на старте и отдаёт `/health.vectorIndex`.
- **Размерность вектора** `vector(1536)` = `text-embedding-3-small`; одна модель на индекс. Смена модели — новая миграция с новой размерностью и полная переиндексация (аудит: embedding-migration).
- **Настройки роли** (`20260907130000_pg_role_settings`): `statement_timeout = 120s`, `idle_in_transaction_session_timeout = 60s` для роли, под которой идут миграции и работает API. Тяжёлая миграция (индекс на большой таблице, backfill) начинается с `SET statement_timeout = 0;` — иначе её прервёт через две минуты.
- **Триггер `rr_append_only`** (`20260913150000_evidence_history`, ADR 011): `RemarkStatusChange` и `RoundEvent` только дописываются, `RemarkScreenshot` нельзя удалить. Каскад FK (удаление замечания, раунда, человека) проходит — триггер пропускает глубину `pg_trigger_depth() > 1`. Миграция, которой нужно поправить старые строки (бэкфилл), выключает триггер у себя: `ALTER TABLE "RemarkStatusChange" DISABLE TRIGGER "RemarkStatusChange_append_only";` → `UPDATE …` → `ENABLE TRIGGER`. Prisma о триггере не знает и в диффе схемы его не показывает.
- **pg_stat_statements**: расширение создаётся миграцией, `shared_preload_libraries` — в команде контейнера postgres (`docker-compose.yml`). Для локального Postgres без preload расширение создаётся, но представление пустое.

## Целостность ссылок

С `20260907180000_tenancy_fks` тенантные колонки держат внешние ключи: `Remark/AgentRun/DocumentChunk/ImportJob.projectId → Project` (RESTRICT), `Remark/ImportJob (roundId, projectId) → Round (id, projectId)` — раунд обязан быть из того же проекта, ссылки на людей (`authorId`, `fixedByUserId`, `closedByUserId`, `invitedById`, `acceptedByUserId`) — `SET NULL`, `HumanVerdict.runId` обязателен и ссылается на `AgentRun`. Без FK остаются только `Job.projectId/runId` (очередь переживает удаление ресурсов) и `GraphCheckpoint` (каскад от прогона есть). Новая колонка с `projectId` или `*UserId` без `@relation` — ошибка ревью. Проверка сирот перед выкатом этой миграции — в `docs/PROD.md` («Обновление»).

## Новая миграция

```bash
pnpm db:migrate -- --name <slug>     # prisma migrate dev: генерирует SQL, применяет локально
# открыть migration.sql: убрать DROP INDEX HNSW (если появился), добавить заголовок-комментарий «зачем»
pnpm db:generate && pnpm --filter @remarkround/db build
```

Миграции с потерей данных (DROP COLUMN, смена типа) — сначала репетиция на копии прод-дампа (`docs/adr/008-release-and-ownership.md`).
