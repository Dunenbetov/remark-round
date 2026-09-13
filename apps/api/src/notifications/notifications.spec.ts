/**
 * notifications.spec — ADR 009, аудит: no-notifications.
 * Переход, после которого у человека появляется кнопка, пишет уведомление участникам его роли; задача очереди
 * `notify_digest` склеивает всё, что накопилось у человека за окно, в одно письмо со ссылками на карточки.
 * Кто нажал — о своём действии письма не получает; выключил в профиле — «пропущено»; SMTP упал — повтор.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import { NotificationsService } from './notifications.service';

describe('notifications', () => {
  let h: Harness;
  let notifications: NotificationsService;
  let nextNumber = 9200;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
    notifications = h.app.get(NotificationsService);
  });

  afterAll(async () => {
    await h.cleanup();
  });

  beforeEach(() => {
    h.mail.sent.length = 0;
  });

  async function remarkIn(status: 'awaiting_pm' | 'defect' | 'ready_for_retest' | 'awaiting_business_close' | 'imported', description = 'Нет кнопки «Сохранить»') {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: nextNumber++, description, status, rationale: 'Черновик.' } });
    const run = status === 'awaiting_pm' ? await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'awaiting_human', mode: 'triage' } }) : null;
    return { id: remark.id, number: remark.number, runId: run?.id ?? '' };
  }

  async function waitStatus(remarkId: string, userId: string, status: string, timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const n = await h.prisma.notification.findFirst({ where: { remarkId, userId } });
      if (n?.status === status) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`notification ${remarkId}/${userId}: не дождались ${status}`);
  }

  it('вердикт PM «дефект» → письмо разработчику со ссылкой на карточку; PM о своём решении письма не получает', async () => {
    const { id, number, runId } = await remarkIn('awaiting_pm', 'Кнопка «Сохранить» серая, а в ТЗ синяя');
    await h.http.post(url(`/remarks/${id}/verdict`)).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    const [mail] = await h.mail.waitFor(1);
    expect(mail!.to).toBe(h.users.developer.email);
    expect(mail!.from).toBe('RemarkRound <no-reply@test.dev>');
    expect(mail!.subject).toContain(`№${number}`);
    const { slug } = await h.prisma.project.findUniqueOrThrow({ where: { id: h.projectId } });
    expect(mail!.text).toContain(`/${slug}/round-1/${number}`);
    expect(mail!.text).toContain('в работу');
    expect(mail!.html).toContain('<a href=');
    const rows = await h.prisma.notification.findMany({ where: { remarkId: id } });
    expect(rows.map((r) => r.userId)).toEqual([h.users.developer.id]);
    expect(rows[0]).toMatchObject({ kind: 'defect', status: 'sent' });
    expect(rows[0]!.sentAt).toBeTruthy();
  });

  it('разбор дошёл до awaiting_pm → письмо PM; несколько замечаний за окно — одно письмо', async () => {
    const a = await remarkIn('imported', 'Первое за окно');
    const b = await remarkIn('imported', 'Второе за окно');
    // Прямой вызов того же метода, что зовёт RemarksService.applyProposal: граф здесь не нужен
    await h.prisma.$transaction((tx) => notifications.remarkChanged(tx, h.projectId, a.id, 'awaiting_pm', h.users.business.id));
    await h.prisma.$transaction((tx) => notifications.remarkChanged(tx, h.projectId, b.id, 'awaiting_pm', h.users.business.id));
    const queued = await h.prisma.job.count({ where: { kind: 'notify_digest', status: 'queued', payload: { path: ['userId'], equals: h.users.pm.id } } });
    expect(queued).toBe(1);
    const [mail] = await h.mail.waitFor(1);
    expect(mail!.to).toBe(h.users.pm.email);
    expect(mail!.subject).toContain('2 замечания');
    expect(mail!.text).toContain(`№${a.number}`);
    expect(mail!.text).toContain(`№${b.number}`);
    expect(mail!.text).toContain('ждёт вашего решения');
    await new Promise((r) => setTimeout(r, 400));
    expect(h.mail.sent).toHaveLength(1);
  });

  it('«Готово» разработчика → письмо заказчику «проверьте»; ретест готов → письмо заказчику, даже если он сам его запустил', async () => {
    const { id } = await remarkIn('defect');
    await h.http.post(url(`/remarks/${id}/ready-for-retest`)).set(h.auth('developer')).expect(200);
    const [first] = await h.mail.waitFor(1);
    expect(first!.to).toBe(h.users.business.email);
    expect(first!.text).toContain('проверьте: закройте или приложите новый кадр');

    await h.prisma.$transaction((tx) => notifications.remarkChanged(tx, h.projectId, id, 'awaiting_business_close', null));
    const [, second] = await h.mail.waitFor(2);
    expect(second!.to).toBe(h.users.business.email);
    expect(second!.text).toContain('закройте или верните');
  });

  it('выключил письма в профиле → уведомление «пропущено», письма нет; включил обратно — приходят', async () => {
    const me = await h.http.patch('/api/v1/auth/profile').set(h.auth('developer')).send({ notifyByEmail: false }).expect(200);
    expect(me.body.notifyByEmail).toBe(false);
    const { id, runId } = await remarkIn('awaiting_pm');
    await h.http.post(url(`/remarks/${id}/verdict`)).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    await waitStatus(id, h.users.developer.id, 'skipped');
    await new Promise((r) => setTimeout(r, 400));
    expect(h.mail.sent).toHaveLength(0);

    await h.http.patch('/api/v1/auth/profile').set(h.auth('developer')).send({ notifyByEmail: true }).expect(200);
    const again = await remarkIn('awaiting_pm');
    await h.http.post(url(`/remarks/${again.id}/verdict`)).set(h.auth('pm')).send({ runId: again.runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    await waitStatus(again.id, h.users.developer.id, 'sent');
    expect(h.mail.sent).toHaveLength(1);
  });

  it('SMTP упал один раз → задача повторяется, письмо доходит; упал совсем → уведомление failed с причиной', async () => {
    h.mail.failNext.push(new Error('ECONNREFUSED 127.0.0.1:2525'));
    const { id, runId } = await remarkIn('awaiting_pm', 'SMTP моргнул');
    await h.http.post(url(`/remarks/${id}/verdict`)).set(h.auth('pm')).send({ runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    await waitStatus(id, h.users.developer.id, 'sent');
    expect(h.mail.sent).toHaveLength(1);
    // Уведомление помечается sent внутри обработчика, а строка задачи — после него: ждём done, а не читаем сразу
    let job = await h.prisma.job.findFirstOrThrow({ where: { kind: 'notify_digest', projectId: h.projectId }, orderBy: { createdAt: 'desc' } });
    for (let i = 0; i < 50 && job.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    }
    expect(job).toMatchObject({ status: 'done', attempts: 2 });

    h.mail.failNext.push(new Error('x'), new Error('y'), new Error('z'));
    const dead = await remarkIn('awaiting_pm', 'SMTP лёг');
    await h.http.post(url(`/remarks/${dead.id}/verdict`)).set(h.auth('pm')).send({ runId: dead.runId, verdict: 'defect', idempotencyKey: randomUUID() }).expect(200);
    await waitStatus(dead.id, h.users.developer.id, 'failed');
    const row = await h.prisma.notification.findFirstOrThrow({ where: { remarkId: dead.id } });
    expect(row.error).toBe('z');
    expect(h.mail.sent).toHaveLength(1);
  });

  it('приглашение по e-mail уходит письмом со ссылкой /join/<token>; ответ говорит emailed: true', async () => {
    const email = `invitee-${randomUUID().slice(0, 8)}@test.dev`;
    const res = await h.http.post(url('/members')).set(h.auth('pm')).send({ email, role: 'business' }).expect(201);
    expect(res.body.kind).toBe('invitation');
    expect(res.body.invitation.emailed).toBe(true);
    const [mail] = await h.mail.waitFor(1);
    expect(mail!.to).toBe(email);
    expect(mail!.subject).toContain('приглашение');
    expect(mail!.text).toContain(`/join/${res.body.invitation.token}`);
    expect(mail!.text).toContain('заказчик');
    expect(mail!.text).not.toContain(h.users.pm.email);
  });

  it('GET /auth/options говорит, что почта настроена', async () => {
    const res = await h.http.get('/api/v1/auth/options').expect(200);
    expect(res.body.mail).toBe(true);
  });
});
