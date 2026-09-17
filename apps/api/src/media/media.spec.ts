/**
 * media.spec — кадры: квота проекта и порог свободного места (R-H4) отдают 507 storage_full с понятным текстом,
 * отданный кадр кэшируется год (R-M7). Пороги читаются из env при каждой записи, поэтому меняются прямо в тесте.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHarness, type Harness } from '../../test/harness';
import { StorageService } from '../storage/storage.service';

const PNG = readFileSync(resolve(__dirname, '../../../../fixtures/screenshots/after-save-blue.png'));

describe('media: storage guards and cache', () => {
  let h: Harness;
  const env = { quota: process.env['STORAGE_QUOTA_MB_PER_PROJECT'], free: process.env['STORAGE_MIN_FREE_MB'] };

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    for (const [k, v] of [['STORAGE_QUOTA_MB_PER_PROJECT', env.quota], ['STORAGE_MIN_FREE_MB', env.free]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await h.cleanup();
  });

  const upload = () => h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', PNG, 'frame.png');

  it('кадр отдаётся с Cache-Control на год: ключ — UUID, файл неизменяем', async () => {
    const up = await upload().expect(201);
    const res = await h.http.get(up.body.url).set(h.auth('business')).expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('квота проекта: первый кадр в пределах — 201, следующий сверх — 507 storage_full; квоту снимаем — снова 201', async () => {
    const storage = h.app.get(StorageService);
    const used = await storage.projectUsage(h.projectId);
    // Квота: текущее + полтора кадра — один пройдёт, второй упрётся
    process.env['STORAGE_QUOTA_MB_PER_PROJECT'] = String((used + PNG.length * 1.5) / (1024 * 1024));
    await upload().expect(201);
    const full = await upload().expect(507);
    expect(full.body).toMatchObject({ statusCode: 507, code: 'storage_full' });
    expect(full.body.message).toMatch(/квоту/);
    process.env['STORAGE_QUOTA_MB_PER_PROJECT'] = '0';
    await upload().expect(201);
  });

  it('свободного места меньше порога — 507 с текстом про место, файл не пишется', async () => {
    process.env['STORAGE_MIN_FREE_MB'] = String(1024 * 1024 * 1024); // порог заведомо больше любого диска
    const full = await upload().expect(507);
    expect(full.body.message).toMatch(/кончается место/);
    delete process.env['STORAGE_MIN_FREE_MB'];
    await upload().expect(201);
  });
});
