/**
 * accounts.spec — фаза 11 (ADR 005): регистрация, свежие membership без перелогина, профиль,
 * смена пароля как отзыв токенов, кто создаёт проекты, демо-опции.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';

describe('accounts', () => {
  let h: Harness;
  const tag = randomUUID().slice(0, 8);
  const created: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.prisma.membership.deleteMany({ where: { userId: { in: created } } });
    await h.prisma.user.deleteMany({ where: { id: { in: created } } });
    await h.cleanup();
  });

  const register = (body: Record<string, unknown>) => h.http.post('/api/v1/auth/register').send(body);
  const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

  it('регистрация: сессия как у входа, membership пустой, сторона сохранена', async () => {
    const res = await register({ name: '  Айгерим  ', email: `Biz-${tag}@Test.dev`, password: 'secret-12', preferredRole: 'business' }).expect(201);
    created.push(res.body.user.id);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: `biz-${tag}@test.dev`, name: 'Айгерим', preferredRole: 'business' });
    expect(res.body.memberships).toEqual([]);
    await h.http.get('/api/v1/auth/me').set(bearer(res.body.accessToken)).expect(200);
  });

  it('дубликат e-mail — 409, короткий пароль и чужая сторона — 422', async () => {
    await register({ name: 'Дубль', email: `biz-${tag}@test.dev`, password: 'secret-12', preferredRole: 'pm' }).expect(409);
    await register({ name: 'Короткий', email: `short-${tag}@test.dev`, password: '1234567', preferredRole: 'pm' }).expect(422);
    await register({ name: 'Админ', email: `admin-${tag}@test.dev`, password: 'secret-12', preferredRole: 'admin' }).expect(422);
  });

  it('вход новым аккаунтом; GET /auth/me видит membership, появившийся после входа', async () => {
    const login = await h.http.post('/api/v1/auth/login').send({ email: `biz-${tag}@test.dev`, password: 'secret-12' }).expect(200);
    expect(login.body.memberships).toEqual([]);
    await h.prisma.membership.create({ data: { userId: login.body.user.id, projectId: h.projectId, role: 'business' } });
    const me = await h.http.get('/api/v1/auth/me').set(bearer(login.body.accessToken)).expect(200);
    expect(me.body.memberships).toEqual([{ projectId: h.projectId, projectName: expect.any(String), role: 'business' }]);
  });

  it('профиль: имя и сторона меняются', async () => {
    const login = await h.http.post('/api/v1/auth/login').send({ email: `biz-${tag}@test.dev`, password: 'secret-12' }).expect(200);
    const res = await h.http.patch('/api/v1/auth/profile').set(bearer(login.body.accessToken)).send({ name: 'Айгерим К.', preferredRole: 'pm' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Айгерим К.', preferredRole: 'pm' });
    await h.http.patch('/api/v1/auth/profile').set(bearer(login.body.accessToken)).send({ preferredRole: 'admin' }).expect(422);
  });

  it('смена пароля: неверный текущий — 422; после смены старые токены (и MCP) — 401, новый работает', async () => {
    const login = await h.http.post('/api/v1/auth/login').send({ email: `biz-${tag}@test.dev`, password: 'secret-12' }).expect(200);
    const old = bearer(login.body.accessToken);
    const mcp = await h.http.post(`/api/v1/projects/${h.projectId}/mcp-token`).set(old).expect(200);
    await h.http.post('/api/v1/auth/password').set(old).send({ current: 'wrong-123', next: 'secret-34' }).expect(422);
    const changed = await h.http.post('/api/v1/auth/password').set(old).send({ current: 'secret-12', next: 'secret-34' }).expect(200);
    await h.http.get('/api/v1/auth/me').set(old).expect(401);
    await h.http.get(`/api/v1/projects/${h.projectId}`).set(bearer(mcp.body.token)).expect(401);
    await h.http.get('/api/v1/auth/me').set(bearer(changed.body.accessToken)).expect(200);
    await h.http.post('/api/v1/auth/login').send({ email: `biz-${tag}@test.dev`, password: 'secret-12' }).expect(401);
    await h.http.post('/api/v1/auth/login').send({ email: `biz-${tag}@test.dev`, password: 'secret-34' }).expect(200);
  });

  it('проект создаёт только сторона pm; создатель — pm проекта', async () => {
    const biz = await register({ name: 'Заказчик', email: `biz2-${tag}@test.dev`, password: 'secret-12', preferredRole: 'business' }).expect(201);
    created.push(biz.body.user.id);
    await h.http.post('/api/v1/projects').set(bearer(biz.body.accessToken)).send({ name: 'Нельзя' }).expect(403);

    const pm = await register({ name: 'Дана', email: `pm2-${tag}@test.dev`, password: 'secret-12', preferredRole: 'pm' }).expect(201);
    created.push(pm.body.user.id);
    const project = await h.http.post('/api/v1/projects').set(bearer(pm.body.accessToken)).send({ name: `Новый ${tag}` }).expect(201);
    expect(project.body.role).toBe('pm');
    const me = await h.http.get('/api/v1/auth/me').set(bearer(pm.body.accessToken)).expect(200);
    expect(me.body.memberships).toEqual([{ projectId: project.body.id, projectName: `Новый ${tag}`, role: 'pm' }]);
    await h.prisma.membership.deleteMany({ where: { projectId: project.body.id } });
    await h.prisma.project.delete({ where: { id: project.body.id } });
  });

  it('без пароля (passwordHash null) вход невозможен; /auth/options публичен', async () => {
    const user = await h.prisma.user.create({ data: { email: `google-${tag}@test.dev`, name: 'Google', passwordHash: null } });
    created.push(user.id);
    await h.http.post('/api/v1/auth/login').send({ email: user.email, password: 'anything-1' }).expect(401);
    const options = await h.http.get('/api/v1/auth/options').expect(200);
    expect(typeof options.body.demoLogins).toBe('boolean');
  });
});
