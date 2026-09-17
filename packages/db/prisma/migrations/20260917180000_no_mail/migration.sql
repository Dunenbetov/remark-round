-- Без почты (ADR 013, решение владельца 17.09): ни SMTP, ни писем «вас ждёт кнопка». Уходят таблица уведомлений,
-- её перечисления, флаг писем в профиле и задачи очереди почтовых видов — обработчиков у них больше нет,
-- воркер пометил бы их failed с «нет обработчика». Миграция написана руками: HNSW-индекс DocumentChunk
-- (20260903000000) Prisma не видит, автогенерация предложила бы его снести.

-- DropTable
DROP TABLE "Notification";

-- DropEnum
DROP TYPE "NotificationKind";

-- DropEnum
DROP TYPE "NotificationStatus";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "notifyByEmail";

-- Задачи писем: payload send_mail мог хранить сырую ссылку /join/<token> или /reset/<token>
DELETE FROM "Job" WHERE "kind" IN ('send_mail', 'notify_digest');
