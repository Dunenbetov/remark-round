/**
 * history.append-only.spec — ADR 011: история замечания и события раунда только дописываются, кадр нельзя удалить.
 * Держит Postgres (триггер rr_append_only), а не договорённость в коде: прямой UPDATE/DELETE падает и сырым SQL.
 * Каскад FK — удаление самого замечания, раунда или человека — проходит: иначе стенды тестов, evals и seed не убрали бы
 * свои данные. Имя человека в строке — снимок: удалённый аккаунт не превращает его действие в «действие системы».
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';

describe('evidentiary history is append-only (ADR 011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  async function remarkWithHistory(number: number) {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number, description: 'Улика', status: 'imported' } });
    const shot = await h.prisma.remarkScreenshot.create({ data: { remarkId: remark.id, kind: 'original', storageKey: `${h.projectId}/${randomUUID()}.png` } });
    const row = await h.prisma.remarkStatusChange.create({ data: { remarkId: remark.id, toStatus: 'imported', action: 'create', userId: h.users.business.id, actorName: 'business', role: 'business', screenshotId: shot.id } });
    return { remark, shot, row };
  }

  it('строку истории нельзя ни поправить, ни удалить — ни через Prisma, ни сырым SQL', async () => {
    const { row } = await remarkWithHistory(9500);
    await expect(h.prisma.$executeRawUnsafe('UPDATE "RemarkStatusChange" SET "detail" = $1 WHERE "id" = $2', 'подделка', row.id)).rejects.toThrow(/только дописывается/);
    await expect(h.prisma.$executeRawUnsafe('DELETE FROM "RemarkStatusChange" WHERE "id" = $1', row.id)).rejects.toThrow(/только дописывается/);
    await expect(h.prisma.remarkStatusChange.update({ where: { id: row.id }, data: { comment: 'подделка' } })).rejects.toThrow();
    await expect(h.prisma.remarkStatusChange.deleteMany({ where: { id: row.id } })).rejects.toThrow();
    const same = await h.prisma.remarkStatusChange.findUniqueOrThrow({ where: { id: row.id } });
    expect(same).toMatchObject({ detail: null, comment: null, actorName: 'business' });
  });

  it('кадр нельзя удалить, но можно пометить заменённым', async () => {
    const { shot } = await remarkWithHistory(9501);
    await expect(h.prisma.$executeRawUnsafe('DELETE FROM "RemarkScreenshot" WHERE "id" = $1', shot.id)).rejects.toThrow(/только дописывается/);
    await h.prisma.remarkScreenshot.update({ where: { id: shot.id }, data: { supersededAt: new Date() } });
    expect((await h.prisma.remarkScreenshot.findUniqueOrThrow({ where: { id: shot.id } })).supersededAt).toBeInstanceOf(Date);
  });

  it('события раунда тоже только дописываются', async () => {
    const event = await h.prisma.roundEvent.create({ data: { roundId: h.roundId, projectId: h.projectId, action: 'close', userId: h.users.pm.id, actorName: 'pm', role: 'pm' } });
    await expect(h.prisma.$executeRawUnsafe('UPDATE "RoundEvent" SET "action" = $1 WHERE "id" = $2', 'open', event.id)).rejects.toThrow(/только дописывается/);
    await expect(h.prisma.$executeRawUnsafe('DELETE FROM "RoundEvent" WHERE "id" = $1', event.id)).rejects.toThrow(/только дописывается/);
  });

  it('каскад проходит: удаление самого замечания уносит его историю и кадры, удаление раунда — его события', async () => {
    const { remark, row, shot } = await remarkWithHistory(9502);
    await h.prisma.remark.delete({ where: { id: remark.id } });
    expect(await h.prisma.remarkStatusChange.count({ where: { id: row.id } })).toBe(0);
    expect(await h.prisma.remarkScreenshot.count({ where: { id: shot.id } })).toBe(0);

    const round = await h.prisma.round.create({ data: { projectId: h.projectId, number: 950 } });
    await h.prisma.roundEvent.create({ data: { roundId: round.id, projectId: h.projectId, action: 'open' } });
    await h.prisma.round.delete({ where: { id: round.id } });
    expect(await h.prisma.roundEvent.count({ where: { roundId: round.id } })).toBe(0);
  });

  it('аккаунт удалён — строка истории осталась с именем и ролью на момент действия', async () => {
    const gone = await h.prisma.user.create({ data: { email: `gone-${randomUUID().slice(0, 8)}@test.dev`, name: 'Бывший заказчик' } });
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9503, description: 'Кто закрыл', status: 'closed' } });
    const row = await h.prisma.remarkStatusChange.create({ data: { remarkId: remark.id, fromStatus: 'ready_for_retest', toStatus: 'closed', action: 'close', userId: gone.id, actorName: gone.name, role: 'business', comment: 'Проверила сама' } });
    await h.prisma.user.delete({ where: { id: gone.id } });

    expect(await h.prisma.remarkStatusChange.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ userId: null, actorName: 'Бывший заказчик', role: 'business', comment: 'Проверила сама' });
    const history = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${remark.id}/history`).set(h.auth('pm')).expect(200);
    expect(history.body[0].by).toEqual({ name: 'Бывший заказчик', role: 'business' });
  });
});
