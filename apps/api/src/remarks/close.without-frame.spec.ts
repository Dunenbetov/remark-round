/**
 * close.without-frame.spec — ADR 010: заказчик закрывает сразу после «Готово» разработчика, если проверил сам.
 * Закрыть можно без нового кадра, вернуть («не исправлено») — только с кадром. Кто закрыл, откуда и с какими
 * словами — в строке истории `close`; карточка отдаёт `closedVia` и `closeComment`. Пока кадры сравниваются — 409.
 */
import type { RemarkStatus } from '@remarkround/db';
import { createHarness, type Harness } from '../../test/harness';

describe('close without a new frame (ADR 010)', () => {
  let h: Harness;
  let seq = 9400;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  const remarkIn = (status: RemarkStatus) =>
    h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: seq++, description: 'Кнопка «Сохранить» серая', status, fixedByUserId: h.users.developer.id } });

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('руководитель приёмки и разработчик закрыть не могут — 403', async () => {
    const remark = await remarkIn('ready_for_retest');
    await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('pm')).send({}).expect(403);
    await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('developer')).send({}).expect(403);
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: remark.id } })).status).toBe('ready_for_retest');
  });

  it('заказчик закрывает сразу после «Готово»: closedVia = business_check, комментарий в карточке и в истории', async () => {
    const remark = await remarkIn('ready_for_retest');
    const res = await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({ comment: '  Проверила на стенде — исправлено  ' }).expect(200);
    expect(res.body).toMatchObject({ status: 'closed', closedVia: 'business_check', closeComment: 'Проверила на стенде — исправлено', closedByUserId: h.users.business.id });

    const rows = await h.prisma.remarkStatusChange.findMany({ where: { remarkId: remark.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'close', fromStatus: 'ready_for_retest', toStatus: 'closed', userId: h.users.business.id, role: 'business', comment: 'Проверила на стенде — исправлено' });

    // Слова заказчика видят все: и он сам, и команда
    for (const role of ['business', 'pm'] as const) {
      const history = await h.http.get(url(`/remarks/${remark.id}/history`)).set(h.auth(role)).expect(200);
      expect(history.body[0]).toMatchObject({ action: 'close', fromStatus: 'ready_for_retest', comment: 'Проверила на стенде — исправлено' });
      const card = await h.http.get(url(`/remarks/${remark.id}`)).set(h.auth(role)).expect(200);
      expect(card.body).toMatchObject({ closedVia: 'business_check', closeComment: 'Проверила на стенде — исправлено' });
    }
  });

  it('без комментария — тоже можно: пустая строка не пишется', async () => {
    const remark = await remarkIn('ready_for_retest');
    const res = await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({ comment: '   ' }).expect(200);
    expect(res.body.closedVia).toBe('business_check');
    expect(res.body.closeComment).toBeUndefined();
    const row = await h.prisma.remarkStatusChange.findFirstOrThrow({ where: { remarkId: remark.id, action: 'close' } });
    expect(row.comment).toBeNull();
  });

  it('«не исправлено» без кадра — 409: вернуть разработчику можно только с новым кадром', async () => {
    const remark = await remarkIn('ready_for_retest');
    const res = await h.http.post(url(`/remarks/${remark.id}/not-fixed`)).set(h.auth('business')).expect(409);
    expect(res.body.message).toMatch(/только с новым кадром/);
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: remark.id } })).status).toBe('ready_for_retest');
  });

  it('пока кадры сравниваются — 409, замечание не закрыто', async () => {
    const remark = await remarkIn('ready_for_retest');
    await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'retest' } });
    const res = await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({}).expect(409);
    expect(res.body.message).toMatch(/сравниваются/);
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: remark.id } })).status).toBe('ready_for_retest');
    expect(await h.prisma.remarkStatusChange.count({ where: { remarkId: remark.id } })).toBe(0);
  });

  it('после круга «не исправлено» старый ретест-прогон не возобновляется: задачи графа не появляется', async () => {
    const remark = await remarkIn('ready_for_retest');
    const stale = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'persisted', mode: 'retest' } });
    const res = await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({}).expect(200);
    expect(res.body.closedVia).toBe('business_check');
    expect(await h.prisma.job.count({ where: { runId: stale.id } })).toBe(0);
  });

  it('комментарий длиннее 2000 символов — 422', async () => {
    const remark = await remarkIn('ready_for_retest');
    await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({ comment: 'x'.repeat(2001) }).expect(422);
  });

  it('из defect (разработчик ещё не нажал «Готово») закрыть нельзя — 409', async () => {
    const remark = await remarkIn('defect');
    await h.http.post(url(`/remarks/${remark.id}/close`)).set(h.auth('business')).send({}).expect(409);
  });
});
