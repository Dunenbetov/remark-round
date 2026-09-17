/**
 * accounts.spec — фаза 11 (ADR 005) и контур доступа (ADR 006): регистрация и её режимы, свежие membership
 * без перелогина, профиль, смена пароля как отзыв токенов, ссылка смены пароля от администратора (ADR 013),
 * право создавать проекты как флаг, демо-опции.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import { resetConfig } from '../config';
import { hashPassword } from './password';
import { hashToken } from '../tenancy/invitations.service';

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
    expect(me.body.memberships).toEqual([{ projectId: h.projectId, projectName: expect.any(String), projectSlug: expect.any(String), role: 'business' }]);
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

  it('проект создаёт только тот, кому выдано право (ADR 006): сторона pm сама по себе его не даёт; создатель — pm проекта', async () => {
    const biz = await register({ name: 'Заказчик', email: `biz2-${tag}@test.dev`, password: 'secret-12', preferredRole: 'business' }).expect(201);
    created.push(biz.body.user.id);
    await h.http.post('/api/v1/projects').set(bearer(biz.body.accessToken)).send({ name: 'Нельзя' }).expect(403);

    const pm = await register({ name: 'Дана', email: `pm2-${tag}@test.dev`, password: 'secret-12', preferredRole: 'pm' }).expect(201);
    created.push(pm.body.user.id);
    expect(pm.body.user.canCreateProjects).toBe(false);
    await h.http.post('/api/v1/projects').set(bearer(pm.body.accessToken)).send({ name: 'Пока нельзя' }).expect(403);
    await h.prisma.user.update({ where: { id: pm.body.user.id }, data: { canCreateProjects: true } });
    const project = await h.http.post('/api/v1/projects').set(bearer(pm.body.accessToken)).send({ name: `Новый ${tag}` }).expect(201);
    expect(project.body.role).toBe('pm');
    const me = await h.http.get('/api/v1/auth/me').set(bearer(pm.body.accessToken)).expect(200);
    expect(project.body.slug).toBe(`novyy-${tag}`);
    expect(me.body.memberships).toEqual([{ projectId: project.body.id, projectName: `Новый ${tag}`, projectSlug: `novyy-${tag}`, role: 'pm' }]);
    // одноимённый проект получает следующий свободный адрес, а не 500 на unique
    const twin = await h.http.post('/api/v1/projects').set(bearer(pm.body.accessToken)).send({ name: `Новый ${tag}` }).expect(201);
    expect(twin.body.slug).toBe(`novyy-${tag}-2`);
    await h.prisma.membership.deleteMany({ where: { projectId: { in: [project.body.id, twin.body.id] } } });
    await h.prisma.project.deleteMany({ where: { id: { in: [project.body.id, twin.body.id] } } });
  });

  it('без пароля (passwordHash null) вход невозможен; /auth/options публичен и сообщает режим регистрации', async () => {
    const user = await h.prisma.user.create({ data: { email: `google-${tag}@test.dev`, name: 'Google', passwordHash: null } });
    created.push(user.id);
    await h.http.post('/api/v1/auth/login').send({ email: user.email, password: 'anything-1' }).expect(401);
    const options = await h.http.get('/api/v1/auth/options').expect(200);
    expect(typeof options.body.demoLogins).toBe('boolean');
    expect(options.body.registration).toBe('open');
    // Демо-персоны приходят с сервера только при demoLogins (D-2): в тестах NODE_ENV=test → включены
    expect(options.body.demoAccounts).toHaveLength(3);
    expect(options.body.demoAccounts.map((a: { role: string }) => a.role).sort()).toEqual(['business', 'developer', 'pm']);
    expect(options.body.demoPassword).toBe('remarkround');
    // Sentry для SPA (R-L5): DSN приходит только при SENTRY_DSN_WEB
    expect(options.body.sentryDsn).toBeUndefined();
    expect(options.body.release).toBe('dev');
    process.env['DEMO_LOGINS'] = 'false';
    process.env['SENTRY_DSN_WEB'] = 'https://public@o1.ingest.sentry.io/2';
    resetConfig();
    try {
      const closed = await h.http.get('/api/v1/auth/options').expect(200);
      expect(closed.body.demoLogins).toBe(false);
      expect(closed.body.demoAccounts).toBeUndefined();
      expect(closed.body.demoPassword).toBeUndefined();
      expect(closed.body.sentryDsn).toBe('https://public@o1.ingest.sentry.io/2');
    } finally {
      delete process.env['DEMO_LOGINS'];
      delete process.env['SENTRY_DSN_WEB'];
      resetConfig();
    }
  });

  describe('Ссылка смены пароля от администратора (ADR 012, ADR 013)', () => {
    const email = `reset-${tag}@test.dev`;
    let userId = '';
    let adminToken = '';
    const resetLink = (id: string, auth: Record<string, string>) => h.http.post(`/api/v1/admin/users/${id}/reset-link`).set(auth);

    beforeAll(async () => {
      const res = await register({ name: 'Забыла', email, password: 'secret-12', preferredRole: 'business' }).expect(201);
      userId = res.body.user.id;
      created.push(userId);
      // ADMIN_EMAILS (test/setup.ts): первый адрес — этой спеки; блок invite_only ниже пересоздаёт его регистрацией
      const admin = await h.prisma.user.upsert({
        where: { email: 'instance-admin@test.dev' },
        update: { passwordHash: await hashPassword('secret-12'), disabledAt: null },
        create: { email: 'instance-admin@test.dev', name: 'Админ', passwordHash: await hashPassword('secret-12') },
      });
      created.push(admin.id);
      adminToken = (await h.http.post('/api/v1/auth/login').send({ email: admin.email, password: 'secret-12' }).expect(200)).body.accessToken;
    });

    it('писем нет — ссылку выдаёт только администратор инстанса — pm 403, неизвестный 404, отключённый 409', async () => {
      const options = await h.http.get('/api/v1/auth/options').expect(200);
      expect(options.body.mail).toBeUndefined();

      await resetLink(userId, h.auth('pm')).expect(403);
      await resetLink('00000000-0000-4000-8000-000000000000', bearer(adminToken)).expect(404);
      await h.prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
      const disabled = await resetLink(userId, bearer(adminToken)).expect(409);
      expect(disabled.body.message).toBe('Человек отключён — сначала включите его');
      await h.prisma.user.update({ where: { id: userId }, data: { disabledAt: null } });
      expect(await h.prisma.passwordReset.count({ where: { userId } })).toBe(0);
    });

    it('ссылка живёт сутки и в БД — только хэш; вторая ссылка гасит первую; сброс = выход везде; ссылка одноразовая (410); истёкшая и чужая — 404', async () => {
      const login = await h.http.post('/api/v1/auth/login').send({ email, password: 'secret-12' }).expect(200);
      const old = bearer(login.body.accessToken);

      const first = await resetLink(userId, bearer(adminToken)).expect(200);
      expect(first.body.token.length).toBeGreaterThanOrEqual(20);
      const ttl = new Date(first.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23 * 3600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
      expect((await h.prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: hashToken(first.body.token) } })).userId).toBe(userId);

      const second = await resetLink(userId, bearer(adminToken)).expect(200);
      expect(second.body.token).not.toBe(first.body.token);
      const dead = await h.http.post('/api/v1/auth/reset').send({ token: first.body.token, password: 'secret-99' }).expect(404);
      expect(dead.body.message).toBe('Ссылка для смены пароля не действует — попросите администратора выдать новую');

      const token = second.body.token as string;
      await h.http.post('/api/v1/auth/reset').send({ token, password: '1234567' }).expect(422);
      await h.http.post('/api/v1/auth/reset').send({ token, password: 'secret-99' }).expect(204);
      await h.http.get('/api/v1/auth/me').set(old).expect(401);
      await h.http.post('/api/v1/auth/login').send({ email, password: 'secret-12' }).expect(401);
      await h.http.post('/api/v1/auth/login').send({ email, password: 'secret-99' }).expect(200);
      const used = await h.http.post('/api/v1/auth/reset').send({ token, password: 'secret-77' }).expect(410);
      expect(used.body.message).toBe('Ссылка уже использована — попросите администратора выдать новую');

      const expired = 'expired-token-0000000000';
      await h.prisma.passwordReset.create({ data: { userId, tokenHash: hashToken(expired), expiresAt: new Date(Date.now() - 1000) } });
      await h.http.post('/api/v1/auth/reset').send({ token: expired, password: 'secret-77' }).expect(404);
      await h.http.post('/api/v1/auth/reset').send({ token: 'unknown-token-00000000000', password: 'secret-77' }).expect(404);
      await h.http.post('/api/v1/auth/login').send({ email, password: 'secret-99' }).expect(200);
    });
  });

  describe('REGISTRATION_MODE=invite_only (ADR 006)', () => {
    const env = { mode: process.env['REGISTRATION_MODE'], domains: process.env['REGISTRATION_DOMAINS'] };

    beforeAll(() => {
      process.env['REGISTRATION_MODE'] = 'invite_only';
      process.env['REGISTRATION_DOMAINS'] = 'Company.KZ';
      resetConfig();
    });

    afterAll(() => {
      process.env['REGISTRATION_MODE'] = env.mode;
      process.env['REGISTRATION_DOMAINS'] = env.domains;
      if (env.mode === undefined) delete process.env['REGISTRATION_MODE'];
      if (env.domains === undefined) delete process.env['REGISTRATION_DOMAINS'];
      resetConfig();
    });

    it('без ссылки — 403; по мёртвой ссылке — 404 и аккаунт не создаётся; с домена компании и администратор — можно', async () => {
      const options = await h.http.get('/api/v1/auth/options').expect(200);
      expect(options.body.registration).toBe('invite_only');
      await register({ name: 'Чужой', email: `stranger-${tag}@gmail.com`, password: 'secret-12', preferredRole: 'pm' }).expect(403);
      await register({ name: 'Мёртвая', email: `dead-${tag}@gmail.com`, password: 'secret-12', preferredRole: 'pm', inviteToken: 'no-such-token-0000000000' }).expect(404);
      expect(await h.prisma.user.findUnique({ where: { email: `dead-${tag}@gmail.com` } })).toBeNull();

      const staff = await register({ name: 'Сотрудник', email: `staff-${tag}@company.kz`, password: 'secret-12', preferredRole: 'developer' }).expect(201);
      created.push(staff.body.user.id);
      expect(staff.body.memberships).toEqual([]);

      // ADMIN_EMAILS (test/setup.ts): первый человек в пустой системе регистрируется всегда и может создавать проекты
      await h.prisma.user.deleteMany({ where: { email: 'instance-admin@test.dev' } });
      const admin = await register({ name: 'Админ', email: 'instance-admin@test.dev', password: 'secret-12', preferredRole: 'pm' }).expect(201);
      created.push(admin.body.user.id);
      expect(admin.body.user).toMatchObject({ isInstanceAdmin: true, canCreateProjects: true });
    });

    it('администратор инстанса — скрытая роль без стороны (ADR 006, 17.09): присланная сторона не сохраняется и не отдаётся, профиль её тоже не пишет', async () => {
      const login = await h.http.post('/api/v1/auth/login').send({ email: 'instance-admin@test.dev', password: 'secret-12' }).expect(200);
      expect(login.body.user).toMatchObject({ isInstanceAdmin: true, preferredRole: null });
      expect((await h.prisma.user.findUniqueOrThrow({ where: { email: 'instance-admin@test.dev' } })).preferredRole).toBeNull();
      const profile = await h.http.patch('/api/v1/auth/profile').set(bearer(login.body.accessToken)).send({ name: 'Админ А.', preferredRole: 'pm' }).expect(200);
      expect(profile.body).toMatchObject({ name: 'Админ А.', preferredRole: null });
      expect((await h.prisma.user.findUniqueOrThrow({ where: { email: 'instance-admin@test.dev' } })).preferredRole).toBeNull();
      const me = await h.http.get('/api/v1/auth/me').set(bearer(login.body.accessToken)).expect(200);
      expect(me.body.user.preferredRole).toBeNull();
      // Обычный человек сторону сохраняет — как и раньше
      const staff = await h.prisma.user.findUniqueOrThrow({ where: { email: `staff-${tag}@company.kz` } });
      expect(staff.preferredRole).toBe('developer');
    });

    it('по живой ссылке регистрируется кто угодно и сразу попадает в проект', async () => {
      const invited = await h.http.post(`/api/v1/projects/${h.projectId}/members`).set(h.auth('pm')).send({ email: `guest-${tag}@client.com`, role: 'business' }).expect(201);
      expect(invited.body.kind).toBe('invitation');
      const guest = await register({ name: 'Гость', email: `guest-${tag}@client.com`, password: 'secret-12', preferredRole: 'business', inviteToken: invited.body.invitation.token }).expect(201);
      created.push(guest.body.user.id);
      expect(guest.body.memberships).toEqual([expect.objectContaining({ projectId: h.projectId, role: 'business' })]);
      await h.prisma.membership.deleteMany({ where: { userId: guest.body.user.id } });
      await h.prisma.invitation.deleteMany({ where: { projectId: h.projectId } });
    });
  });
});
