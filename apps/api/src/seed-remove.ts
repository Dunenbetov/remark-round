/**
 * Убрать демо-данные (D-1 ревью беты): 4 демо-пользователя и 2 демо-проекта seed.ts по фиксированным id — на случай,
 * если том стенда доехал до прода. Порядок — от листьев к корням: ссылки на Project без каскада (Remark, AgentRun,
 * DocumentChunk, ImportJob — RESTRICT), история и кадры уходят каскадом вместе с замечанием (триггер «только
 * дописывается» пропускает каскад, ADR 011). Других данных не трогает — только эти id. Файлы кадров в storage остаются.
 * Запуск: pnpm --filter @remarkround/api seed:remove  |  docker compose run --rm api seed:remove
 */
import type { PrismaClient } from '@remarkround/db';
import { PrismaService } from './prisma/prisma.service';
import { SEED } from './seed';

export interface SeedRemovalIds {
  projectIds: string[];
  userIds: string[];
}

export const DEMO_IDS: SeedRemovalIds = {
  projectIds: [SEED.projectId, SEED.otherProjectId],
  userIds: [...SEED.users.map((u) => u.id), SEED.otherUser.id],
};

export async function removeSeed(prisma: PrismaClient, ids: SeedRemovalIds = DEMO_IDS): Promise<{ projects: number; users: number }> {
  return prisma.$transaction(
    async (tx) => {
      const { projectIds, userIds } = ids;
      const remarkIds = (await tx.remark.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((r) => r.id);
      await tx.developerAdvice.deleteMany({ where: { remarkId: { in: remarkIds } } });
      await tx.humanVerdict.deleteMany({ where: { remarkId: { in: remarkIds } } });
      await tx.agentRun.deleteMany({ where: { projectId: { in: projectIds } } });
      // Каскадом: история, кадры, цитаты, уведомления, советы
      await tx.remark.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.importJob.deleteMany({ where: { projectId: { in: projectIds } } });
      // Каскадом: события раунда
      await tx.round.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.documentChunk.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.document.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.invitation.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { invitedById: { in: userIds } }] } });
      await tx.membership.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] } });
      await tx.job.deleteMany({ where: { projectId: { in: projectIds } } });
      const projects = await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      // Каскадом: сбросы пароля, уведомления; авторство в чужих проектах обнуляется (SetNull)
      const users = await tx.user.deleteMany({ where: { id: { in: userIds } } });
      return { projects: projects.count, users: users.count };
    },
    { timeout: 120_000 },
  );
}

if (require.main === module) {
  const prisma = new PrismaService();
  removeSeed(prisma)
    .then((r) => console.log(`seed:remove: удалено проектов ${r.projects}, пользователей ${r.users}`))
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
