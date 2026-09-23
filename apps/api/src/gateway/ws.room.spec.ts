/**
 * ws.room.spec — комната замечания (docs/WS.md): тот же JWT, membership на join, фазы прогона по порядку,
 * вердикт через сокет идёт в тот же run и тот же RemarksService (идемпотентно), второе окно видит presence.
 */
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createHarness, Harness } from '../../test/harness';
import { WS_PATH } from './remark.gateway';

type Ev = { type: string; runId?: string; phase?: string; remarkStatus?: string; action?: string; userId?: string; name?: string; proposedClass?: string };

describe('ws: комната remark:{id}', () => {
  let h: Harness;
  let url = '';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0);
    const address = h.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await h.cleanup();
  });

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(url, { path: WS_PATH, auth: { token }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  const ask = <T>(socket: Socket, event: string, body: unknown): Promise<T> => new Promise((resolve) => socket.emit(event, body, (ack: T) => resolve(ack)));

  function collect(socket: Socket): Ev[] {
    const events: Ev[] = [];
    socket.onAny((type: string, payload: Ev) => events.push({ ...payload, type }));
    return events;
  }

  async function until(events: Ev[], pred: (e: Ev) => boolean, timeoutMs = 20000): Promise<Ev> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`ws: не дождались события; получили ${events.map((e) => e.type + (e.phase ? `:${e.phase}` : '')).join(', ')}`);
  }

  it('без токена соединения нет — connect_error «Нет доступа»', async () => {
    const reason = await new Promise<string>((resolve, reject) => {
      const s = io(url, { path: WS_PATH, transports: ['websocket'], reconnection: false });
      sockets.push(s);
      s.on('connect', () => reject(new Error('подключились без токена')));
      s.on('connect_error', (e) => resolve(e.message));
    });
    expect(reason).toBe('Нет доступа');
  });

  it('join чужого проекта — «Нет доступа», не 500 и не чужие данные', async () => {
    const pm = await connect(h.users.pm.token);
    const ack = await ask<{ ok: boolean; status?: number }>(pm, 'join', { projectId: randomUUID(), remarkId: randomUUID() });
    expect(ack).toMatchObject({ ok: false, status: 404 });
    // команда без join — тоже отказ
    const cmd = await ask<{ ok: boolean; status?: number }>(pm, 'verdict.approve', { remarkId: randomUUID(), verdict: 'defect', runId: randomUUID(), idempotencyKey: randomUUID() });
    expect(cmd).toMatchObject({ ok: false, status: 404 });
  });

  it('фазы прогона приходят в комнату, вердикт по сокету — тот же run, второе окно видит presence и persisted', async () => {
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка Сохранить серая с заливкой', expected: 'По ТЗ primary синяя', pageOrScreen: 'Профиль', screenshotKey: `${h.projectId}/${randomUUID()}.png` })
      .expect(201);
    const remarkId = created.body.id as string;
    const runId = created.body.runId as string;

    const pm = await connect(h.users.pm.token);
    const pmEvents = collect(pm);
    const joined = await ask<{ ok: boolean; runId?: string; presence: unknown[] }>(pm, 'join', { projectId: h.projectId, remarkId });
    expect(joined.ok).toBe(true);
    expect(joined.presence).toEqual([]);

    // Клиент мог подключиться посреди прогона: либо фазы придут, либо join уже отдал awaiting_pm.
    await h.waitFor(remarkId, ['awaiting_pm']);
    // Статус в базе коммитится раньше, чем граф шлёт фазу: если фазы шли в эту комнату, дождаться и последней
    if (pmEvents.some((e) => e.type === 'run.phase')) await until(pmEvents, (e) => e.type === 'run.phase' && e.phase === 'awaiting_pm', 5000);
    const phases = pmEvents.filter((e) => e.type === 'run.phase').map((e) => e.phase);
    const lastPhase = phases[phases.length - 1] ?? (await ask<{ phase?: string }>(pm, 'join', { projectId: h.projectId, remarkId })).phase;
    expect(lastPhase).toBe('awaiting_pm');
    if (phases.length > 1) expect(phases.indexOf('retrieving')).toBeLessThan(phases.indexOf('drafting'));

    // Второе окно: бизнес видит, что PM уже смотрит карточку.
    const business = await connect(h.users.business.token);
    const bizEvents = collect(business);
    const bizJoin = await ask<{ ok: boolean; presence: Array<{ userId: string; role: string }> }>(business, 'join', { projectId: h.projectId, remarkId });
    expect(bizJoin.presence).toEqual([{ userId: h.users.pm.id, role: 'pm', name: 'pm' }]);
    await until(pmEvents, (e) => e.type === 'presence' && e.action === 'join' && e.userId === h.users.business.id);

    // Вердикт через WS — идемпотентно, в тот же run, бизнес получает run.persisted.
    const key = randomUUID();
    const ack = await ask<{ ok: boolean; remark: { status: string; runId: string } }>(pm, 'verdict.approve', { remarkId, verdict: 'defect', runId, idempotencyKey: key });
    expect(ack.ok).toBe(true);
    expect(ack.remark.status).toBe('defect');
    const twice = await ask<{ ok: boolean; remark: { status: string } }>(pm, 'verdict.approve', { remarkId, verdict: 'defect', runId, idempotencyKey: key });
    expect(twice.ok).toBe(true);
    expect(await h.prisma.humanVerdict.count({ where: { remarkId } })).toBe(1);
    const persisted = await until(bizEvents, (e) => e.type === 'run.persisted');
    expect(persisted).toMatchObject({ runId, remarkStatus: 'defect' });

    // Бизнес вердикт из awaiting_pm ставить не может — 403 в ack, не разрыв сокета.
    const forbidden = await ask<{ ok: boolean; status?: number }>(business, 'verdict.approve', { remarkId, verdict: 'defect', runId, idempotencyKey: randomUUID() });
    expect(forbidden.ok).toBe(false);
  });
});
