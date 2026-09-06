-- Улики-цитаты как снимок (аудит: evidence-citation-dangling). До этого EvidenceCitation держала только chunkId
-- без FK: переиндексация документа удаляла чанки и цитаты молча исчезали из карточек, включая закрытые.
-- Теперь текст и подпись документа копируются в цитату, chunkId становится nullable-ссылкой с ON DELETE SET NULL.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.

-- AlterTable
ALTER TABLE "EvidenceCitation" ADD COLUMN     "documentKind" "DocumentKind",
ADD COLUMN     "documentTitle" TEXT,
ADD COLUMN     "effectiveAt" TIMESTAMP(3),
ADD COLUMN     "quoteText" TEXT,
ADD COLUMN     "section" TEXT,
ALTER COLUMN "chunkId" DROP NOT NULL;

-- Снимок для существующих цитат, у которых чанк ещё жив
UPDATE "EvidenceCitation" c
SET "quoteText" = ch."content", "section" = ch."section", "documentTitle" = d."title", "documentKind" = d."kind", "effectiveAt" = d."effectiveAt"
FROM "DocumentChunk" ch JOIN "Document" d ON d."id" = ch."documentId"
WHERE ch."id" = c."chunkId";

-- Висячие ссылки (чанк уже переиндексирован): текста больше нет, ссылка обнуляется — иначе FK не встанет
UPDATE "EvidenceCitation" SET "chunkId" = NULL WHERE "chunkId" IS NOT NULL AND "chunkId" NOT IN (SELECT "id" FROM "DocumentChunk");

-- CreateIndex
CREATE INDEX "EvidenceCitation_chunkId_idx" ON "EvidenceCitation"("chunkId");

-- AddForeignKey
ALTER TABLE "EvidenceCitation" ADD CONSTRAINT "EvidenceCitation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
