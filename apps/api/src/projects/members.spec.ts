/**
 * members.spec — фаза 11 (ADR 005): участников ведёт pm; приглашение по e-mail и ссылке;
 * последний pm не снимается; удалённый участник теряет доступ сразу (REST и WS).
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createHarness, type Harness } from '../../test/harness';
import { hashPassword } from '../auth/password';
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
    await h.prisma.invitation.deleteMany({ where: { projectId: h.projectId } });
    await h.prisma.membership.deleteMany({ where: { userId: { in: created } } });
    await h.prisma.user.deleteMany({ where: { id: { in: created } } });
    await h.cleanup();
  });

  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;
  const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
  const register = async (email: string, role: 'business' | 'pm' | 'developer', inviteToken?: string) => {
    const res = await h.http.post('/api/v1/auth/register').send({ name: email.split('@')[0], email, password: 'secret-12', preferredRole: role, inviteToken }).expect(201);
    created.push(res.body.user.id);
    return res.body as { accessToken: string; user: { id: string }; memberships: Array<{ projectId: string; role: string }> };
  };

  it('pm видит участников и приглашения; заказчик и разработчик — 403', async () => {
    const res = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(res.body.members.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'business', 'developer', 'pm']);
    expect(res.body.invitations).toEqual([]);
    await h.http.get(url('/members')).set(h.auth('business')).expect(403);
    await h.http.post(url('/members')).set(h.auth('developer')).send({ email: 'x@test.dev', role: 'developer' }).expect(403);
  });

  it('зарегистрированный — участник сразу; незнакомый e-mail — приглашение с token', async () => {
    const dev = await register(`dev-${tag}@test.dev`, 'developer');
    const added = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `DEV-${tag}@test.dev`, role: 'developer' }).expect(201);
    expect(added.body).toMatchObject({ kind: 'member', member: { userId: dev.user.id, role: 'developer' } });

    const invited = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `Biz-${tag}@test.dev`, role: 'business' }).expect(201);
    expect(invited.body.kind).toBe('invitation');
    expect(invited.body.invitation).toMatchObject({ email: `biz-${tag}@test.dev`, role: 'business' });
    expect(invited.body.invitation.token.length).toBeGreaterThanOrEqual(20);

    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    expect(list.body.invitations).toHaveLength(1);
  });

  it('ссылка: публичный просмотр; регистрация на приглашённый e-mail принимает приглашение', async () => {
    const list = await h.http.get(url('/members')).set(h.auth('pm')).expect(200);
    const token = list.body.invitations[0].token as string;
    const peek = await h.http.get(`/api/v1/invitations/${token}`).expect(200);
    expect(peek.body).toMatchObject({ role: 'business', email: `biz-${tag}@test.dev`, inviterName: 'pm' });
    expect(peek.body.projectName).toBeTruthy();

    const biz = await register(`biz-${tag}@test.dev`, 'business');
    expect(biz.memberships).toEqual([{ projectId: h.projectId, projectName: expect.any(String), role: 'business' }]);
    await h.http.get(`/api/v1/invitations/${token}`).expect(410);
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

  it('вход с ожидающим приглашением принимает его (аккаунт появился позже приглашения, но не через register)', async () => {
    const inv = await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `late-${tag}@test.dev`, role: 'developer' }).expect(201);
    expect(inv.body.kind).toBe('invitation');
    const user = await h.prisma.user.create({ data: { email: `late-${tag}@test.dev`, name: 'late', passwordHash: await hashPassword('secret-12'), preferredRole: 'developer' } });
    created.push(user.id);
    const login = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: 'secret-12' }).expect(200);
    expect(login.body.memberships).toEqual([expect.objectContaining({ projectId: h.projectId, role: 'developer' })]);
    await h.http.get(`/api/v1/invitations/${inv.body.invitation.token}`).expect(410);
  });

  it('смена роли; последний pm не понижается и не удаляется (409)', async () => {
    const dev = await h.prisma.user.findUniqueOrThrow({ where: { email: `dev-${tag}@test.dev` } });
    const changed = await h.http.patch(url(`/members/${dev.id}`)).set(h.auth('pm')).send({ role: 'business' }).expect(200);
    expect(changed.body).toMatchObject({ userId: dev.id, role: 'business' });

    await h.http.patch(url(`/members/${h.users.pm.id}`)).set(h.auth('pm')).send({ role: 'developer' }).expect(409);
    await h.http.delete(url(`/members/${h.users.pm.id}`)).set(h.auth('pm')).expect(409);
    await h.http.patch(url('/members/00000000-0000-4000-8000-000000000000')).set(h.auth('pm')).send({ role: 'pm' }).expect(404);
  });

  it('удалённый участник теряет доступ сразу: REST — 404, комната WS — 404', async () => {
    const dev = await h.prisma.user.findUniqueOrThrow({ where: { email: `dev-${tag}@test.dev` } });
    const login = await h.http.post('/api/v1/auth/login').send({ email: dev.email, password: 'secret-12' }).expect(200);
    await h.http.get(url('')).set(bearer(login.body.accessToken)).expect(200);

    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 901, description: 'для комнаты', status: 'defect' } });
    const port = (h.app.getHttpServer().address() as AddressInfo).port;
    const socket: Socket = await new Promise((resolve, reject) => {
      const s = io(`http://127.0.0.1:${port}`, { path: WS_PATH, auth: { token: login.body.accessToken }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
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
    await h.http.post(url('/members')).set(h.auth('pm')).send({ email: `pm2-${tag}@test.dev`, role: 'pm' }).expect(201);
    await h.http.delete(url(`/members/${h.users.pm.id}`)).set(bearer(pm2.accessToken)).expect(204);
    await h.http.get(url('')).set(h.auth('pm')).expect(404);
    // Возвращаем pm харнесса, чтобы cleanup прошёл штатно
    await h.prisma.membership.create({ data: { userId: h.users.pm.id, projectId: h.projectId, role: 'pm' } });
  });
});
