/**
 * seed-remove.spec — D-1 ревью беты: удаление демо-данных проходит триггер «только дописывается» (каскад) и не оставляет
 * следов. Проверяется на своих throwaway-id, а не на демо-стенде: тестовая БД — та же, что у стенда разработчика.
 */
import { PrismaClient } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth/password';
import { removeSeed } from './seed-remove';

describe('seed:remove', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('удаляет проект с раундом, замечанием, историей, кадром и событиями раунда и его людей; чужие данные не трогает', async () => {
    const tag = randomUUID().slice(0, 8);
    const passwordHash = await hashPassword('secret-12');
    const pm = await prisma.user.create({ data: { email: `rm-pm-${tag}@test.dev`, name: 'PM', passwordHash } });
    const outsider = await prisma.user.create({ data: { email: `rm-out-${tag}@test.dev`, name: 'Чужой', passwordHash } });
    const project = await prisma.project.create({ data: { name: `RM-${tag}`, slug: `rm-${tag}`, memberships: { create: { userId: pm.id, role: 'pm' } } } });
    const keep = await prisma.project.create({ data: { name: `KEEP-${tag}`, slug: `keep-${tag}`, memberships: { create: { userId: outsider.id, role: 'pm' } } } });
    const round = await prisma.round.create({ data: { projectId: project.id, number: 1 } });
    await prisma.roundEvent.create({ data: { roundId: round.id, projectId: project.id, action: 'open', userId: pm.id, actorName: 'PM', role: 'pm' } });
    const remark = await prisma.remark.create({ data: { projectId: project.id, roundId: round.id, number: 1, description: 'Нет кнопки', status: 'imported', authorId: pm.id } });
    await prisma.remarkStatusChange.create({ data: { remarkId: remark.id, toStatus: 'imported', action: 'create', userId: pm.id, actorName: 'PM', role: 'pm' } });
    await prisma.remarkScreenshot.create({ data: { remarkId: remark.id, kind: 'retest', storageKey: `${project.id}/${randomUUID()}.png` } });
    await prisma.invitation.create({ data: { projectId: project.id, email: `rm-inv-${tag}@test.dev`, role: 'developer', tokenHash: `hash-${tag}`, invitedById: pm.id } });

    const result = await removeSeed(prisma, { projectIds: [project.id], userIds: [pm.id] });
    expect(result).toEqual({ projects: 1, users: 1 });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: pm.id } })).toBeNull();
    expect(await prisma.remarkStatusChange.count({ where: { remarkId: remark.id } })).toBe(0);
    expect(await prisma.roundEvent.count({ where: { roundId: round.id } })).toBe(0);
    expect(await prisma.invitation.count({ where: { projectId: project.id } })).toBe(0);
    // Соседний проект и его человек на месте
    expect(await prisma.project.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(await prisma.membership.count({ where: { projectId: keep.id } })).toBe(1);

    await prisma.membership.deleteMany({ where: { projectId: keep.id } });
    await prisma.project.delete({ where: { id: keep.id } });
    await prisma.user.delete({ where: { id: outsider.id } });
  });
});
