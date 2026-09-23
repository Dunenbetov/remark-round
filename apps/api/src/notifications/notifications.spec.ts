/**
 * notifications.spec — колокольчик о замечаниях (ADR 016): кому что приходит, «действовать = прочитать», только свои
 * строки в текущей роли, без слов команды и черновика модели (ADR 007), MCP-токену маршрута нет, и главное —
 * сбой уведомлений не отменяет решение человека (SAVEPOINT).
 */
import { randomUUID } from 'node:crypto';
import type { Role } from '@remarkround/db';
import { hashPassword } from '../auth/password';
import { RemarksService } from '../remarks/remarks.service';
import { createHarness, PASSWORD, type Harness } from '../../test/harness';
import { NotificationsService } from './notifications.service';

type Item = {
  id: string;
  kind: 'action' | 'info';
  at: string;
  readAt: string | null;
  project: { id: string; name: string; slug: string };
  remark: { id: string; number: number; roundNumber: number; title: string | null; status: string; readable: boolean };
  event: { action: string; fromStatus: string | null; toStatus: string };
  by: { name: string; role: string | null } | null;
};
type Page = { items: Item[]; unread: number; hasMore: boolean };

const SECRET = 'Внутренний комментарий руководителя приёмки 7c1f';
const FORBIDDEN_KEYS = ['comment', 'detail', 'rationale', 'proposedClass', 'advice', 'runId', 'draft', 'citations'];

describe('notifications', () => {
  let h: Harness;
  const extra: Record<'business2' | 'disabledDev', { id: string; token?: string }> = {} as never;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    h = await createHarness();
    const tag = randomUUID().slice(0, 8);
    const passwordHash = await hashPassword(PASSWORD);
    // Второй заказчик: «другим заказчикам» приходит всё, что сделал первый (автор исключается сам)
    const b2 = await h.prisma.user.create({ data: { email: `business2-${tag}@test.dev`, name: 'Второй заказчик', passwordHash, preferredRole: 'business' } });
    await h.prisma.membership.create({ data: { userId: b2.id, projectId: h.projectId, role: 'business' } });
    const login = await h.http.post('/api/v1/auth/login').send({ email: b2.email, password: PASSWORD }).expect(200);
    extra.business2 = { id: b2.id, token: login.body.accessToken };
    const off = await h.prisma.user.create({ data: { email: `disabled-dev-${tag}@test.dev`, name: 'Отключённый', passwordHash, disabledAt: new Date() } });
    await h.prisma.membership.create({ data: { userId: off.id, projectId: h.projectId, role: 'developer' } });
    extra.disabledDev = { id: off.id };
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const ids = Object.values(extra).map((u) => u.id);
    await h.prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await h.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await h.cleanup();
  });

  const headers = (who: Role | 'business2'): Record<string, string> => (who === 'business2' ? bearer(extra.business2.token!) : h.auth(who));

  async function page(who: Role | 'business2', query = ''): Promise<Page> {
    return (await h.http.get(`/api/v1/auth/notifications${query}`).set(headers(who)).expect(200)).body as Page;
  }

  async function about(who: Role | 'business2', remarkId: string): Promise<Item[]> {
    return (await page(who, '?limit=50')).items.filter((i) => i.remark.id === remarkId);
  }

  /** Замечание через граф до awaiting_pm: предложение модели — событие системы. */
  async function awaitingPm(description: string): Promise<{ id: string; runId: string }> {
    const created = await h.http.post(url(`/rounds/${h.roundId}/remarks`)).set(h.auth('business')).send({ description, pageOrScreen: 'Профиль' }).expect(201);
    const card = await h.waitFor(created.body.id, ['awaiting_pm']);
    return { id: created.body.id, runId: card.runId };
  }

  function verdict(who: Role, remark: { id: string; runId: string }, code: string, comment?: string) {
    return h.http.post(url(`/remarks/${remark.id}/verdict`)).set(h.auth(who)).send({ runId: remark.runId, verdict: code, idempotencyKey: randomUUID(), comment });
  }

  /** Замечание в нужном статусе без графа: ready_for_retest, awaiting_business_close и дальше не зовут модель. */
  let seq = 9500;
  async function seeded(status: 'defect' | 'ready_for_retest' | 'awaiting_business_close'): Promise<string> {
    const r = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: seq++, description: `Посеяно в ${status}\nвторая строка`, status } });
    return r.id;
  }

  it('предложение модели → руководителю «ждёт вас»; решение PM → разработчику «ждёт вас», заказчикам «к сведению», своё PM прочитано', async () => {
    const remark = await awaitingPm('Кнопка «Сохранить» серая, а в ТЗ primary синяя');

    const [pmItem] = await about('pm', remark.id);
    expect(pmItem).toMatchObject({ kind: 'action', readAt: null, event: { action: 'proposal', fromStatus: 'triaging', toStatus: 'awaiting_pm' }, by: null });
    expect(pmItem!.remark).toMatchObject({ status: 'awaiting_pm', readable: true, roundNumber: 1, title: expect.stringContaining('Сохранить') });
    // legacy-роль admin в проекте — та же сторона, что pm
    expect((await about('admin', remark.id)).map((i) => i.kind)).toEqual(['action']);
    expect(await about('developer', remark.id)).toEqual([]);
    expect(await about('business', remark.id)).toEqual([]);

    await verdict('pm', remark, 'defect', SECRET).expect(200);

    // «Действовать = прочитать»: решение PM гасит его «ждёт вас»; у admin — нет, он не действовал
    const pmAfter = await about('pm', remark.id);
    expect(pmAfter).toHaveLength(1);
    expect(pmAfter[0]!.readAt).not.toBeNull();
    expect((await about('admin', remark.id))[0]!.readAt).toBeNull();

    const [dev] = await about('developer', remark.id);
    expect(dev).toMatchObject({ kind: 'action', event: { action: 'verdict', fromStatus: 'awaiting_pm', toStatus: 'defect' }, by: { name: 'pm', role: 'pm' } });
    expect(dev!.remark).toMatchObject({ readable: true, status: 'defect' });
    for (const who of ['business', 'business2'] as const) {
      const items = await about(who, remark.id);
      expect(items.map((i) => [i.event.action, i.kind])).toEqual([['verdict', 'info']]);
    }

    // Отключённому ничего не пишется
    expect(await h.prisma.notification.count({ where: { userId: extra.disabledDev.id } })).toBe(0);

    // Ни одной роли — ни слов команды, ни черновика модели (ADR 007)
    for (const who of ['pm', 'admin', 'developer', 'business', 'business2'] as const) {
      const raw = JSON.stringify(await page(who, '?limit=50'));
      expect(raw).not.toContain(SECRET);
      for (const key of FORBIDDEN_KEYS) expect(raw).not.toContain(`"${key}"`);
    }
  });

  it('«Готово» → заказчикам «ждёт вас»; сравнение кадров (система) — всем заказчикам; разработчик теряет суть, когда замечание ушло от него', async () => {
    const id = await seeded('defect');
    await h.http.post(url(`/remarks/${id}/ready-for-retest`)).set(h.auth('developer')).expect(200);
    for (const who of ['business', 'business2'] as const) {
      expect((await about(who, id)).map((i) => [i.event.action, i.kind, i.by?.role])).toEqual([['ready_for_retest', 'action', 'developer']]);
    }
    expect(await about('developer', id)).toEqual([]);
    expect(await about('pm', id)).toEqual([]);

    // Ретест: кадр от заказчика (без уведомления), итог сравнения пишет система — актора нет, приходит обоим
    const run = await h.prisma.agentRun.create({ data: { remarkId: id, projectId: h.projectId, mode: 'retest', status: 'running' } });
    await h.app.get(RemarksService).applyRetest({ userId: h.users.business.id, projectId: h.projectId, role: 'business' }, id, run.id, { outcome: 'likely_addressed', explanation: 'Кнопка стала синей', retestSize: null, diffShot: null });
    for (const who of ['business', 'business2'] as const) {
      const last = (await about(who, id))[0]!;
      expect(last).toMatchObject({ kind: 'action', event: { action: 'retest_result', toStatus: 'awaiting_business_close' }, by: null });
    }

    // «Не исправлено» от первого заказчика: разработчику «ждёт вас», второму заказчику «к сведению», автору — ничего
    await h.http.post(url(`/remarks/${id}/not-fixed`)).set(h.auth('business')).expect(200);
    const [devItem] = await about('developer', id);
    expect(devItem).toMatchObject({ kind: 'action', event: { action: 'not_fixed', toStatus: 'defect' }, by: { name: 'business', role: 'business' } });
    expect((await about('business2', id))[0]).toMatchObject({ kind: 'info', event: { action: 'not_fixed' } });
    const mine = await about('business', id);
    expect(mine.map((i) => i.event.action)).not.toContain('not_fixed');
    // …а свои «ждёт вас» по этому замечанию заказчик погасил действием
    expect(mine.every((i) => i.readAt !== null)).toBe(true);

    // Разработчик снова «Готово», заказчик отдал на ретест — теперь замечание у заказчика: разработчику суть не видна
    await h.http.post(url(`/remarks/${id}/ready-for-retest`)).set(h.auth('developer')).expect(200);
    const run2 = await h.prisma.agentRun.create({ data: { remarkId: id, projectId: h.projectId, mode: 'retest', status: 'running' } });
    await h.app.get(RemarksService).applyRetest({ userId: h.users.business.id, projectId: h.projectId, role: 'business' }, id, run2.id, { outcome: 'likely_addressed', explanation: 'Синяя', retestSize: null, diffShot: null });
    const devHidden = await about('developer', id);
    expect(devHidden.length).toBeGreaterThan(0);
    for (const item of devHidden) expect(item.remark).toMatchObject({ title: null, readable: false, status: 'awaiting_business_close' });
    // Заказчику суть видна всегда: первая строка «что не так», как заголовок карточки
    expect((await about('business2', id))[0]!.remark.title).toBe('Посеяно в defect');
  });

  it('закрытие → второму заказчику «к сведению», автору — ничего; его «ждёт вас» по замечанию прочитано', async () => {
    const id = await seeded('defect');
    await h.http.post(url(`/remarks/${id}/ready-for-retest`)).set(h.auth('developer')).expect(200);
    await h.http.post(url(`/remarks/${id}/close`)).set(h.auth('business')).send({ comment: SECRET }).expect(200);
    const other = await about('business2', id);
    expect(other.map((i) => [i.event.action, i.kind])).toEqual([
      ['close', 'info'],
      ['ready_for_retest', 'action'],
    ]);
    const mine = await about('business', id);
    expect(mine.map((i) => i.event.action)).toEqual(['ready_for_retest']);
    expect(mine[0]!.readAt).not.toBeNull();
    expect(JSON.stringify(other)).not.toContain(SECRET);
    // Разработчик закрытое не открывает и в колокольчике его «Готово» ему не приходит
    expect(await about('developer', id)).toEqual([]);
  });

  it('«решает заказчик» → заказчикам «ждёт вас»; решение заказчика «в работу» → разработчику «ждёт вас», второму заказчику «к сведению»', async () => {
    const remark = await awaitingPm('На главной нет кнопки «Выгрузить отчёт», в ТЗ про неё ничего');
    await verdict('pm', remark, 'unspecified').expect(200);
    for (const who of ['business', 'business2'] as const) {
      expect((await about(who, remark.id)).map((i) => [i.event.toStatus, i.kind])).toEqual([['unspecified', 'action']]);
    }
    await verdict('business', remark, 'defect').expect(200);
    expect((await about('developer', remark.id)).map((i) => [i.event.fromStatus, i.event.toStatus, i.kind, i.by?.role])).toEqual([['unspecified', 'defect', 'action', 'business']]);
    expect((await about('business2', remark.id)).map((i) => [i.event.toStatus, i.kind])).toEqual([
      ['defect', 'info'],
      ['unspecified', 'action'],
    ]);
    const mine = await about('business', remark.id);
    expect(mine.map((i) => i.event.toStatus)).toEqual(['unspecified']);
    expect(mine[0]!.readAt).not.toBeNull();
    // PM не адресат ни того, ни другого решения
    expect((await about('pm', remark.id)).map((i) => i.event.action)).toEqual(['proposal']);

    const cr = await awaitingPm('Хотим тёмную тему в личном кабинете, в ТЗ её нет');
    await verdict('pm', cr, 'change_request').expect(200);
    expect((await about('business', cr.id)).map((i) => [i.event.toStatus, i.kind])).toEqual([['change_request', 'info']]);
    expect(await about('developer', cr.id)).toEqual([]);
  });

  it('смена роли и удаление из проекта скрывают прежние строки — фильтр по текущей membership', async () => {
    const before = await page('business2', '?limit=50');
    expect(before.items.length).toBeGreaterThan(0);
    expect(before.unread).toBeGreaterThan(0);

    await h.prisma.membership.update({ where: { userId_projectId: { userId: extra.business2.id, projectId: h.projectId } }, data: { role: 'developer' } });
    const asDev = await page('business2', '?limit=50');
    expect(asDev.items).toEqual([]);
    expect(asDev.unread).toBe(0);

    await h.prisma.membership.delete({ where: { userId_projectId: { userId: extra.business2.id, projectId: h.projectId } } });
    expect(await page('business2')).toEqual({ items: [], unread: 0, hasMore: false });

    await h.prisma.membership.create({ data: { userId: extra.business2.id, projectId: h.projectId, role: 'business' } });
    const back = await page('business2', '?limit=50');
    expect(back.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
  });

  it('страницы от новых к старым: limit + before, hasMore', async () => {
    const all = (await page('business', '?limit=50')).items;
    expect(all.length).toBeGreaterThanOrEqual(4);
    const walked: string[] = [];
    let before = '';
    for (let i = 0; i < 50; i++) {
      const p = await page('business', `?limit=2${before ? `&before=${before}` : ''}`);
      walked.push(...p.items.map((x) => x.id));
      if (!p.hasMore) break;
      before = p.items[p.items.length - 1]!.id;
    }
    expect(walked).toEqual(all.map((x) => x.id));
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.at >= all[i]!.at).toBe(true);
    await h.http.get('/api/v1/auth/notifications?limit=0').set(h.auth('business')).expect(422);
    await h.http.get('/api/v1/auth/notifications?limit=51').set(h.auth('business')).expect(422);
    await h.http.get('/api/v1/auth/notifications?before=not-a-uuid').set(h.auth('business')).expect(422);
  });

  it('прочитать по id, по замечанию и все; чужие id не трогаются', async () => {
    const dev = (await page('developer', '?limit=50')).items.filter((i) => !i.readAt);
    const biz = (await page('business2', '?limit=50')).items.filter((i) => !i.readAt);
    expect(dev.length).toBeGreaterThanOrEqual(2);
    expect(biz.length).toBeGreaterThan(0);

    const res = await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send({ ids: [dev[0]!.id, biz[0]!.id] }).expect(200);
    expect(res.body).toEqual({ unread: dev.length - 1 });
    expect((await h.prisma.notification.findUniqueOrThrow({ where: { id: biz[0]!.id } })).readAt).toBeNull();

    const byRemark = dev.find((i) => i.remark.id !== dev[0]!.remark.id) ?? dev[1]!;
    const left = await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send({ remarkId: byRemark.remark.id }).expect(200);
    expect(left.body.unread).toBeLessThan(dev.length - 1);
    expect((await about('developer', byRemark.remark.id)).every((i) => i.readAt !== null)).toBe(true);

    await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send({ all: true }).expect(200, { unread: 0 });
    expect((await page('developer')).unread).toBe(0);
    expect((await page('business2')).unread).toBe(biz.length);

    // Ровно одно из трёх; пустой список и лишнее — 422
    for (const body of [{}, { all: true, remarkId: randomUUID() }, { ids: [] }, { all: false }, { ids: ['nope'] }]) {
      await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send(body).expect(422);
    }
  });

  it('токен MCP (ADR 003): личных маршрутов колокольчика для него нет — 404', async () => {
    const mcp = await h.http.post(url('/mcp-token')).set(h.auth('developer')).expect(200);
    await h.http.get('/api/v1/auth/notifications').set(bearer(mcp.body.token)).expect(404);
    await h.http.post('/api/v1/auth/notifications/read').set(bearer(mcp.body.token)).send({ all: true }).expect(404);
  });

  it('изоляция: сбой уведомлений внутри SAVEPOINT не отменяет решение PM — 200 и строка истории на месте', async () => {
    const remark = await awaitingPm('Поле «Телефон» принимает буквы, в ТЗ маска +7');
    const service = h.app.get(NotificationsService);
    // Настоящая ошибка Postgres внутри точки сохранения: без отката к ней транзакция решения была бы мертва
    const spy = jest.spyOn(service as unknown as { fanOut: (tx: { $queryRawUnsafe: (q: string) => Promise<unknown> }) => Promise<void> }, 'fanOut').mockImplementation(async (tx) => {
      await tx.$queryRawUnsafe('SELECT 1 / 0');
    });
    try {
      const res = await verdict('pm', remark, 'defect').expect(200);
      expect(res.body.status).toBe('defect');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    const change = await h.prisma.remarkStatusChange.findFirst({ where: { remarkId: remark.id, action: 'verdict' } });
    expect(change).toMatchObject({ fromStatus: 'awaiting_pm', toStatus: 'defect', userId: h.users.pm.id });
    expect(await h.prisma.humanVerdict.count({ where: { remarkId: remark.id } })).toBe(1);
    expect(await h.prisma.notification.count({ where: { changeId: change!.id } })).toBe(0);
    // Следующий переход того же замечания — уже с уведомлением
    await h.http.post(url(`/remarks/${remark.id}/ready-for-retest`)).set(h.auth('developer')).expect(200);
    expect((await about('business', remark.id)).map((i) => i.event.action)).toContain('ready_for_retest');
  });
});
