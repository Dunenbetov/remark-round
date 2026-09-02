/**
 * Демо-данные для фазы 1: три роли в проекте «Клиентский кабинет» и чужой проект
 * для проверки утечки. Пароль у всех — `remarkround` (только локально).
 * Запуск: DATABASE_URL=... pnpm --filter @remarkround/api seed
 */
import { PrismaClient, type Role } from '@remarkround/db';
import { hashPassword } from './auth/password';

export const SEED = {
  projectId: '11111111-1111-4111-8111-111111111111',
  otherProjectId: '22222222-2222-4222-8222-222222222222',
  password: 'remarkround',
  users: [
    { id: 'a1111111-1111-4111-8111-111111111111', email: 'dana@remarkround.dev', name: 'Дана', role: 'pm' as Role },
    { id: 'a2222222-2222-4222-8222-222222222222', email: 'aigerim@remarkround.dev', name: 'Айгерим', role: 'business' as Role },
    { id: 'a3333333-3333-4333-8333-333333333333', email: 'timur@remarkround.dev', name: 'Тимур', role: 'developer' as Role },
  ],
  otherUser: { id: 'b1111111-1111-4111-8111-111111111111', email: 'other@other-tenant.dev', name: 'Чужой', role: 'admin' as Role },
};

export async function seed(prisma: PrismaClient): Promise<void> {
  const passwordHash = hashPassword(SEED.password);

  await prisma.project.upsert({
    where: { id: SEED.projectId },
    create: { id: SEED.projectId, name: 'Клиентский кабинет' },
    update: { name: 'Клиентский кабинет' },
  });
  await prisma.project.upsert({
    where: { id: SEED.otherProjectId },
    create: { id: SEED.otherProjectId, name: 'Чужой проект' },
    update: {},
  });

  for (const u of SEED.users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, name: u.name, passwordHash },
      update: { name: u.name, passwordHash },
    });
    await prisma.membership.upsert({
      where: { userId_projectId: { userId: u.id, projectId: SEED.projectId } },
      create: { userId: u.id, projectId: SEED.projectId, role: u.role },
      update: { role: u.role },
    });
  }
  // Дана — ещё и admin проекта, чтобы управлять участниками.
  await prisma.membership.update({
    where: { userId_projectId: { userId: SEED.users[0]!.id, projectId: SEED.projectId } },
    data: { role: 'admin' },
  });

  const o = SEED.otherUser;
  await prisma.user.upsert({
    where: { email: o.email },
    create: { id: o.id, email: o.email, name: o.name, passwordHash },
    update: { passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_projectId: { userId: o.id, projectId: SEED.otherProjectId } },
    create: { userId: o.id, projectId: SEED.otherProjectId, role: o.role },
    update: {},
  });

  const docs = [
    { id: 'd1111111-1111-4111-8111-111111111111', projectId: SEED.projectId, kind: 'spec' as const, title: 'ТЗ_Клиентский_кабинет.pdf', mime: 'application/pdf' },
    { id: 'd1111111-1111-4111-8111-222222222222', projectId: SEED.projectId, kind: 'protocol' as const, title: 'Протокол_12.03.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { id: 'd2222222-2222-4222-8222-111111111111', projectId: SEED.otherProjectId, kind: 'spec' as const, title: 'ТЗ_чужого_проекта.pdf', mime: 'application/pdf' },
  ];
  for (const d of docs) {
    await prisma.document.upsert({
      where: { id: d.id },
      create: { ...d, storageKey: `seed/${d.id}`, status: 'uploaded' },
      update: { title: d.title },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log('seed: ok'))
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
