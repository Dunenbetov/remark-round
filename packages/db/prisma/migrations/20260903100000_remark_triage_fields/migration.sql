-- Фаза 3: номер замечания в раунде, автор, черновик разбора и итоги ретеста на Remark.
CREATE TYPE "ProposedClass" AS ENUM ('defect_candidate', 'change_request_candidate', 'unspecified', 'duplicate', 'cannot_tell');
CREATE TYPE "RetestOutcome" AS ENUM ('likely_addressed', 'likely_unchanged', 'cannot_tell');

ALTER TABLE "Remark"
  ADD COLUMN "number" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "authorId" TEXT,
  ADD COLUMN "proposedClass" "ProposedClass",
  ADD COLUMN "rationale" TEXT,
  ADD COLUMN "visionFacts" TEXT,
  ADD COLUMN "retestOutcome" "RetestOutcome",
  ADD COLUMN "retestExplanation" TEXT,
  ADD COLUMN "fixedByUserId" TEXT,
  ADD COLUMN "closedByUserId" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "Remark" ALTER COLUMN "number" DROP DEFAULT;

CREATE UNIQUE INDEX "Remark_roundId_number_key" ON "Remark"("roundId", "number");
