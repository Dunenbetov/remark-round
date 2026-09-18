import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { validationPipe } from '../main';
import { ObservabilityService } from '../observability/observability.service';

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
    // В тестах ключа модели нет — правила; HNSW-индекс на тестовой БД есть (миграции применены); трейсы выключены setup.ts
    expect(res.body).toMatchObject({ ok: true, db: 'ok', version: 'dev', llm: 'rules', vectorIndex: 'ok', tracing: 'off', sentry: 'off' });
    expect(typeof res.body.jobs.queued).toBe('number');
    expect(typeof res.body.jobs.running).toBe('number');
  });

  it('tracing — не «ключи заданы», а доезжают ли span\'ы: degraded, если провайдер Langfuse не наш', async () => {
    // Сам расчёт статуса при настоящем Sentry — в observability-sentry.spec; здесь — что /health его отдаёт
    const status = jest.spyOn(app.get(ObservabilityService), 'tracingStatus').mockReturnValue('degraded');
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.tracing).toBe('degraded');
    status.mockRestore();
  });
});
