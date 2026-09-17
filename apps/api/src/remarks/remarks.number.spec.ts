/**
 * remarks.number.spec — фаза 11: номера в раунде без дыр и дублей при параллельном создании;
 * кадр из тела запроса принимается только своего проекта.
 */
import { createHarness, type Harness } from '../../test/harness';
import { RemarksService } from './remarks.service';

describe('remark numbers and screenshot keys', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('10 параллельных строк журнала получают номера 1..10', async () => {
    const remarks = h.app.get(RemarksService);
    const ctx = { userId: h.users.business.id, projectId: h.projectId, role: 'business' as const };
    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        remarks.createImported(ctx, h.roundId, { externalId: `J-${i + 1}`, pageOrScreen: null, description: `строка ${i + 1}`, expected: null, severity: null, status: 'needs_human_parse', screenshot: null }),
      ),
    );
    expect(created.map((r) => r.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('чужой screenshotKey или выход из корня — 422, свой — принимается', async () => {
    const foreign = '22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';
    await h.http.post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`).set(h.auth('business')).send({ description: 'чужой кадр', screenshotKey: foreign }).expect(422);
    await h.http.post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`).set(h.auth('business')).send({ description: 'выход из корня', screenshotKey: `${h.projectId}/../x.png` }).expect(422);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = await h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', png, 'shot.png').expect(201);
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'свой кадр', screenshotKey: upload.body.storageKey })
      .expect(201);
    expect(res.body.screenshots?.length ?? res.body.screenshot ? 1 : 0).toBeGreaterThan(0);
    await h.waitFor(res.body.id, ['awaiting_pm', 'cannot_tell', 'unspecified', 'imported'], 'pm');
  });

  it('SVG на загрузку не принимается', async () => {
    await h.http.post(`/api/v1/projects/${h.projectId}/media`).set(h.auth('business')).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg').expect(422);
  });
});
