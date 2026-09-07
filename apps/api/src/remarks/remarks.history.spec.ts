/**
 * remarks.history.spec — аудит: remark-history-missing.
 * Каждый переход замечания оставляет строку: откуда, куда, кто и в какой роли, каким прогоном, короткая пометка.
 * Предложение модели остаётся в AgentRun и после вердикта; заказчик историю видит, но без содержания предложений (ADR 007).
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import { RemarksService } from './remarks.service';

describe('remark history', () => {
  let h: Harness;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('создание → разбор → вердикт → «готово»: строка на переход с автором, ролью и прогоном; предложение модели не затирается', async () => {
    const created = await h.http.post(url(`/rounds/${h.roundId}/remarks`)).set(h.auth('business')).send({ description: 'Кнопка «Сохранить» серая, а в ТЗ primary синяя', pageOrScreen: 'Профиль' }).expect(201);
    const id: string = created.body.id;
    const awaiting = await h.waitFor(id, ['awaiting_pm']);
    const runId: string = awaiting.runId;
    await h.http.post(url(`/remarks/${id}/verdict`)).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    await h.waitFor(id, ['defect']);
    await h.http.post(url(`/remarks/${id}/ready-for-retest`)).set(h.auth('developer')).expect(200);

    const res = await h.http.get(url(`/remarks/${id}/history`)).set(h.auth('pm')).expect(200);
    const rows = res.body as Array<Record<string, any>>;
    expect(rows.map((r) => r.action)).toEqual(['create', 'triage', 'proposal', 'verdict', 'ready_for_retest']);
    expect(rows.map((r) => [r.fromStatus ?? null, r.toStatus])).toEqual([
      [null, 'imported'],
      ['imported', 'triaging'],
      ['triaging', 'awaiting_pm'],
      ['awaiting_pm', 'defect'],
      ['defect', 'ready_for_retest'],
    ]);
    expect(rows[0]!.by).toMatchObject({ userId: h.users.business.id, name: 'business', role: 'business' });
    expect(rows[1]!.runId).toBe(runId);
    expect(rows[2]!.by).toBeUndefined();
    expect(rows[2]!.runId).toBe(runId);
    expect(rows[2]!.detail).toMatch(/Похоже на дефект|Повтор|Не хватает|нет ответа|новое желание/);
    expect(rows[3]!.by).toMatchObject({ userId: h.users.pm.id, role: 'pm' });
    expect(rows[4]!.by).toMatchObject({ userId: h.users.developer.id, role: 'developer' });
    for (const r of rows) expect(typeof r.at).toBe('string');

    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('persisted');
    expect(run.proposedClass).toBeTruthy();
    expect(run.rationale).toBeTruthy();

    const card = await h.http.get(url(`/remarks/${id}`)).set(h.auth('pm')).expect(200);
    expect(new Date(card.body.updatedAt).getTime()).toBeGreaterThan(new Date(card.body.createdAt).getTime());
  });

  it('заказчик видит историю без содержания предложений модели; разработчик не видит историю карточки вне своей очереди', async () => {
    const created = await h.http.post(url(`/rounds/${h.roundId}/remarks`)).set(h.auth('business')).send({ description: 'Нет кнопки «Сохранить» на главной', pageOrScreen: 'Главная' }).expect(201);
    const id: string = created.body.id;
    await h.waitFor(id, ['awaiting_pm', 'cannot_tell']);
    const asCustomer = await h.http.get(url(`/remarks/${id}/history`)).set(h.auth('business')).expect(200);
    const proposal = (asCustomer.body as Array<Record<string, any>>).find((r) => r.action === 'proposal');
    expect(proposal).toBeDefined();
    expect(proposal!.detail).toBeUndefined();
    const asPm = await h.http.get(url(`/remarks/${id}/history`)).set(h.auth('pm')).expect(200);
    expect((asPm.body as Array<Record<string, any>>).find((r) => r.action === 'proposal')!.detail).toBeTruthy();
    // Разработчик читает awaiting_pm (совет), но не imported — история подчиняется тому же ACL, что карточка
    await h.http.get(url(`/remarks/${id}/history`)).set(h.auth('developer')).expect(200);
    const hidden = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9300, description: 'Не для разработчика', status: 'imported' } });
    await h.http.get(url(`/remarks/${hidden.id}/history`)).set(h.auth('developer')).expect(404);
  });

  it('остановка и сбой прогона тоже в истории: cancel — с автором, run_failed — с причиной', async () => {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9301, description: 'История отмены', status: 'triaging' } });
    const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'triage' } });
    await h.http.post(url(`/remarks/${remark.id}/cancel`)).set(h.auth('pm')).send({ runId: run.id, idempotencyKey: randomUUID() }).expect(200);
    const failing = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9302, description: 'История сбоя', status: 'triaging' } });
    const failedRun = await h.prisma.agentRun.create({ data: { remarkId: failing.id, projectId: h.projectId, status: 'running', mode: 'triage' } });
    await h.app.get(RemarksService).failRun(failedRun.id, { code: 'llm_timeout', message: 'Модель не ответила вовремя — запустите снова' });

    const cancelRows = await h.prisma.remarkStatusChange.findMany({ where: { remarkId: remark.id } });
    expect(cancelRows).toHaveLength(1);
    expect(cancelRows[0]).toMatchObject({ action: 'cancel', fromStatus: 'triaging', toStatus: 'imported', userId: h.users.pm.id, role: 'pm', runId: run.id });
    const failRows = await h.prisma.remarkStatusChange.findMany({ where: { remarkId: failing.id } });
    expect(failRows[0]).toMatchObject({ action: 'run_failed', fromStatus: 'triaging', toStatus: 'imported', runId: failedRun.id, userId: null });
    expect(failRows[0]!.detail).toMatch(/не ответила/);
  });

  it('второй вердикт на ту же карточку (гонка) не оставляет лишней строки истории', async () => {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9303, description: 'Гонка истории', status: 'awaiting_pm', rationale: 'Черновик.' } });
    const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'awaiting_human', mode: 'triage' } });
    const fire = (verdict: string) => h.http.post(url(`/remarks/${remark.id}/verdict`)).set(h.auth('pm')).send({ runId: run.id, verdict, idempotencyKey: randomUUID() });
    const results = await Promise.all([fire('defect'), fire('change_request')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await h.prisma.remarkStatusChange.findMany({ where: { remarkId: remark.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('verdict');
  });
});
