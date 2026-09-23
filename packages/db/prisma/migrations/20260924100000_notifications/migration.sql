-- Уведомления в продукте (ADR 016, решение владельца 23.09): колокольчик «ждёт вас» / «к сведению» по замечаниям.
-- Только добавляет: новая таблица, индексы и внешние ключи, существующие строки не трогаются — выкат без простоя,
-- откат — restore дампа (docs/PROD.md). Прежняя таблица «Notification» (письма, ADR 009) удалена в 20260917180000_no_mail;
-- эта — другая: строка на адресата и строку истории, данные события берутся из RemarkStatusChange по changeId.
-- Все FK — ON DELETE CASCADE: удаление замечания, проекта, человека или строки истории (каскадом, триггер
-- rr_append_only его пропускает) уносит и уведомления. Миграция написана руками: HNSW-индекс DocumentChunk
-- (20260903000000) Prisma не видит, автогенерация предложила бы его снести.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "remarkId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_changeId_userId_key" ON "Notification"("changeId", "userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_remarkId_idx" ON "Notification"("remarkId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "RemarkStatusChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
