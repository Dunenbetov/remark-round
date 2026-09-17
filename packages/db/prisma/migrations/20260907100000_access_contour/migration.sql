-- Контур доступа (ADR 006): право создавать проекты как флаг, отключение пользователя и версия сессий
-- для администратора инстанса; токен приглашения хранится хэшем. Данные не теряются: живые ссылки
-- продолжают работать, потому что сервер сравнивает sha256(token) с "tokenHash".
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canCreateProjects" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Invitation.token -> tokenHash: переименование колонки и уникального индекса, затем хэш на месте
ALTER TABLE "Invitation" RENAME COLUMN "token" TO "tokenHash";
ALTER INDEX "Invitation_token_key" RENAME TO "Invitation_tokenHash_key";
UPDATE "Invitation" SET "tokenHash" = encode(sha256(convert_to("tokenHash", 'UTF8')), 'hex');
