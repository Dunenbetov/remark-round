/**
 * ws.notifications.spec — личная комната `user:{id}` (ADR 016): сервер кладёт в неё сокет сам, толчок колокольчика
 * приходит после коммита решения (задача notify_push), вторая вкладка узнаёт о прочтении, сокет MCP-токена в комнату
 * не попадает, отзыв по проекту комнату не рвёт — клиент получает notification.sync и перечитывает список.
 */
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { TenancyService } from '../tenancy/tenancy.service';
import { createHarness, Harness } from '../../test/harness';
import { WS_PATH } from './remark.gateway';

type Item = { id: string; kind: string; remark: { id: string }; event: { action: string } };
type Ev = { type: string; items?: Item[]; unread?: number; ids?: string[]; remarkId?: string; all?: true };

describe('ws: личная комната user:{id}', () => {
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
    throw new Error(`ws: не дождались события; получили ${events.map((e) => e.type).join(', ')}`);
  }

  const aboutVerdict = (remarkId: string) => (e: Ev) => e.type === 'notification.new' && Boolean(e.items?.some((i) => i.remark.id === remarkId && i.event.action === 'verdict'));

  it('решение PM по REST → обеим вкладкам разработчика notification.new, PM — только «прочитано», сокету MCP — ничего', async () => {
    const mcp = await h.http.post(`/api/v1/projects/${h.projectId}/mcp-token`).set(h.auth('developer')).expect(200);
    const [dev1, dev2, pm, mcpSocket] = await Promise.all([connect(h.users.developer.token), connect(h.users.developer.token), connect(h.users.pm.token), connect(mcp.body.token)]);
    const [dev1Events, dev2Events, pmEvents, mcpEvents] = [collect(dev1), collect(dev2), collect(pm), collect(mcpSocket)];

    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка «Сохранить» серая, а в ТЗ primary синяя', pageOrScreen: 'Профиль' })
      .expect(201);
    const remarkId = created.body.id as string;
    const card = await h.waitFor(remarkId, ['awaiting_pm']);
    // Предложение модели — PM «ждёт вас» толчком
    const proposal = await until(pmEvents, (e) => e.type === 'notification.new' && Boolean(e.items?.some((i) => i.remark.id === remarkId && i.event.action === 'proposal')));
    expect(proposal.items![0]).toMatchObject({ kind: 'action' });
    expect(proposal.unread).toBeGreaterThanOrEqual(1);

    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`).set(h.auth('pm')).send({ runId: card.runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);

    const got = await until(dev1Events, aboutVerdict(remarkId));
    expect(got.items).toHaveLength(1);
    expect(got.items![0]).toMatchObject({ kind: 'action' });
    expect(got.unread).toBe(1);
    await until(dev2Events, aboutVerdict(remarkId));
    // Автор решения нового не получает, но его «ждёт вас» погашено — все его вкладки узнают об этом
    const read = await until(pmEvents, (e) => e.type === 'notification.read' && e.remarkId === remarkId);
    expect(read.unread).toBe(0);
    expect(pmEvents.some(aboutVerdict(remarkId))).toBe(false);

    // Вторая вкладка разработчика узнаёт о прочтении в первой
    await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send({ ids: [got.items![0]!.id] }).expect(200, { unread: 0 });
    const echoed = await until(dev2Events, (e) => e.type === 'notification.read' && Boolean(e.ids?.includes(got.items![0]!.id)));
    expect(echoed.unread).toBe(0);

    // Сокет с токеном MCP живёт внутри проекта: личных событий ему нет
    await new Promise((r) => setTimeout(r, 300));
    expect(mcpEvents.filter((e) => e.type.startsWith('notification.'))).toEqual([]);
  });

  it('отзыв по проекту: сокет остаётся в личной комнате и получает notification.sync; полный отзыв рвёт соединение', async () => {
    const dev = await connect(h.users.developer.token);
    const events = collect(dev);
    h.app.get(TenancyService).revoke(h.users.developer.id, h.projectId);
    await until(events, (e) => e.type === 'notification.sync');
    expect(dev.connected).toBe(true);
    // Комната жива: следующее событие того же человека доходит
    await h.http.post('/api/v1/auth/notifications/read').set(h.auth('developer')).send({ all: true }).expect(200);
    await until(events, (e) => e.type === 'notification.read' && e.all === true);

    const gone = new Promise<void>((resolve) => dev.on('disconnect', () => resolve()));
    h.app.get(TenancyService).revoke(h.users.developer.id);
    await gone;
  });
});
