/**
 * admin.spec — контур доступа (ADR 006): администратор инстанса (ADMIN_EMAILS) видит людей и проекты поперёк
 * тенантов, отключает человека (вход, токены, MCP и сокеты — сразу), завершает сессии, выдаёт право создавать
 * проекты. Проектные роли (в том числе `admin` проекта) сюда не пускают; MCP-токен — 404.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { createHarness, type Harness } from '../../test/harness';
import { hashPassword } from '../auth/password';
import { WS_PATH } from '../gateway/remark.gateway';

describe('instance admin', () => {
  let h: Harness;
  const tag = randomUUID().slice(0, 8);
  const created: string[] = [];
  let adminToken = '';

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0);
    // Второй адрес из ADMIN_EMAILS (test/setup.ts): первый занимает accounts.spec, спеки идут параллельно
    const admin = await h.prisma.user.upsert({
      where: { email: 'instance-admin-2@test.dev' },
      create: { email: 'instance-admin-2@test.dev', name: 'Админ', passwordHash: await hashPassword('secret-12') },
      update: { passwordHash: await hashPassword('secret-12'), disabledAt: null },
    });
    created.push(admin.id);
    const login = await h.http.post('/api/v1/auth/login').send({ email: admin.email, password: 'secret-12' }).expect(200);
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await h.prisma.membership.deleteMany({ where: { userId: { in: created } } });
    await h.prisma.user.deleteMany({ where: { id: { in: created } } });
    await h.cleanup();
  });

  const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

  it('только e-mail из ADMIN_EMAILS: pm и проектный admin — 403, MCP-токен — 404', async () => {
    await h.http.get('/api/v1/admin/users').set(h.auth('pm')).expect(403);
    await h.http.get('/api/v1/admin/users').set(h.auth('admin')).expect(403);
    const mcp = await h.http.post(`/api/v1/projects/${h.projectId}/mcp-token`).set(h.auth('pm')).expect(200);
    await h.http.get('/api/v1/admin/users').set(bearer(mcp.body.token)).expect(404);
    const me = await h.http.get('/api/v1/auth/me').set(bearer(adminToken)).expect(200);
    expect(me.body.user).toMatchObject({ isInstanceAdmin: true, canCreateProjects: true });
  });

  it('видит людей с membership по всем проектам и проекты с числом участников', async () => {
    const users = await h.http.get('/api/v1/admin/users').set(bearer(adminToken)).expect(200);
    const pm = users.body.find((u: { id: string }) => u.id === h.users.pm.id);
    expect(pm).toMatchObject({ email: h.users.pm.email, canCreateProjects: false, isInstanceAdmin: false, disabledAt: null });
    expect(pm.memberships).toEqual([{ projectId: h.projectId, projectName: expect.any(String), role: 'pm' }]);

    const projects = await h.http.get('/api/v1/admin/projects').set(bearer(adminToken)).expect(200);
    const mine = projects.body.find((p: { id: string }) => p.id === h.projectId);
    expect(mine).toMatchObject({ members: 4 });
  });

  it('право создавать проекты выдаётся и снимается флагом', async () => {
    await h.http.post('/api/v1/projects').set(h.auth('pm')).send({ name: 'Без права' }).expect(403);
    const granted = await h.http.patch(`/api/v1/admin/users/${h.users.pm.id}`).set(bearer(adminToken)).send({ canCreateProjects: true }).expect(200);
    expect(granted.body.canCreateProjects).toBe(true);
    const project = await h.http.post('/api/v1/projects').set(h.auth('pm')).send({ name: `Своё ${tag}` }).expect(201);
    await h.http.patch(`/api/v1/admin/users/${h.users.pm.id}`).set(bearer(adminToken)).send({ canCreateProjects: false }).expect(200);
    await h.http.post('/api/v1/projects').set(h.auth('pm')).send({ name: 'Снова нельзя' }).expect(403);
    await h.prisma.membership.deleteMany({ where: { projectId: project.body.id } });
    await h.prisma.project.delete({ where: { id: project.body.id } });
  });

  it('отключение: вход — 403, старые токены и MCP — 401, сокет рвётся; включение возвращает вход, но не старые токены', async () => {
    const dev = h.users.developer;
    const mcp = await h.http.post(`/api/v1/projects/${h.projectId}/mcp-token`).set(h.auth('developer')).expect(200);
    const port = (h.app.getHttpServer().address() as AddressInfo).port;
    const socket = io(`http://127.0.0.1:${port}`, { path: WS_PATH, auth: { token: dev.token }, transports: ['websocket'], reconnection: false });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    const disconnected = new Promise<string>((resolve) => socket.on('disconnect', (reason) => resolve(reason)));

    const disabled = await h.http.patch(`/api/v1/admin/users/${dev.id}`).set(bearer(adminToken)).send({ disabled: true }).expect(200);
    expect(disabled.body.disabledAt).toBeTruthy();
    expect(await disconnected).toBe('io server disconnect');
    await h.http.get('/api/v1/auth/me').set(h.auth('developer')).expect(401);
    await h.http.get(`/api/v1/projects/${h.projectId}`).set(bearer(mcp.body.token)).expect(401);
    const login = await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'secret-3' }).expect(403);
    expect(login.body.message).toMatch(/отключена/);
    await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'wrong-pass' }).expect(401);

    await h.http.patch(`/api/v1/admin/users/${dev.id}`).set(bearer(adminToken)).send({ disabled: false }).expect(200);
    await h.http.get('/api/v1/auth/me').set(h.auth('developer')).expect(401);
    const back = await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'secret-3' }).expect(200);
    await h.http.get('/api/v1/auth/me').set(bearer(back.body.accessToken)).expect(200);
    h.users.developer.token = back.body.accessToken;
  });

  it('«завершить все сессии»: старый токен — 401, новый вход работает; себя отключить нельзя (409); неизвестный — 404', async () => {
    const biz = h.users.business;
    await h.http.get('/api/v1/auth/me').set(h.auth('business')).expect(200);
    await h.http.post(`/api/v1/admin/users/${biz.id}/revoke-sessions`).set(bearer(adminToken)).expect(204);
    await h.http.get('/api/v1/auth/me').set(h.auth('business')).expect(401);
    const login = await h.http.post('/api/v1/auth/login').send({ email: biz.email, password: 'secret-3' }).expect(200);
    await h.http.get('/api/v1/auth/me').set(bearer(login.body.accessToken)).expect(200);
    h.users.business.token = login.body.accessToken;

    const me = await h.http.get('/api/v1/auth/me').set(bearer(adminToken)).expect(200);
    await h.http.patch(`/api/v1/admin/users/${me.body.user.id}`).set(bearer(adminToken)).send({ disabled: true }).expect(409);
    await h.http.patch('/api/v1/admin/users/00000000-0000-4000-8000-000000000000').set(bearer(adminToken)).send({ disabled: true }).expect(404);
    await h.http.patch(`/api/v1/admin/users/${biz.id}`).set(bearer(adminToken)).send({ disabled: 'yes' }).expect(422);
  });
});
