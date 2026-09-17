-- Доказательная история (ADR 011): через год на «№ 13 раунда 2 не сделали» карточка должна показать, кто, что и когда.
--  * имя человека — снимком в строке истории: переименование и удаление аккаунта её не меняют;
--  * кадры не удаляются: «не исправлено», новый ретест и отмена помечают прежний кадр заменённым (supersededAt),
--    строка истории ссылается на кадр своего действия (screenshotId);
--  * события раунда (открыт / закрыт / открыт снова) — отдельная таблица, Round.closedAt перезаписывается;
--  * история и события раунда только дописываются, кадр нельзя удалить — это держит Postgres (триггер rr_append_only),
--    а не договорённость в коде. Каскад FK (удаление самого замечания, раунда или человека) приходит из RI-триггера
--    на глубине > 1 и пропускается: иначе стенды тестов, evals и seed не могли бы убрать свои данные.
-- Порядок: сначала бэкфиллы, потом триггер — после него UPDATE истории невозможен.
-- Round.createdAt у раундов до миграции — время первого замечания (приблизительно; пустой раунд — момент миграции).
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

SET statement_timeout = 0;

-- AlterTable
ALTER TABLE "RemarkStatusChange" ADD COLUMN "actorName" TEXT,
ADD COLUMN "screenshotId" TEXT;

-- AlterTable
ALTER TABLE "RemarkScreenshot" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Round" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "RoundEvent" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "actorName" TEXT,
    "role" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundEvent_roundId_createdAt_idx" ON "RoundEvent"("roundId", "createdAt");

-- CreateIndex
CREATE INDEX "RoundEvent_projectId_idx" ON "RoundEvent"("projectId");

-- AddForeignKey
ALTER TABLE "RoundEvent" ADD CONSTRAINT "RoundEvent_roundId_projectId_fkey" FOREIGN KEY ("roundId", "projectId") REFERENCES "Round"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundEvent" ADD CONSTRAINT "RoundEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundEvent" ADD CONSTRAINT "RoundEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Бэкфилл: имя на момент миграции — лучшее, что есть для старых строк
UPDATE "RemarkStatusChange" h SET "actorName" = u."name" FROM "User" u WHERE u."id" = h."userId";

-- Бэкфилл: комментарий к вердикту жил только в HumanVerdict — переносим в его строку истории (тот же прогон и вид, в пределах 2 с)
UPDATE "RemarkStatusChange" h SET "comment" = v."comment"
  FROM "HumanVerdict" v
 WHERE h."comment" IS NULL AND v."comment" IS NOT NULL
   AND h."remarkId" = v."remarkId" AND h."runId" = v."runId"
   AND h."action" IN ('verdict', 'rejected_binding')
   AND ((h."action" = 'rejected_binding') = (v."code" = 'rejected_binding'))
   AND abs(extract(epoch FROM h."createdAt" - v."createdAt")) < 2;

-- Бэкфилл: раунд открыт не позже своего первого замечания
UPDATE "Round" r SET "createdAt" = m.first
  FROM (SELECT "roundId", MIN("createdAt") AS first FROM "Remark" GROUP BY "roundId") m
 WHERE m."roundId" = r."id" AND m.first < r."createdAt";

-- Бэкфилл: уже закрытые раунды получают событие «закрыт» (кто открывал старые раунды — неизвестно, «открыт» не выдумываем)
INSERT INTO "RoundEvent" ("id", "roundId", "projectId", "action", "userId", "actorName", "role", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."projectId", 'close', r."closedByUserId", u."name", ms."role", r."closedAt"
  FROM "Round" r
  LEFT JOIN "User" u ON u."id" = r."closedByUserId"
  LEFT JOIN "Membership" ms ON ms."userId" = r."closedByUserId" AND ms."projectId" = r."projectId"
 WHERE r."status" = 'closed' AND r."closedAt" IS NOT NULL;

-- Только дописывается. BEFORE обязателен: RI-каскад выполняет запрос с fire_triggers = false, и AFTER-триггер
-- дочерней таблицы откладывался бы на внешний запрос с глубиной 1 — каскад было бы не отличить от прямого DELETE.
CREATE FUNCTION "rr_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'История только дописывается: % в "%" запрещён (ADR 011)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "RemarkStatusChange_append_only" BEFORE UPDATE OR DELETE ON "RemarkStatusChange" FOR EACH ROW EXECUTE FUNCTION "rr_append_only"();
CREATE TRIGGER "RoundEvent_append_only" BEFORE UPDATE OR DELETE ON "RoundEvent" FOR EACH ROW EXECUTE FUNCTION "rr_append_only"();
-- Кадр можно пометить заменённым и дописать ему размеры, но не удалить: на него ссылается история
CREATE TRIGGER "RemarkScreenshot_no_delete" BEFORE DELETE ON "RemarkScreenshot" FOR EACH ROW EXECUTE FUNCTION "rr_append_only"();
