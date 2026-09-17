/**
 * members.spec — фаза 11 (ADR 005), контур доступа (ADR 006) и приглашения без почты (ADR 013): участников ведёт pm;
 * напрямую в проект никого не записывают — приглашение принимается по ссылке (токен — один раз, «Новая ссылка»
 * выпускает заново) или из колокольчика владельцем адреса; последний pm не снимается; удалённый или пониженный
 * участник теряет доступ сразу (REST и WS).
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createHarness, type Harness } from '../../test/harness';
import { WS_PATH } from '../gateway/remark.gateway';

describe('members and invitations', () => {
  let h: Harness;
  const tag = randomUUID().slice(0, 8);
  const created: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    await h.app.listen(0);
  });

  afterAll(async () => {
    await h.prisma.invitation.deleteMany({ where: { OR: [{ projectId: h.projectId }, { invitedById: { in: created } }] } });
    await h.prisma.membership.deleteMany({ where: { userId: { in: created } } });
    await h.prisma.user.deleteMany({ where: { id: { in: created } } });
    await h.cleanup();
  });

  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;
  const connect = (token: string): Promise<Socket> => {
    const port = (h.app.getHttpServer().address() as AddressInfo).port;
    return new Promise((resolve, reject) => {
      const s = io(`http://127.0.0.1:${port}`, { path: WS_PATH, auth: { token }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  };
  const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
  const register = async (email: string, role: 'business' | 'pm' | 'developer', inviteToken?: string) => {
    const res = await h.http.post('/api/v1/auth/register').send({ name: email.split('@')[0], email, password: 'secret-12', preferredRole: role, inviteToken }).expect(201);
    created.push(res.body.user.id);
    return res.body as { accessToken: string; user: { id: string }; memberships: Array<{ projectId: string; role: string }> };
  };

  it('pm видит участников и приглашения; заказчик и разработчик — 403; роль admin снаружи не принимается (A-2)', async () => {
    const res = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(res.body.members.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'business', 'developer', 'pm']);
    expect(res.body.invitations).toEqual([]);
    await h.http.get(url('/members')).set(h.auth('business')).expect(403);
    await h.http.post(url('/members')).set(h.auth('developer')).send({ email: 'x@test.dev', role: 'developer' }).expect(403);
    // Проектный admin в enum остался (харнесс пишет его через prisma), но через API ни выдать, ни назначить нельзя
    await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `nobody-${tag}@test.dev`, role: 'admin' }).expect(422);
    await h.http.patch(url(`/members/${h.users.developer.id}`)).set(h.auth('pm')).send({ role: 'admin' }).expect(422);
  });

  it('зарегистрированный не участник — приглашение с именем аккаунта (ADR 013); уже участник — смена роли; незнакомый e-mail — приглашение с token', async () => {
    const dev = await register(`dev-${tag}@test.dev`, 'developer');
    const devInvite = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `DEV-${tag}@test.dev`, role: 'business' }).expect(201);
    expect(devInvite.body).toMatchObject({ kind: 'invitation', invitation: { email: `dev-${tag}@test.dev`, role: 'business', inviteeName: `dev-${tag}` } });
    expect(await h.prisma.membership.count({ where: { projectId: h.projectId, userId: dev.user.id } })).toBe(0);
    await h.http.post(`/api/v1/auth/invitations/${devInvite.body.invitation.id}/accept`).set(bearer(dev.accessToken)).expect(200);
    const changed = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `DEV-${tag}@test.dev`, role: 'developer' }).expect(201);
    expect(changed.body).toEqual({ kind: 'member', member: expect.objectContaining({ userId: dev.user.id, role: 'developer' }) });

    const invited = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `Biz-${tag}@test.dev`, role: 'business' }).expect(201);
    expect(invited.body.kind).toBe('invitation');
    expect(invited.body.invitation).toMatchObject({ email: `biz-${tag}@test.dev`, role: 'business', inviteeName: null });
    expect(invited.body.invitation.token.length).toBeGreaterThanOrEqual(20);
    firstToken = invited.body.invitation.token;

    // В списке токена нет (ADR 006): в БД хранится только хэш
    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(list.body.invitations).toHaveLength(1);
    expect(list.body.invitations[0]).toMatchObject({ email: `biz-${tag}@test.dev`, inviteeName: null });
    expect(list.body.invitations[0].token).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(firstToken);
    const stored = await h.prisma.invitation.findUniqueOrThrow({ where: { id: list.body.invitations[0].id } });
    expect(stored.tokenHash).not.toBe(firstToken);
  });

  let firstToken = '';

  it('ссылка: публичный просмотр без e-mail приглашённого; «Новая ссылка» гасит прежнюю; регистрация по ссылке принимает приглашение', async () => {
    const peek = await h.http.get(`/api/v1/invitations/${firstToken}`).expect(200);
    expect(peek.body).toMatchObject({ role: 'business', inviterName: 'pm' });
    expect(peek.body.email).toBeUndefined();
    expect(peek.body.projectName).toBeTruthy();

    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    const fresh = await h.http.post(url(`/invitations/${list.body.invitations[0].id}/link`)).set(h.auth('pm')).expect(200);
    expect(fresh.body.token).not.toBe(firstToken);
    await h.http.get(`/api/v1/invitations/${firstToken}`).expect(404);
    await h.http.get(`/api/v1/invitations/${fresh.body.token}`).expect(200);

    const biz = await register(`biz-${tag}@test.dev`, 'business', fresh.body.token);
    expect(biz.memberships).toEqual([{ projectId: h.projectId, projectName: expect.any(String), projectSlug: expect.any(String), role: 'business' }]);
    await h.http.get(`/api/v1/invitations/${fresh.body.token}`).expect(410);
    await h.http.post(url('/invitations/00000000-0000-4000-8000-000000000000/link')).set(h.auth('pm')).expect(404);
    const after = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(after.body.invitations).toEqual([]);
  });

  it('ссылка принимается и другим e-mail (inviteToken при регистрации, accept после входа); отозванная — 404', async () => {
    const inv1 = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `link1-${tag}@test.dev`, role: 'developer' }).expect(201);
    const other = await register(`other1-${tag}@test.dev`, 'developer', inv1.body.invitation.token);
    expect(other.memberships).toEqual([expect.objectContaining({ projectId: h.projectId, role: 'developer' })]);

    const inv2 = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `link2-${tag}@test.dev`, role: 'business' }).expect(201);
    const later = await register(`other2-${tag}@test.dev`, 'business');
    expect(later.memberships).toEqual([]);
    const accepted = await h.http.post(`/api/v1/invitations/${inv2.body.invitation.token}/accept`).set(bearer(later.accessToken)).expect(200);
    expect(accepted.body.memberships).toEqual([expect.objectContaining({ projectId: h.projectId, role: 'business' })]);

    const inv3 = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `link3-${tag}@test.dev`, role: 'business' }).expect(201);
    await h.http.delete(url(`/invitations/${inv3.body.invitation.id}`)).set(h.auth('pm')).expect(204);
    await h.http.get(`/api/v1/invitations/${inv3.body.invitation.token}`).expect(404);
    await h.http.post(`/api/v1/invitations/${inv3.body.invitation.token}/accept`).set(bearer(later.accessToken)).expect(404);
  });

  it('совпадение e-mail само ничего не даёт: регистрация, вход и /auth/me не принимают приглашение; повтор PM — снова приглашение, уже с именем', async () => {
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `late-${tag}@test.dev`, role: 'developer' }).expect(201);
    expect(inv.body.kind).toBe('invitation');
    const late = await register(`late-${tag}@test.dev`, 'developer');
    expect(late.memberships).toEqual([]);
    const login = await h.http.post('/api/v1/auth/login').send({ email: `late-${tag}@test.dev`, password: 'secret-12' }).expect(200);
    expect(login.body.memberships).toEqual([]);
    const me = await h.http.get('/api/v1/auth/me').set(bearer(login.body.accessToken)).expect(200);
    expect(me.body.memberships).toEqual([]);
    await h.http.get(`/api/v1/invitations/${inv.body.invitation.token}`).expect(200);

    // Человек уже зарегистрирован: повтор PM — то же приглашение с новой ссылкой (старая гаснет) и именем аккаунта;
    // PM видит имя и в списке, человек — в колокольчике
    const again = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `late-${tag}@test.dev`, role: 'developer' }).expect(201);
    expect(again.body).toMatchObject({ kind: 'invitation', invitation: { id: inv.body.invitation.id, inviteeName: `late-${tag}` } });
    await h.http.get(`/api/v1/invitations/${inv.body.invitation.token}`).expect(404);
    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(list.body.invitations).toEqual(expect.arrayContaining([expect.objectContaining({ email: `late-${tag}@test.dev`, inviteeName: `late-${tag}` })]));
    const bell = await h.http.get('/api/v1/auth/invitations').set(bearer(login.body.accessToken)).expect(200);
    expect(bell.body).toEqual([expect.objectContaining({ id: inv.body.invitation.id, role: 'developer' })]);
    await h.http.delete(url(`/invitations/${inv.body.invitation.id}`)).set(h.auth('pm')).expect(204);
  });

  it('колокольчик (ADR 013): видны только живые приглашения в проекты на свой e-mail; принять — участник и свежий MeResult', async () => {
    const email = `bell-${tag}@test.dev`;
    const bell = await register(email, 'developer');
    const stranger = await register(`bell-other-${tag}@test.dev`, 'developer');
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: email.toUpperCase(), role: 'developer' }).expect(201);
    expect(inv.body).toMatchObject({ kind: 'invitation', invitation: { email, role: 'developer', inviteeName: `bell-${tag}` } });
    // Приглашение руководителя без проекта в колокольчик не попадает
    const admin = await h.prisma.user.create({ data: { email: `bell-admin-${tag}@test.dev`, name: 'админ' } });
    created.push(admin.id);
    await h.prisma.invitation.create({ data: { projectId: null, email, role: 'pm', tokenHash: `bell-instance-${tag}`, invitedById: admin.id } });

    const inbox = await h.http.get('/api/v1/auth/invitations').set(bearer(bell.accessToken)).expect(200);
    expect(inbox.body).toEqual([
      { id: inv.body.invitation.id, projectId: h.projectId, projectName: expect.any(String), projectSlug: expect.any(String), role: 'developer', inviterName: 'pm', createdAt: expect.any(String), expiresAt: expect.any(String) },
    ]);
    const others = await h.http.get('/api/v1/auth/invitations').set(bearer(stranger.accessToken)).expect(200);
    expect(others.body).toEqual([]);
    // Чужое приглашение по id — 404, а не 403: наличие не раскрываем; принять его нельзя
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/accept`).set(bearer(stranger.accessToken)).expect(404);
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/decline`).set(bearer(stranger.accessToken)).expect(404);
    await h.http.post('/api/v1/auth/invitations/00000000-0000-4000-8000-000000000000/accept').set(bearer(bell.accessToken)).expect(404);
    // Токен MCP (ADR 003) — личные маршруты для него не существуют
    const mcp = await h.http.post(url('/mcp-token')).set(h.auth('developer')).expect(200);
    await h.http.get('/api/v1/auth/invitations').set(bearer(mcp.body.token)).expect(404);

    const accepted = await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/accept`).set(bearer(bell.accessToken)).expect(200);
    expect(accepted.body.user).toMatchObject({ id: bell.user.id });
    expect(accepted.body.memberships).toEqual([expect.objectContaining({ projectId: h.projectId, role: 'developer' })]);
    // Второе нажатие (соседняя вкладка) — 410; колокольчик пуст, ссылка того же приглашения тоже отработала
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/accept`).set(bearer(bell.accessToken)).expect(410);
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/decline`).set(bearer(bell.accessToken)).expect(410);
    expect((await h.http.get('/api/v1/auth/invitations').set(bearer(bell.accessToken)).expect(200)).body).toEqual([]);
    await h.http.get(`/api/v1/invitations/${inv.body.invitation.token}`).expect(410);
  });

  it('колокольчик: отклонить — строки нет, PM её больше не видит; истёкшее не показывается и не принимается (404)', async () => {
    const email = `decline-${tag}@test.dev`;
    const person = await register(email, 'business');
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email, role: 'business' }).expect(201);
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/decline`).set(bearer(person.accessToken)).expect(204);
    expect(await h.prisma.invitation.findUnique({ where: { id: inv.body.invitation.id } })).toBeNull();
    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(list.body.invitations.map((i: { email: string }) => i.email)).not.toContain(email);
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/accept`).set(bearer(person.accessToken)).expect(404);

    const again = await h.http.post(url('/members')).set(h.auth('pm')).send({ email, role: 'business' }).expect(201);
    await h.prisma.invitation.update({ where: { id: again.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await h.http.get('/api/v1/auth/invitations').set(bearer(person.accessToken)).expect(200)).body).toEqual([]);
    await h.http.post(`/api/v1/auth/invitations/${again.body.invitation.id}/accept`).set(bearer(person.accessToken)).expect(404);
    await h.http.post(`/api/v1/auth/invitations/${again.body.invitation.id}/decline`).set(bearer(person.accessToken)).expect(404);
    expect(await h.prisma.membership.count({ where: { projectId: h.projectId, userId: person.user.id } })).toBe(0);
    await h.http.delete(url(`/invitations/${again.body.invitation.id}`)).set(h.auth('pm')).expect(204);
  });

  it('одну ссылку нельзя принять дважды параллельно (I-4): один 200, другой 410, место в проекте одно', async () => {
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `race-${tag}@test.dev`, role: 'developer' }).expect(201);
    const a = await register(`race-a-${tag}@test.dev`, 'developer');
    const b = await register(`race-b-${tag}@test.dev`, 'developer');
    const [ra, rb] = await Promise.all([
      h.http.post(`/api/v1/invitations/${inv.body.invitation.token}/accept`).set(bearer(a.accessToken)),
      h.http.post(`/api/v1/invitations/${inv.body.invitation.token}/accept`).set(bearer(b.accessToken)),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 410]);
    expect(await h.prisma.membership.count({ where: { projectId: h.projectId, userId: { in: [a.user.id, b.user.id] } } })).toBe(1);
  });

  it('смена роли выкидывает сокеты из комнат проекта; последний pm не понижается и не удаляется (409)', async () => {
    const dev = await h.prisma.user.findUniqueOrThrow({ where: { email: `dev-${tag}@test.dev` } });
    const login = await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'secret-12' }).expect(200);
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 902, description: 'смена роли', status: 'defect' } });
    const socket = await connect(login.body.accessToken);
    const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit('join', { projectId: h.projectId, remarkId: remark.id }, resolve));
    expect(joined.ok).toBe(true);
    const left = new Promise<void>((resolve) => socket.on('presence', (e: { action?: string; userId?: string }) => e.action === 'leave' && e.userId === dev.id && resolve()));

    const changed = await h.http.patch(url(`/members/${dev.id}`)).set(h.auth('pm')).send({ role: 'business' }).expect(200);
    expect(changed.body).toMatchObject({ userId: dev.id, role: 'business' });
    // Контекст на join закеширован: после смены роли сервер выкинул сокет из комнаты (presence leave уходит остальным);
    // повторный join даёт уже новую роль
    const rejoin = await new Promise<{ ok: boolean }>((resolve) => socket.emit('join', { projectId: h.projectId, remarkId: remark.id }, resolve));
    expect(rejoin.ok).toBe(true);
    socket.disconnect();
    void left;
    await h.prisma.remark.delete({ where: { id: remark.id } });

    await h.http.patch(url(`/members/${h.users.pm.id}`)).set(h.auth('pm')).send({ role: 'developer' }).expect(409);
    await h.http.delete(url(`/members/${h.users.pm.id}`)).set(h.auth('pm')).expect(409);
    await h.http.patch(url('/members/00000000-0000-4000-8000-000000000000')).set(h.auth('pm')).send({ role: 'pm' }).expect(404);
  });

  it('удалённый участник теряет доступ сразу: REST — 404, комната WS — 404', async () => {
    const dev = await h.prisma.user.findUniqueOrThrow({ where: { email: `dev-${tag}@test.dev` } });
    const login = await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'secret-12' }).expect(200);
    await h.http.get(url('')).set(bearer(login.body.accessToken)).expect(200);

    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 901, description: 'для комнаты', status: 'defect' } });
    const socket = await connect(login.body.accessToken);
    const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit('join', { projectId: h.projectId, remarkId: remark.id }, resolve));
    expect(joined.ok).toBe(true);

    await h.http.delete(url(`/members/${dev.id}`)).set(h.auth('pm')).expect(204);
    await h.http.get(url('')).set(bearer(login.body.accessToken)).expect(404);
    const rejoin = await new Promise<{ ok: boolean; status?: number }>((resolve) => socket.emit('join', { projectId: h.projectId, remarkId: remark.id }, resolve));
    expect(rejoin).toMatchObject({ ok: false, status: 404 });
    socket.disconnect();
    await h.prisma.remark.delete({ where: { id: remark.id } });

    // Второй pm — теперь первого можно убрать
    const pm2 = await register(`pm2-${tag}@test.dev`, 'pm');
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `pm2-${tag}@test.dev`, role: 'pm' }).expect(201);
    await h.http.post(`/api/v1/auth/invitations/${inv.body.invitation.id}/accept`).set(bearer(pm2.accessToken)).expect(200);
    await h.http.delete(url(`/members/${h.users.pm.id}`)).set(bearer(pm2.accessToken)).expect(204);
    await h.http.get(url('')).set(h.auth('pm')).expect(404);
    // Возвращаем pm харнесса, чтобы cleanup прошёл штатно
    await h.prisma.membership.create({ data: { userId: h.users.pm.id, projectId: h.projectId, role: 'pm' } });
  });
});
