/**
 * Общий стенд для e2e-тестов: приложение с фейковыми эмбеддингами, два пользователя
 * (pm и business) и разработчик в одном проекте, раунд и проиндексированное ТЗ из fixtures.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type RemarkStatus, type Role } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { DocumentsService } from '../src/documents/documents.service';
import { EmbeddingsService } from '../src/llm/embeddings.service';
import { LlmService } from '../src/llm/llm.service';
import { MAIL_TRANSPORT } from '../src/mail/mail.transport';
import { validationPipe } from '../src/main';
import { RagService } from '../src/rag/rag.service';
import { FakeEmbeddingsService } from './fake-embeddings';
import { FakeLlmService } from './fake-llm';
import { FakeMailTransport } from './fake-mail';

export const TZ = readFileSync(resolve(__dirname, '../../../fixtures/spec/TZ.md'));
export const PROTOCOL = readFileSync(resolve(__dirname, '../../../fixtures/protocol/PROTOCOL.md'));
export const PASSWORD = 'secret-3';

export interface Harness {
  app: INestApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaClient;
  projectId: string;
  roundId: string;
  users: Record<Role, { id: string; email: string; token: string }>;
  auth: (role: Role) => Record<string, string>;
  /** Подменённый LLM графа: правила + ручки для тестов ворот. */
  llm: FakeLlmService;
  /** Почта в памяти: письма очереди `send_mail` и `notify_digest` (ADR 009). */
  mail: FakeMailTransport;
  /**
   * Разбор идёт в фоне (фазы — по WS): тест ждёт нужный статус, как клиент ждёт `run.persisted`.
   * Возвращает карточку в этом статусе.
   */
  waitFor: (remarkId: string, statuses: RemarkStatus[], role?: Role, timeoutMs?: number) => Promise<Record<string, any>>;
  cleanup: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const llm = new FakeLlmService();
  const mail = new FakeMailTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmbeddingsService)
    .useValue(new FakeEmbeddingsService())
    .overrideProvider(LlmService)
    .useValue(llm)
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe());
  await app.init();
  const http = request(app.getHttpServer());
  const prisma = new PrismaClient();
  const tag = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword(PASSWORD);

  const project = await prisma.project.create({ data: { name: `H-${tag}`, slug: `h-${tag}` } });
  const round = await prisma.round.create({ data: { projectId: project.id, number: 1 } });
  const users = {} as Harness['users'];
  for (const role of ['pm', 'business', 'developer', 'admin'] as Role[]) {
    const user = await prisma.user.create({ data: { email: `${role}-${tag}@test.dev`, name: role, passwordHash, preferredRole: role === 'admin' ? null : role } });
    await prisma.membership.create({ data: { userId: user.id, projectId: project.id, role } });
    const login = await http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    users[role] = { id: user.id, email: user.email, token: login.body.accessToken };
  }

  const documents = app.get(DocumentsService);
  const rag = app.get(RagService);
  const ctx = { userId: users.pm.id, projectId: project.id, role: 'pm' as Role };
  const spec = await documents.upload(ctx, { kind: 'spec', fileName: 'TZ.md', data: TZ, effectiveAt: new Date('2026-01-14') }, { indexInBackground: false });
  const protocol = await documents.upload(ctx, { kind: 'protocol', fileName: 'PROTOCOL.md', data: PROTOCOL, effectiveAt: new Date('2026-03-12') }, { indexInBackground: false });
  await rag.indexDocument(spec.id);
  await rag.indexDocument(protocol.id);

  return {
    app,
    http,
    prisma,
    projectId: project.id,
    roundId: round.id,
    users,
    auth: (role) => ({ Authorization: `Bearer ${users[role].token}` }),
    llm,
    mail,
    waitFor: async (remarkId, statuses, role = 'pm', timeoutMs = 20000) => {
      const started = Date.now();
      let last = '';
      while (Date.now() - started < timeoutMs) {
        const res = await http.get(`/api/v1/projects/${project.id}/remarks/${remarkId}`).set({ Authorization: `Bearer ${users[role].token}` });
        last = res.body.status;
        if (res.status === 200 && statuses.includes(res.body.status)) return res.body;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`waitFor ${remarkId}: ждали ${statuses.join('|')}, сейчас ${last}`);
    },
    cleanup: async () => {
      // Фоновые прогоны (импорт, triage без wait) должны дописать чекпоинты до того, как их строки исчезнут;
      // задачи очереди, которые ещё ждут (повтор с паузой), снимаем — их прогоны ниже удалятся вместе с remarks
      await prisma.job.updateMany({ where: { projectId: project.id, status: 'queued' }, data: { status: 'cancelled', finishedAt: new Date() } });
      for (let i = 0; i < 50 && (await prisma.agentRun.count({ where: { projectId: project.id, status: 'running' } })) > 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      for (let i = 0; i < 50 && (await prisma.job.count({ where: { projectId: project.id, status: 'running' } })) > 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const remarkIds = (await prisma.remark.findMany({ where: { projectId: project.id }, select: { id: true } })).map((r) => r.id);
      await prisma.developerAdvice.deleteMany({ where: { remarkId: { in: remarkIds } } });
      await prisma.humanVerdict.deleteMany({ where: { remarkId: { in: remarkIds } } });
      // Фоновый разбор (импорт, triage) мог создать AgentRun между двумя deleteMany: повторяем пару раз, пока FK не пропустит
      for (let attempt = 1; ; attempt++) {
        await prisma.agentRun.deleteMany({ where: { projectId: project.id } });
        try {
          await prisma.remark.deleteMany({ where: { projectId: project.id } });
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2003' || attempt >= 5) throw e;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      await prisma.importJob.deleteMany({ where: { projectId: project.id } });
      await prisma.job.deleteMany({ where: { projectId: project.id } });
      await prisma.round.deleteMany({ where: { projectId: project.id } });
      await prisma.documentChunk.deleteMany({ where: { projectId: project.id } });
      await prisma.document.deleteMany({ where: { projectId: project.id } });
      await prisma.membership.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
      await prisma.$disconnect();
      await app.close();
    },
  };
}
