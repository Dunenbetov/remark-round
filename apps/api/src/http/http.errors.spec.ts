/**
 * http.errors.spec — аудит: no-error-contract-filter, logs-unstructured. Любая ошибка API приходит в одном виде:
 * { statusCode, code, message, requestId }; X-Request-Id принимается от прокси или генерируется и возвращается;
 * ошибки Prisma не текут наружу SQL-подробностями; сбой прогона несёт человеческую причину.
 */
import { Prisma } from '@remarkround/db';
import { createHarness, type Harness } from '../../test/harness';
import { classifyRunError } from '../agent/agent.service';
import { errorBody } from './http-exception.filter';

describe('http error contract', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('404 чужого проекта: code, message и requestId; X-Request-Id из запроса возвращается как есть', async () => {
    const res = await h.http.get('/api/v1/projects/00000000-0000-4000-8000-000000000000').set(h.auth('pm')).set('X-Request-Id', 'proxy-abc-12345').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'not_found', requestId: 'proxy-abc-12345' });
    expect(res.headers['x-request-id']).toBe('proxy-abc-12345');
  });

  it('без X-Request-Id сервер генерирует свой и кладёт в заголовок и в тело; подозрительный заголовок заменяется', async () => {
    const res = await h.http.post('/api/v1/auth/login').send({ email: 'nobody@test.dev', password: 'x' }).set('X-Request-Id', '<script>').expect(401);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'unauthorized', requestId: res.headers['x-request-id'] });
  });

  it('422 валидации сохраняет список сообщений class-validator, 409 — текст сервиса', async () => {
    const bad = await h.http.post('/api/v1/auth/register').send({ name: '', email: 'x', password: '1', preferredRole: 'pm' }).expect(422);
    expect(bad.body.code).toBe('unprocessable');
    expect(Array.isArray(bad.body.message)).toBe(true);
    const dup = await h.http.post('/api/v1/auth/register').send({ name: 'Дубль', email: h.users.pm.email, password: 'secret-12', preferredRole: 'pm' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'conflict', message: 'Этот e-mail уже зарегистрирован' });
  });

  it('/health при 503 сохраняет свои поля поверх контракта (сериализация фильтром)', async () => {
    const ok = await h.http.get('/api/v1/health').expect(200);
    expect(ok.body).toMatchObject({ ok: true, db: 'ok' });
  });

  it('ошибки Prisma: пул исчерпан и база недоступна — 503 unavailable, конфликт — 409, нет строки — 404 (R-H1)', () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });
    expect(errorBody(known('P2024'), 'r1')).toMatchObject({ statusCode: 503, code: 'unavailable', requestId: 'r1' });
    expect(errorBody(known('P1001'))).toMatchObject({ statusCode: 503, code: 'unavailable' });
    expect(errorBody(new Prisma.PrismaClientInitializationError('down', 'test'))).toMatchObject({ statusCode: 503, code: 'unavailable' });
    expect(errorBody(known('P2002'))).toMatchObject({ statusCode: 409, code: 'conflict' });
    expect(errorBody(known('P2025'))).toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(errorBody(new Error('boom'))).toMatchObject({ statusCode: 500, code: 'internal' });
    expect(JSON.stringify(errorBody(known('P2024')))).not.toMatch(/P2024|clientVersion/);
  });

  it('classifyRunError: ошибки модели получают код и человеческий текст', () => {
    expect(classifyRunError(Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' })).code).toBe('llm_timeout');
    expect(classifyRunError(Object.assign(new Error('429'), { status: 429 }))).toMatchObject({ code: 'llm_rate_limit' });
    expect(classifyRunError(Object.assign(new Error('401'), { status: 401 })).message).toMatch(/Ключ/);
    expect(classifyRunError(Object.assign(new Error('502'), { status: 502 })).code).toBe('llm_unavailable');
    expect(classifyRunError(new Error('storage: ключ вне корня')).code).toBe('storage');
    expect(classifyRunError(new Error('что-то ещё')).code).toBe('unknown');
  });
});
