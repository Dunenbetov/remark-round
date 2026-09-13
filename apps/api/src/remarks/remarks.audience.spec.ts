/**
 * remarks.audience.spec — ADR 007: заказчик (business) на том же проекте, что и подрядчик, не получает от API
 * внутреннюю кухню — советы разработчиков, комментарий вердикта PM, ссылку на трейс, предложение модели, —
 * а черновик разбора видит только после решения человека. Фильтр на сервере: REST и комната WS.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createHarness, type Harness } from '../../test/harness';
import { RunEvents } from '../agent/run-events';
import { WS_PATH } from '../gateway/remark.gateway';

describe('remark view audience', () => {
  let h: Harness;
  let remarkId = '';
  let runId = '';
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0);
    const remark = await h.prisma.remark.create({
      data: {
        projectId: h.projectId,
        roundId: h.roundId,
        number: 950,
        description: 'Кнопка серая',
        status: 'awaiting_pm',
        proposedClass: 'change_request_candidate',
        rationale: 'Похоже на желание, а не поломку.\n\nВ ТЗ цвет primary — сосновый, серый не оговорён.',
        visionFacts: 'На кадре серая кнопка.',
      },
    });
    remarkId = remark.id;
    const run = await h.prisma.agentRun.create({ data: { remarkId, projectId: h.projectId, status: 'awaiting_human', mode: 'triage' } });
    runId = run.id;
    await h.prisma.developerAdvice.create({ data: { remarkId, userId: h.users.developer.id, code: 'change_request', comment: 'Это хотелка, пусть доплачивают' } });
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('до вердикта: PM видит черновик, предложение и совет; заказчик — ничего из этого', async () => {
    const pm = (await h.http.get(url(`/remarks/${remarkId}`)).set(h.auth('pm')).expect(200)).body;
    expect(pm.draft).toHaveLength(2);
    expect(pm.proposedClass).toBe('change_request_candidate');
    expect(pm.seen).toBe('На кадре серая кнопка.');
    expect(pm.advice).toHaveLength(1);
    expect(pm.advice[0].comment).toBe('Это хотелка, пусть доплачивают');

    const biz = (await h.http.get(url(`/remarks/${remarkId}`)).set(h.auth('business')).expect(200)).body;
    expect(biz.status).toBe('awaiting_pm');
    expect(biz.draft).toEqual([]);
    expect(biz.draftShort).toBeUndefined();
    expect(biz.proposedClass).toBeUndefined();
    expect(biz.seen).toBeUndefined();
    expect(biz.advice).toEqual([]);
    expect(biz.traceUrl).toBeUndefined();
    expect(JSON.stringify(biz)).not.toContain('доплачивают');
    // Опора (цитаты, кадры) и служебные поля прогона заказчику нужны: он сам отправляет ретест и может отменить прогон
    expect(biz.runId).toBe(runId);
    expect(biz.runStatus).toBe('awaiting_human');

    // Список раунда для заказчика фильтруется так же
    const list = (await h.http.get(url(`/rounds/${h.roundId}/remarks`)).set(h.auth('business')).expect(200)).body;
    const mine = list.find((r: { id: string }) => r.id === remarkId);
    expect(mine.draft).toEqual([]);
    expect(mine.advice).toEqual([]);
  });

  it('после вердикта: заказчик видит черновик и решение, но не комментарий PM и не совет', async () => {
    await h.prisma.$transaction([
      h.prisma.humanVerdict.create({ data: { remarkId, runId, userId: h.users.pm.id, code: 'change_request', comment: 'Внутренняя пометка: обсудить доплату', idempotencyKey: randomUUID() } }),
      h.prisma.remark.update({ where: { id: remarkId }, data: { status: 'change_request' } }),
      h.prisma.agentRun.update({ where: { id: runId }, data: { status: 'persisted' } }),
    ]);
    const biz = (await h.http.get(url(`/remarks/${remarkId}`)).set(h.auth('business')).expect(200)).body;
    expect(biz.draft).toHaveLength(2);
    expect(biz.seen).toBe('На кадре серая кнопка.');
    expect(biz.verdict).toMatchObject({ code: 'change_request', userId: h.users.pm.id });
    expect(biz.verdict.comment).toBeUndefined();
    expect(biz.advice).toEqual([]);
    expect(biz.proposedClass).toBeUndefined();

    const pm = (await h.http.get(url(`/remarks/${remarkId}`)).set(h.auth('pm')).expect(200)).body;
    expect(pm.verdict.comment).toBe('Внутренняя пометка: обсудить доплату');
    expect(pm.advice).toHaveLength(1);
  });

  it('комната WS: заказчику не приходят run.token, run.citations и remark.advice, фазы приходят всем', async () => {
    const port = (h.app.getHttpServer().address() as AddressInfo).port;
    const connect = (token: string): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const s = io(`http://127.0.0.1:${port}`, { path: WS_PATH, auth: { token }, transports: ['websocket'], reconnection: false });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });
    const pmSocket = await connect(h.users.pm.token);
    const bizSocket = await connect(h.users.business.token);
    for (const s of [pmSocket, bizSocket]) {
      const ack = await new Promise<{ ok: boolean }>((resolve) => s.emit('join', { projectId: h.projectId, remarkId }, resolve));
      expect(ack.ok).toBe(true);
    }
    const received = { pm: [] as string[], biz: [] as string[] };
    for (const type of ['run.phase', 'run.token', 'run.citations', 'remark.advice']) {
      pmSocket.on(type, () => received.pm.push(type));
      bizSocket.on(type, () => received.biz.push(type));
    }

    const events = h.app.get(RunEvents);
    events.emit(remarkId, { type: 'run.phase', runId, phase: 'drafting' });
    events.emit(remarkId, { type: 'run.token', runId, delta: 'Похоже на желание' });
    events.emit(remarkId, { type: 'run.citations', runId, citations: [] });
    // Совет разработчика — настоящий путь через REST: контроллер шлёт remark.advice в комнату
    await h.prisma.remark.update({ where: { id: remarkId }, data: { status: 'awaiting_pm' } });
    await h.http.put(url(`/remarks/${remarkId}/advice`)).set(h.auth('developer')).send({ code: 'defect', comment: 'Передумал' }).expect(200);
    await new Promise((r) => setTimeout(r, 300));

    expect(received.pm.sort()).toEqual(['remark.advice', 'run.citations', 'run.phase', 'run.token']);
    expect(received.biz).toEqual(['run.phase']);
    pmSocket.disconnect();
    bizSocket.disconnect();
  });
});
