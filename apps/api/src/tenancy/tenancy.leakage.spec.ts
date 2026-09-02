/**
 * tenancy.leakage.spec — DoD фазы 1: два проекта, пользователь A не читает документы B.
 * Нужен живой Postgres: DATABASE_URL (например, compose-postgres на 5434).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@remarkround/db';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password';
import { validationPipe } from '../main';

const PASSWORD = 'secret-1';

describe('tenancy leakage', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const prisma = new PrismaClient();
  const tag = randomUUID().slice(0, 8);

  const ids = {
    userA: '',
    userB: '',
    projectA: '',
    projectB: '',
    docA: '',
    docB: '',
  };
  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(validationPipe());
    await app.init();
    http = request(app.getHttpServer());

    const passwordHash = hashPassword(PASSWORD);
    const userA = await prisma.user.create({ data: { email: `a-${tag}@test.dev`, name: 'A', passwordHash } });
    const userB = await prisma.user.create({ data: { email: `b-${tag}@test.dev`, name: 'B', passwordHash } });
    const projectA = await prisma.project.create({ data: { name: `A-${tag}`, memberships: { create: { userId: userA.id, role: 'admin' } } } });
    const projectB = await prisma.project.create({ data: { name: `B-${tag}`, memberships: { create: { userId: userB.id, role: 'pm' } } } });
    const docA = await prisma.document.create({ data: { projectId: projectA.id, kind: 'spec', title: 'A.pdf', mime: 'application/pdf', storageKey: `t/${tag}/a` } });
    const docB = await prisma.document.create({ data: { projectId: projectB.id, kind: 'spec', title: 'B.pdf', mime: 'application/pdf', storageKey: `t/${tag}/b` } });
    Object.assign(ids, { userA: userA.id, userB: userB.id, projectA: projectA.id, projectB: projectB.id, docA: docA.id, docB: docB.id });

    const loginA = await http.post('/api/v1/auth/login').send({ email: userA.email, password: PASSWORD }).expect(200);
    const loginB = await http.post('/api/v1/auth/login').send({ email: userB.email, password: PASSWORD }).expect(200);
    tokenA = loginA.body.accessToken;
    tokenB = loginB.body.accessToken;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await prisma.membership.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await prisma.project.deleteMany({ where: { id: { in: [ids.projectA, ids.projectB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  const asA = (): Record<string, string> => ({ Authorization: `Bearer ${tokenA}` });
  const asB = (): Record<string, string> => ({ Authorization: `Bearer ${tokenB}` });

  it('без токена — 401, с чужим — 401', async () => {
    await http.get('/api/v1/projects').expect(401);
    await http.get('/api/v1/projects').set('Authorization', 'Bearer not-a-token').expect(401);
  });

  it('неверный пароль — 401 без подсказки', async () => {
    await http.post('/api/v1/auth/login').send({ email: `a-${tag}@test.dev`, password: 'wrong' }).expect(401);
  });

  it('GET /projects показывает только свои membership', async () => {
    const res = await http.get('/api/v1/projects').set(asA()).expect(200);
    const idsSeen = res.body.map((p: { id: string }) => p.id);
    expect(idsSeen).toContain(ids.projectA);
    expect(idsSeen).not.toContain(ids.projectB);
  });

  it('чужой проект выглядит как 404', async () => {
    await http.get(`/api/v1/projects/${ids.projectB}`).set(asA()).expect(404);
    await http.get(`/api/v1/projects/${ids.projectB}/documents`).set(asA()).expect(404);
    await http.get(`/api/v1/projects/${ids.projectB}/members`).set(asA()).expect(404);
  });

  it('документ B недоступен A ни через свой, ни через чужой projectId', async () => {
    await http.get(`/api/v1/projects/${ids.projectA}/documents/${ids.docB}`).set(asA()).expect(404);
    await http.get(`/api/v1/projects/${ids.projectB}/documents/${ids.docB}`).set(asA()).expect(404);
  });

  it('A видит только свои документы, B — свои', async () => {
    const listA = await http.get(`/api/v1/projects/${ids.projectA}/documents`).set(asA()).expect(200);
    expect(listA.body.map((d: { id: string }) => d.id)).toEqual([ids.docA]);

    const docB = await http.get(`/api/v1/projects/${ids.projectB}/documents/${ids.docB}`).set(asB()).expect(200);
    expect(docB.body.title).toBe('B.pdf');
  });

  it('роль проверяется после membership: pm не читает список участников (403)', async () => {
    await http.get(`/api/v1/projects/${ids.projectB}/members`).set(asB()).expect(403);
    await http.get(`/api/v1/projects/${ids.projectA}/members`).set(asA()).expect(200);
  });

  it('валидация тела — 422', async () => {
    await http.post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' }).expect(422);
  });
});
