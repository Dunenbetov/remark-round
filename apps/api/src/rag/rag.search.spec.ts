/**
 * rag.search.spec — DoD фазы 2 без сети: вопрос «какого цвета primary-кнопка?»
 * возвращает §2.1 из fixtures/spec, а чанки чужого проекта не видны.
 * Эмбеддинги подменены детерминированным мешком слов (test/fake-embeddings.ts).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@remarkround/db';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { FakeEmbeddingsService } from '../../test/fake-embeddings';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password';
import { DocumentsService } from '../documents/documents.service';
import { EmbeddingsService } from '../llm/embeddings.service';
import { validationPipe } from '../main';
import type { ProjectContext } from '../tenancy/project-context';
import { RagService } from './rag.service';

const TZ = readFileSync(resolve(__dirname, '../../../../fixtures/spec/TZ.md'));
const PROTOCOL = readFileSync(resolve(__dirname, '../../../../fixtures/protocol/PROTOCOL.md'));
const PASSWORD = 'secret-2';

describe('rag search', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let rag: RagService;
  let documents: DocumentsService;
  const prisma = new PrismaClient();
  const tag = randomUUID().slice(0, 8);
  const ids = { userA: '', userB: '', projectA: '', projectB: '', docA: '', docB: '' };
  let tokenA = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingsService)
      .useValue(new FakeEmbeddingsService())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(validationPipe());
    await app.init();
    http = request(app.getHttpServer());
    rag = app.get(RagService);
    documents = app.get(DocumentsService);

    const passwordHash = await hashPassword(PASSWORD);
    const userA = await prisma.user.create({ data: { email: `rag-a-${tag}@test.dev`, name: 'A', passwordHash } });
    const userB = await prisma.user.create({ data: { email: `rag-b-${tag}@test.dev`, name: 'B', passwordHash } });
    const projectA = await prisma.project.create({ data: { name: `RAG-A-${tag}`, memberships: { create: { userId: userA.id, role: 'pm' } } } });
    const projectB = await prisma.project.create({ data: { name: `RAG-B-${tag}`, memberships: { create: { userId: userB.id, role: 'pm' } } } });
    Object.assign(ids, { userA: userA.id, userB: userB.id, projectA: projectA.id, projectB: projectB.id });

    const ctxA: ProjectContext = { userId: userA.id, projectId: projectA.id, role: 'pm' };
    const ctxB: ProjectContext = { userId: userB.id, projectId: projectB.id, role: 'pm' };
    const docA = await documents.upload(ctxA, { kind: 'spec', fileName: 'TZ.md', data: TZ }, { indexInBackground: false });
    const docB = await documents.upload(ctxB, { kind: 'protocol', fileName: 'PROTOCOL.md', data: PROTOCOL }, { indexInBackground: false });
    ids.docA = docA.id;
    ids.docB = docB.id;
    await rag.indexDocument(docA.id);
    await rag.indexDocument(docB.id);

    const login = await http.post('/api/v1/auth/login').send({ email: userA.email, password: PASSWORD }).expect(200);
    tokenA = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.documentChunk.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await prisma.document.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await prisma.membership.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await prisma.project.deleteMany({ where: { id: { in: [ids.projectA, ids.projectB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('документ проиндексирован: статус indexed, чанки по разделам', async () => {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: ids.docA } });
    expect(doc.status).toBe('indexed');
    const sections = (await prisma.documentChunk.findMany({ where: { documentId: ids.docA } })).map((c) => c.section);
    expect(sections).toEqual(expect.arrayContaining(['§2.1 Primary', '§4.2 Ошибки']));
  });

  it('«какого цвета primary-кнопка?» → §2.1 с цитатой', async () => {
    const res = await http
      .get(`/api/v1/projects/${ids.projectA}/search`)
      .query({ q: 'какого цвета primary-кнопка?', k: 3 })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const top = res.body.hits[0];
    expect(top.section).toBe('§2.1 Primary');
    expect(top.content).toContain('#0B5FFF');
    expect(top.documentTitle).toBe('TZ.md');
    expect(top.score).toBeGreaterThan(0);
  });

  it('чужие чанки не попадают в выдачу даже при точном совпадении слов', async () => {
    const ctxA: ProjectContext = { userId: ids.userA, projectId: ids.projectA, role: 'pm' };
    const hits = await rag.search(ctxA, 'протокол согласования пустая иллюстрация вне скоупа', 10);
    expect(hits.every((h) => h.documentId === ids.docA)).toBe(true);
    expect(hits.some((h) => h.documentId === ids.docB)).toBe(false);
  });

  it('поиск по чужому projectId — 404', async () => {
    await http.get(`/api/v1/projects/${ids.projectB}/search`).query({ q: 'primary' }).set('Authorization', `Bearer ${tokenA}`).expect(404);
  });

  it('загрузка через multipart создаёт документ и отдаёт 201', async () => {
    const res = await http
      .post(`/api/v1/projects/${ids.projectA}/documents`)
      .set('Authorization', `Bearer ${tokenA}`)
      .field('kind', 'addendum')
      .attach('file', PROTOCOL, 'Протокол_12.03.md')
      .expect(201);
    expect(res.body.title).toBe('Протокол_12.03.md');
    expect(res.body.kind).toBe('addendum');
    // индексация в фоне: дождёмся статуса
    for (let i = 0; i < 20; i++) {
      const d = await prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
      if (d.status === 'indexed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const list = await http.get(`/api/v1/projects/${ids.projectA}/documents`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    const added = list.body.find((d: { id: string }) => d.id === res.body.id);
    expect(added.status).toBe('indexed');
    expect(added.chunks).toBeGreaterThan(0);
  });

  it('большое ТЗ на 2 000 разделов индексируется одной транзакцией пачками (R-B3), а не по чанку', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `## ${i + 1}. Раздел ${i + 1}\n\nЭкран ${i + 1}: кнопка «Действие ${i + 1}» стоит справа и подписана номером ${i + 1}.\n`).join('\n');
    const ctxA: ProjectContext = { userId: ids.userA, projectId: ids.projectA, role: 'pm' };
    const doc = await documents.upload(ctxA, { kind: 'addendum', fileName: 'big.md', data: Buffer.from(big) }, { indexInBackground: false });
    const started = Date.now();
    const result = await rag.indexDocument(doc.id);
    const elapsed = Date.now() - started;
    expect(result.chunks).toBeGreaterThanOrEqual(2000);
    expect(await prisma.documentChunk.count({ where: { documentId: doc.id } })).toBe(result.chunks);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('indexed');
    // По одному INSERT это не укладывалось в 5-секундный дефолт транзакции; пачками — секунды даже на CI
    expect(elapsed).toBeLessThan(15_000);
    // Переиндексация заменяет чанки, а не дублирует
    await rag.indexDocument(doc.id);
    expect(await prisma.documentChunk.count({ where: { documentId: doc.id } })).toBe(result.chunks);
  }, 60_000);

  it('неподдерживаемый формат — 422', async () => {
    await http
      .post(`/api/v1/projects/${ids.projectA}/documents`)
      .set('Authorization', `Bearer ${tokenA}`)
      .field('kind', 'spec')
      .attach('file', Buffer.from('x'), 'archive.zip')
      .expect(422);
  });
});
