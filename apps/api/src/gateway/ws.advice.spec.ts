/**
 * ws.advice.spec — совет разработчика приходит PM в комнату замечания событием remark.advice без перезагрузки;
 * разработчик входит в комнату awaiting_pm (раньше — 404). Статус при этом не меняется.
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createHarness, Harness } from '../../test/harness';
import { WS_PATH } from './remark.gateway';

type Ev = { type: string; remarkId?: string; advice?: Array<{ code: string; userId: string; comment?: string }> };

describe('ws: remark.advice', () => {
  let h: Harness;
  let url = '';
  let remarkId = '';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0);
    const address = h.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Ошибка 500 показывается тостом сверху', expected: 'Ошибка под полем красным', pageOrScreen: 'Оплата' })
      .expect(201);
    remarkId = created.body.id;
    await h.waitFor(remarkId, ['awaiting_pm']);
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

  async function until(events: Ev[], pred: (e: Ev) => boolean, timeoutMs = 10000): Promise<Ev> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`ws: не дождались события; получили ${events.map((e) => e.type).join(', ')}`);
  }

  it('PM в комнате получает remark.advice после PUT разработчика; разработчик входит в комнату awaiting_pm', async () => {
    const pm = await connect(h.users.pm.token);
    const events = collect(pm);
    const joined = await ask<{ ok: boolean }>(pm, 'join', { projectId: h.projectId, remarkId });
    expect(joined.ok).toBe(true);

    const dev = await connect(h.users.developer.token);
    const devJoin = await ask<{ ok: boolean }>(dev, 'join', { projectId: h.projectId, remarkId });
    expect(devJoin.ok).toBe(true);

    await h.http.put(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/advice`).set(h.auth('developer')).send({ code: 'defect', comment: 'Точно баг' }).expect(200);
    const ev = await until(events, (e) => e.type === 'remark.advice');
    expect(ev.remarkId).toBe(remarkId);
    expect(ev.advice).toHaveLength(1);
    expect(ev.advice![0]).toMatchObject({ code: 'defect', userId: h.users.developer.id, comment: 'Точно баг' });

    const row = await h.prisma.remark.findUnique({ where: { id: remarkId }, select: { status: true } });
    expect(row!.status).toBe('awaiting_pm');

    await h.http.delete(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/advice`).set(h.auth('developer')).expect(200);
    const cleared = await until(events, (e) => e.type === 'remark.advice' && e.advice?.length === 0);
    expect(cleared.advice).toEqual([]);
  });
});
