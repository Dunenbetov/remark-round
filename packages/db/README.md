# packages/db

Источник схемы: `prisma/schema.prisma`. Новый статус добавляется только вместе с правкой `docs/STATUS.md`. Миграции идут только вперед (`prisma migrate deploy`), данные откатываются восстановлением дампа (`docs/PROD.md`).

## Что живет вне Prisma

- HNSW-индекс `DocumentChunk_embedding_hnsw_idx` (`USING hnsw ("embedding" vector_cosine_ops)`) создан вручную в миграции `20260903000000_chunk_embedding_vector_1536`. Prisma не описывает индексы по `Unsupported("vector")`, поэтому `prisma migrate dev` добавляет в новую миграцию `DROP INDEX`, и его нужно убирать руками (см. заголовки миграций). `RagService` проверяет индекс на старте и отдает результат в `/health.vectorIndex`.
- Размерность вектора `vector(1536)` соответствует `text-embedding-3-small`, на индекс одна модель. Смена модели требует новой миграции с новой размерностью и полной переиндексации.
- Настройки роли (`20260907130000_pg_role_settings`): `statement_timeout = 120s` и `idle_in_transaction_session_timeout = 60s` для роли, под которой идут миграции и работает API. Тяжелая миграция (индекс на большой таблице, backfill) начинается с `SET statement_timeout = 0;`, иначе ее прервет таймаут через две минуты.
- Триггер `rr_append_only` (`20260913150000_evidence_history`, ADR 011): `RemarkStatusChange` и `RoundEvent` только дописываются, `RemarkScreenshot` нельзя удалить. Каскад FK (удаление замечания, раунда, человека) проходит, потому что триггер пропускает глубину `pg_trigger_depth() > 1`. Миграция, которой нужно поправить старые строки (бэкфилл), выключает триггер у себя: `ALTER TABLE "RemarkStatusChange" DISABLE TRIGGER "RemarkStatusChange_append_only";` → `UPDATE …` → `ENABLE TRIGGER`. Prisma о триггере не знает и в диффе схемы его не показывает.
- `pg_stat_statements`: расширение создается миграцией, `shared_preload_libraries` задан в команде контейнера postgres (`docker-compose.yml`). На локальном Postgres без preload расширение создается, но представление остается пустым.

## Целостность ссылок

С миграции `20260907180000_tenancy_fks` тенантные колонки держат внешние ключи:

- `Remark/AgentRun/DocumentChunk/ImportJob.projectId → Project` (RESTRICT);
- `Remark/ImportJob (roundId, projectId) → Round (id, projectId)`: раунд обязан быть из того же проекта;
- ссылки на людей (`authorId`, `fixedByUserId`, `closedByUserId`, `invitedById`, `acceptedByUserId`) с `SET NULL`;
- `HumanVerdict.runId` обязателен и ссылается на `AgentRun`.

Без внешних ключей остаются только `Job.projectId` и `Job.runId`: очередь переживает удаление ресурсов. У `GraphCheckpoint` нет `projectId`, его строки удаляются каскадом от прогона. Новая колонка с `projectId` или `*UserId` без `@relation` не проходит ревью. Как проверить сирот перед выкатом этой миграции, описано в `docs/PROD.md` (раздел "Обновление").

У `Notification` (`20260924100000_notifications`, ADR 016) все четыре внешних ключа (`userId`, `projectId`, `remarkId`, `changeId → RemarkStatusChange`) с `ON DELETE CASCADE`. Каскад от строки истории проходит триггер `rr_append_only` так же, как каскад от замечания.

## Новая миграция

```bash
pnpm db:migrate -- --name <slug>     # prisma migrate dev: генерирует SQL, применяет локально
# открыть migration.sql: убрать DROP INDEX HNSW (если появился), добавить в начало комментарий, зачем нужна миграция
pnpm db:generate && pnpm --filter @remarkround/db build
```

Сверять миграции со схемой (`prisma migrate diff --from-migrations … --shadow-database-url …`) можно только на отдельной пустой базе. Prisma сбрасывает теневую базу целиком, рабочий `DATABASE_URL` туда передавать нельзя.

Миграцию с потерей данных (DROP COLUMN, смена типа) сначала репетируют на копии прод-дампа (`docs/adr/008-release-and-ownership.md`).
