-- Совет разработчика (DeveloperAdvice): рекомендация по замечанию в awaiting_pm, не вердикт. Один на человека и замечание.
CREATE TABLE "DeveloperAdvice" (
  "id" TEXT NOT NULL,
  "remarkId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" "VerdictCode" NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeveloperAdvice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeveloperAdvice_remarkId_userId_key" ON "DeveloperAdvice"("remarkId", "userId");

ALTER TABLE "DeveloperAdvice" ADD CONSTRAINT "DeveloperAdvice_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeveloperAdvice" ADD CONSTRAINT "DeveloperAdvice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
