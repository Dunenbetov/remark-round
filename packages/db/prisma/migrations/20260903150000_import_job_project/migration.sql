-- Фаза 4: импорт шаблона журнала. projectId на ImportJob для SQL-тенанси, имя файла, причина у строки.
ALTER TABLE "ImportJob"
  ADD COLUMN "projectId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "fileName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ImportJob" ALTER COLUMN "projectId" DROP DEFAULT;
ALTER TABLE "ImportJob" ALTER COLUMN "fileName" DROP DEFAULT;
CREATE INDEX "ImportJob_projectId_idx" ON "ImportJob"("projectId");

ALTER TABLE "ImportRow" ADD COLUMN "reason" TEXT;
CREATE INDEX "ImportRow_jobId_idx" ON "ImportRow"("jobId");
