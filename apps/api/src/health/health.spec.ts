import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { validationPipe } from '../main';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(validationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health без токена: процесс жив и база на связи', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    // В тестах ключа модели нет — правила; HNSW-индекс на тестовой БД есть (миграции применены)
    expect(res.body).toEqual({ ok: true, db: 'ok', version: 'dev', llm: 'rules', vectorIndex: 'ok' });
  });
});
