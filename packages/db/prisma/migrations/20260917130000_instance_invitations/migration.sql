-- Приглашение руководителя приёмки администратором инстанса (ADR 006, дополнение 17.09; ревью беты A-1):
-- в invite_only человек не с домена компании не мог появиться в системе, пока какой-нибудь PM не создаст проект
-- и не позовёт его. Теперь Invitation.projectId может быть NULL — такое приглашение принятием выдаёт canCreateProjects
-- и не создаёт membership. Уникальность (projectId, email) NULL не покрывает — одну строку на e-mail держит сервис.
-- HNSW-индекс DocumentChunk создан вручную в 20260903000000 и Prisma о нём не знает: DROP INDEX из автогенерации убран.
ALTER TABLE "Invitation" ALTER COLUMN "projectId" DROP NOT NULL;
