/**
 * tenancy.sweep.spec — аудит: tenancy-not-enforced. Таблично по всем проектным маршрутам docs/API.md:
 * (1) путь чужого проекта — 404 из MembershipGuard независимо от роли; (2) свой проект, но id чужого ресурса
 * (раунд, замечание, прогон, документ, импорт, кадр, участник, приглашение) — 404 из сервиса, не 200 и не 500;
 * (3) внешние ключи в Postgres: замечание в раунде чужого проекта и прогон несуществующего проекта не записываются
 * даже мимо сервисов.
 */
import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Role } from '@remarkround/db';
import { createHarness, type Harness } from '../../test/harness';
import { StorageService } from '../storage/storage.service';

/** 1×1 PNG: достаточно, чтобы пройти sniff и лечь в хранилище. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Probe {
  name: string;
  method: Method;
  path: string;
  as?: Role;
  body?: Record<string, unknown>;
  expect?: number;
}

describe('tenancy sweep', () => {
  let h: Harness;
  const tag = randomUUID().slice(0, 8);
  const B = { userId: '', projectId: '', roundId: '', remarkId: '', runId: '', docId: '', jobId: '', invitationId: '', mediaFile: '', mediaKey: '' };
  let closedRemarkA = '';
  let keyA = '';

  beforeAll(async () => {
    h = await createHarness();
    const userB = await h.prisma.user.create({ data: { email: `sweep-b-${tag}@test.dev`, name: 'B', passwordHash: null } });
    const projectB = await h.prisma.project.create({ data: { name: `Sweep-B-${tag}`, memberships: { create: { userId: userB.id, role: 'pm' } } } });
    const roundB = await h.prisma.round.create({ data: { projectId: projectB.id, number: 1 } });
    const remarkB = await h.prisma.remark.create({ data: { projectId: projectB.id, roundId: roundB.id, number: 1, description: 'Чужое замечание', status: 'awaiting_pm', rationale: 'Черновик.' } });
    const runB = await h.prisma.agentRun.create({ data: { remarkId: remarkB.id, projectId: projectB.id, status: 'awaiting_human', mode: 'triage' } });
    const docB = await h.prisma.document.create({ data: { projectId: projectB.id, kind: 'spec', title: 'B.md', mime: 'text/markdown', storageKey: `${projectB.id}/${randomUUID()}.md` } });
    const jobB = await h.prisma.importJob.create({ data: { projectId: projectB.id, roundId: roundB.id, fileName: 'b.csv', storageKey: `${projectB.id}/${randomUUID()}.csv` } });
    const invB = await h.prisma.invitation.create({ data: { projectId: projectB.id, email: `sweep-inv-${tag}@test.dev`, role: 'business', tokenHash: createHash('sha256').update(tag).digest('hex'), invitedById: userB.id } });
    const storage = h.app.get(StorageService);
    const mediaKey = await storage.save(projectB.id, 'frame.png', PNG_1X1);
    Object.assign(B, { userId: userB.id, projectId: projectB.id, roundId: roundB.id, remarkId: remarkB.id, runId: runB.id, docId: docB.id, jobId: jobB.id, invitationId: invB.id, mediaKey, mediaFile: mediaKey.split('/')[1] });

    const closed = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9401, description: 'Закрытое своё', status: 'closed', closedAt: new Date(), closedByUserId: h.users.business.id } });
    closedRemarkA = closed.id;
    const upload = await h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', PNG_1X1, 'a.png').expect(201);
    keyA = upload.body.storageKey;
  });

  afterAll(async () => {
    await h.prisma.agentRun.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.remark.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.importJob.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.round.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.document.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.invitation.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.membership.deleteMany({ where: { projectId: B.projectId } });
    await h.prisma.project.delete({ where: { id: B.projectId } });
    await h.prisma.user.delete({ where: { id: B.userId } });
    await unlink(join(h.app.get(StorageService).root, B.mediaKey)).catch(() => null);
    await h.cleanup();
  });

  const call = (p: Probe) => {
    const req = h.http[p.method](`/api/v1/projects${p.path}`).set(h.auth(p.as ?? 'pm'));
    return p.body ? req.send(p.body) : req;
  };

  /** Все проектные маршруты с путём чужого проекта: MembershipGuard отвечает 404 до ролей и валидации. */
  function foreignProjectProbes(): Probe[] {
    const P = `/${B.projectId}`;
    return [
      { name: 'проект', method: 'get', path: P },
      { name: 'mcp-token', method: 'post', path: `${P}/mcp-token` },
      { name: 'участники', method: 'get', path: `${P}/members` },
      { name: 'добавить участника', method: 'post', path: `${P}/members`, body: { email: 'x@test.dev', role: 'business' } },
      { name: 'роль участника', method: 'patch', path: `${P}/members/${B.userId}`, body: { role: 'developer' } },
      { name: 'удалить участника', method: 'delete', path: `${P}/members/${B.userId}` },
      { name: 'отозвать приглашение', method: 'delete', path: `${P}/invitations/${B.invitationId}` },
      { name: 'новая ссылка', method: 'post', path: `${P}/invitations/${B.invitationId}/link` },
      { name: 'документы', method: 'get', path: `${P}/documents` },
      { name: 'документ', method: 'get', path: `${P}/documents/${B.docId}` },
      { name: 'переиндексация', method: 'post', path: `${P}/documents/${B.docId}/reindex` },
      { name: 'поиск', method: 'get', path: `${P}/search?q=кнопка` },
      { name: 'раунды', method: 'get', path: `${P}/rounds` },
      { name: 'новый раунд', method: 'post', path: `${P}/rounds` },
      { name: 'закрыть раунд', method: 'post', path: `${P}/rounds/${B.roundId}/close` },
      { name: 'открыть раунд', method: 'post', path: `${P}/rounds/${B.roundId}/reopen` },
      { name: 'выгрузка', method: 'get', path: `${P}/rounds/${B.roundId}/export.xlsx` },
      { name: 'журнал раунда', method: 'get', path: `${P}/rounds/${B.roundId}/remarks` },
      { name: 'новое замечание', method: 'post', path: `${P}/rounds/${B.roundId}/remarks`, body: { description: 'x' } },
      { name: 'очередь разработчика', method: 'get', path: `${P}/dev-queue`, as: 'developer' },
      { name: 'советы', method: 'get', path: `${P}/advisory-queue`, as: 'developer' },
      { name: 'карточка', method: 'get', path: `${P}/remarks/${B.remarkId}` },
      { name: 'история', method: 'get', path: `${P}/remarks/${B.remarkId}/history` },
      { name: 'совет', method: 'put', path: `${P}/remarks/${B.remarkId}/advice`, as: 'developer', body: { code: 'defect' } },
      { name: 'снять совет', method: 'delete', path: `${P}/remarks/${B.remarkId}/advice`, as: 'developer' },
      { name: 'повтор претензии', method: 'post', path: `${P}/remarks/${B.remarkId}/reopen`, as: 'business', body: { roundId: B.roundId } },
      { name: 'дописать строку', method: 'post', path: `${P}/remarks/${B.remarkId}/fix-row`, body: { description: 'x' } },
      { name: 'разбор', method: 'post', path: `${P}/remarks/${B.remarkId}/triage` },
      { name: 'вердикт', method: 'post', path: `${P}/remarks/${B.remarkId}/verdict`, body: { runId: B.runId, verdict: 'defect', idempotencyKey: randomUUID() } },
      { name: 'отмена', method: 'post', path: `${P}/remarks/${B.remarkId}/cancel`, body: { runId: B.runId, idempotencyKey: randomUUID() } },
      { name: 'повтор', method: 'post', path: `${P}/remarks/${B.remarkId}/link-duplicate`, body: { duplicateOfNumber: 1 } },
      { name: 'скрин', method: 'post', path: `${P}/remarks/${B.remarkId}/screenshot`, body: { screenshotKey: B.mediaKey } },
      { name: 'готово', method: 'post', path: `${P}/remarks/${B.remarkId}/ready-for-retest`, as: 'developer' },
      { name: 'ретест', method: 'post', path: `${P}/remarks/${B.remarkId}/retest`, as: 'business', body: { screenshotKey: B.mediaKey } },
      { name: 'закрыть', method: 'post', path: `${P}/remarks/${B.remarkId}/close`, as: 'business' },
      { name: 'не исправлено', method: 'post', path: `${P}/remarks/${B.remarkId}/not-fixed`, as: 'business' },
      { name: 'импорт: шаблон xlsx', method: 'get', path: `${P}/imports/template.xlsx` },
      { name: 'импорт: статус', method: 'get', path: `${P}/imports/${B.jobId}` },
      { name: 'кадр', method: 'get', path: `${P}/media/${B.mediaFile}` },
    ];
  }

  /** Свой проект в пути, чужой ресурс в параметрах: сервис ищет `WHERE projectId = свой` и отвечает 404. */
  function foreignResourceProbes(): Probe[] {
    const P = `/${h.projectId}`;
    return [
      { name: 'роль чужого участника', method: 'patch', path: `${P}/members/${B.userId}`, body: { role: 'developer' } },
      { name: 'удалить чужого участника', method: 'delete', path: `${P}/members/${B.userId}` },
      { name: 'отозвать чужое приглашение', method: 'delete', path: `${P}/invitations/${B.invitationId}` },
      { name: 'ссылка чужого приглашения', method: 'post', path: `${P}/invitations/${B.invitationId}/link` },
      { name: 'чужой документ', method: 'get', path: `${P}/documents/${B.docId}` },
      { name: 'переиндексация чужого', method: 'post', path: `${P}/documents/${B.docId}/reindex` },
      { name: 'закрыть чужой раунд', method: 'post', path: `${P}/rounds/${B.roundId}/close` },
      { name: 'открыть чужой раунд', method: 'post', path: `${P}/rounds/${B.roundId}/reopen` },
      { name: 'выгрузка чужого раунда', method: 'get', path: `${P}/rounds/${B.roundId}/export.xlsx` },
      { name: 'журнал чужого раунда', method: 'get', path: `${P}/rounds/${B.roundId}/remarks` },
      { name: 'замечание в чужой раунд', method: 'post', path: `${P}/rounds/${B.roundId}/remarks`, as: 'business', body: { description: 'x' } },
      { name: 'чужая карточка', method: 'get', path: `${P}/remarks/${B.remarkId}` },
      { name: 'чужая история', method: 'get', path: `${P}/remarks/${B.remarkId}/history` },
      { name: 'совет по чужой', method: 'put', path: `${P}/remarks/${B.remarkId}/advice`, as: 'developer', body: { code: 'defect' } },
      { name: 'снять совет по чужой', method: 'delete', path: `${P}/remarks/${B.remarkId}/advice`, as: 'developer' },
      { name: 'повтор чужой претензии', method: 'post', path: `${P}/remarks/${B.remarkId}/reopen`, as: 'business', body: { roundId: h.roundId } },
      { name: 'повтор своей в чужой раунд', method: 'post', path: `${P}/remarks/${closedRemarkA}/reopen`, as: 'business', body: { roundId: B.roundId } },
      { name: 'дописать чужую строку', method: 'post', path: `${P}/remarks/${B.remarkId}/fix-row`, body: { description: 'x' } },
      { name: 'разбор чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/triage` },
      { name: 'вердикт по чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/verdict`, body: { runId: B.runId, verdict: 'defect', idempotencyKey: randomUUID() } },
      { name: 'отмена чужого прогона', method: 'post', path: `${P}/remarks/${B.remarkId}/cancel`, body: { runId: B.runId, idempotencyKey: randomUUID() } },
      { name: 'повтор чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/link-duplicate`, body: { duplicateOfNumber: 1 } },
      { name: 'скрин к чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/screenshot`, body: { screenshotKey: keyA } },
      { name: 'готово по чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/ready-for-retest`, as: 'developer' },
      { name: 'ретест чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/retest`, as: 'business', body: { screenshotKey: keyA } },
      { name: 'закрыть чужую', method: 'post', path: `${P}/remarks/${B.remarkId}/close`, as: 'business' },
      { name: 'не исправлено по чужой', method: 'post', path: `${P}/remarks/${B.remarkId}/not-fixed`, as: 'business' },
      { name: 'чужой импорт', method: 'get', path: `${P}/imports/${B.jobId}` },
      { name: 'чужой кадр по имени файла', method: 'get', path: `${P}/media/${B.mediaFile}` },
      // Ключ кадра чужого проекта в теле: не 404, а 422 «кадр не из этого проекта» — ещё до записи
      { name: 'чужой ключ кадра в новом замечании', method: 'post', path: `${P}/rounds/${h.roundId}/remarks`, as: 'business', body: { description: 'x', screenshotKey: B.mediaKey }, expect: 422 },
    ];
  }

  it('путь чужого проекта: каждый маршрут — 404, независимо от роли', async () => {
    const failures: string[] = [];
    for (const p of foreignProjectProbes()) {
      const res = await call(p);
      if (res.status !== 404) failures.push(`${p.name}: ${p.method.toUpperCase()} ${p.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('свой проект, чужой ресурс: каждый маршрут — 404 (чужой ключ кадра — 422)', async () => {
    const failures: string[] = [];
    for (const p of foreignResourceProbes()) {
      const res = await call(p);
      if (res.status !== (p.expect ?? 404)) failures.push(`${p.name}: ${p.method.toUpperCase()} ${p.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
    // Ничего чужого не изменилось
    const remark = await h.prisma.remark.findUniqueOrThrow({ where: { id: B.remarkId } });
    expect(remark.status).toBe('awaiting_pm');
    expect(await h.prisma.remark.count({ where: { roundId: B.roundId } })).toBe(1);
  });

  it('внешние ключи: замечание в раунде чужого проекта, прогон и чанк несуществующего проекта, вердикт без прогона — не записываются', async () => {
    const fk = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'P2003' });
    await fk(h.prisma.remark.create({ data: { projectId: h.projectId, roundId: B.roundId, number: 9402, description: 'мимо сервиса' } }));
    await fk(h.prisma.remark.create({ data: { projectId: randomUUID(), roundId: h.roundId, number: 9403, description: 'нет проекта' } }));
    await fk(h.prisma.agentRun.create({ data: { remarkId: B.remarkId, projectId: randomUUID(), status: 'running', mode: 'triage' } }));
    await fk(h.prisma.documentChunk.create({ data: { projectId: randomUUID(), documentId: B.docId, content: 'x' } }));
    await fk(h.prisma.importJob.create({ data: { projectId: h.projectId, roundId: B.roundId, fileName: 'x.csv', storageKey: 'x' } }));
    await fk(h.prisma.humanVerdict.create({ data: { remarkId: B.remarkId, runId: randomUUID(), userId: h.users.pm.id, code: 'defect', idempotencyKey: randomUUID() } }));
    await fk(h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9404, description: 'автор-призрак', authorId: randomUUID() } }));
  });
});
