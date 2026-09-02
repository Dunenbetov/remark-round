/**
 * Общий стенд для e2e-тестов: приложение с фейковыми эмбеддингами, два пользователя
 * (pm и business) и разработчик в одном проекте, раунд и проиндексированное ТЗ из fixtures.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type Role } from '@remarkround/db';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { DocumentsService } from '../src/documents/documents.service';
import { EmbeddingsService } from '../src/llm/embeddings.service';
import { validationPipe } from '../src/main';
import { RagService } from '../src/rag/rag.service';
import { FakeEmbeddingsService } from './fake-embeddings';

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
  cleanup: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmbeddingsService)
    .useValue(new FakeEmbeddingsService())
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe());
  await app.init();
  const http = request(app.getHttpServer());
  const prisma = new PrismaClient();
  const tag = randomUUID().slice(0, 8);
  const passwordHash = hashPassword(PASSWORD);

  const project = await prisma.project.create({ data: { name: `H-${tag}` } });
  const round = await prisma.round.create({ data: { projectId: project.id, number: 1 } });
  const users = {} as Harness['users'];
  for (const role of ['pm', 'business', 'developer', 'admin'] as Role[]) {
    const user = await prisma.user.create({ data: { email: `${role}-${tag}@test.dev`, name: role, passwordHash } });
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
    cleanup: async () => {
      const remarkIds = (await prisma.remark.findMany({ where: { projectId: project.id }, select: { id: true } })).map((r) => r.id);
      await prisma.humanVerdict.deleteMany({ where: { remarkId: { in: remarkIds } } });
      await prisma.agentRun.deleteMany({ where: { projectId: project.id } });
      await prisma.remark.deleteMany({ where: { projectId: project.id } });
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
