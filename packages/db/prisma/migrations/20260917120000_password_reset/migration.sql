-- Сброс пароля по e-mail (ADR 012, ревью беты I-5): приглашённый, забывший пароль, раньше не мог войти —
-- администратор чужие пароли не сбрасывает, а «забыли пароль» не было. Токен хранится sha256-хэшем (как у приглашений),
-- живёт час, одноразовый (usedAt); новый запрос удаляет прежние неиспользованные ссылки человека.
-- Письмо со ссылкой /reset/<token> — задача send_mail, строка которой удаляется сразу после отправки.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
