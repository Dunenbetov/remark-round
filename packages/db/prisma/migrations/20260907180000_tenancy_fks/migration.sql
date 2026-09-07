-- Внешние ключи тенантных и пользовательских ссылок (аудит: tenancy-not-enforced).
-- Раньше изоляция держалась только на дисциплине «не забыть projectId»; теперь Postgres не примет замечание, прогон,
-- чанк или импорт в несуществующий проект, а раунд у замечания обязан быть из того же проекта (составной FK).
-- Ссылки на людей — ON DELETE SET NULL (кто закрыл/исправил остаётся пустым, а не ломает удаление пользователя).
-- Перед FK — сироты в колонках SET NULL обнуляются; сироты в обязательных колонках останавливают миграцию
-- с понятной ошибкой (docs/PROD.md «Обновление»: проверить SELECT-ом до выката).
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- Сироты в необязательных ссылках → NULL
UPDATE "ImportRow" SET "remarkId" = NULL WHERE "remarkId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Remark" r WHERE r."id" = "ImportRow"."remarkId");
UPDATE "Remark" SET "authorId" = NULL WHERE "authorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Remark"."authorId");
UPDATE "Remark" SET "fixedByUserId" = NULL WHERE "fixedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Remark"."fixedByUserId");
UPDATE "Remark" SET "closedByUserId" = NULL WHERE "closedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Remark"."closedByUserId");
UPDATE "Remark" SET "duplicateOfId" = NULL WHERE "duplicateOfId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Remark" o WHERE o."id" = "Remark"."duplicateOfId");
UPDATE "Round" SET "closedByUserId" = NULL WHERE "closedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Round"."closedByUserId");
UPDATE "Membership" SET "invitedById" = NULL WHERE "invitedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Membership"."invitedById");
UPDATE "Invitation" SET "acceptedByUserId" = NULL WHERE "acceptedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Invitation"."acceptedByUserId");

-- Сироты в обязательных ссылках — остановить миграцию, а не молча удалить данные
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "HumanVerdict" WHERE "runId" IS NULL OR NOT EXISTS (SELECT 1 FROM "AgentRun" a WHERE a."id" = "HumanVerdict"."runId");
  IF n > 0 THEN RAISE EXCEPTION 'HumanVerdict без прогона: % строк — разобрать вручную до миграции (docs/PROD.md)', n; END IF;
  SELECT count(*) INTO n FROM "Remark" r JOIN "Round" ro ON ro."id" = r."roundId" WHERE ro."projectId" <> r."projectId";
  IF n > 0 THEN RAISE EXCEPTION 'Remark в раунде чужого проекта: % строк — разобрать вручную до миграции', n; END IF;
  SELECT count(*) INTO n FROM "ImportJob" j JOIN "Round" ro ON ro."id" = j."roundId" WHERE ro."projectId" <> j."projectId";
  IF n > 0 THEN RAISE EXCEPTION 'ImportJob в раунде чужого проекта: % строк — разобрать вручную до миграции', n; END IF;
END $$;

-- AlterTable
ALTER TABLE "HumanVerdict" ALTER COLUMN "runId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Round_id_projectId_key" ON "Round"("id", "projectId");

-- CreateIndex
CREATE INDEX "Remark_duplicateOfId_idx" ON "Remark"("duplicateOfId");

-- CreateIndex
CREATE INDEX "ImportRow_remarkId_idx" ON "ImportRow"("remarkId");

-- Составные FK на раунд того же проекта вместо простых
ALTER TABLE "Remark" DROP CONSTRAINT "Remark_roundId_fkey";
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_roundId_projectId_fkey" FOREIGN KEY ("roundId", "projectId") REFERENCES "Round"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportJob" DROP CONSTRAINT "ImportJob_roundId_fkey";
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_roundId_projectId_fkey" FOREIGN KEY ("roundId", "projectId") REFERENCES "Round"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: тенантные колонки → Project
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ссылки на людей и записи
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_fixedByUserId_fkey" FOREIGN KEY ("fixedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Remark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Round" ADD CONSTRAINT "Round_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HumanVerdict" ADD CONSTRAINT "HumanVerdict_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
