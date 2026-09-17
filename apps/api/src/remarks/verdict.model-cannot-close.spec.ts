/**
 * verdict.model-cannot-close.spec — модель (граф триажа) никогда не переводит в closed,
 * а «Не та цитата из ТЗ» продолжает тот же run и меняет цитату.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, Harness } from '../../test/harness';

describe('model cannot close', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => h.cleanup());

  it('триаж заканчивается только awaiting_pm с предложением и цитатой', async () => {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка Сохранить серая с заливкой', expected: 'По ТЗ primary синяя', pageOrScreen: 'Профиль', screenshotKey: `${h.projectId}/${randomUUID()}.svg` })
      .expect(201);
    expect(res.body.status).toBe('triaging');
    const done = await h.waitFor(res.body.id, ['awaiting_pm']);
    expect(done.proposedClass).toBe('defect_candidate');
    expect(done.citations[0].section).toBe('§2.1 Primary');
    expect(done.citations[0].heading).toBe('В ТЗ (§2.1):');
    expect(done.draft[0]).toBe('Похоже, это поломка относительно ТЗ.');
    expect(done.runId).toBe(res.body.runId);
    const runs = await h.prisma.agentRun.findMany({ where: { remarkId: res.body.id } });
    expect(runs.map((r) => r.status)).toEqual(['awaiting_human']);
  });

  it('вердикт closed невозможен как код — 422', async () => {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('pm'))
      .send({ description: 'Логотип не по центру', pageOrScreen: 'Шапка', screenshotKey: `${h.projectId}/${randomUUID()}.svg` })
      .expect(201);
    await h.waitFor(res.body.id, ['awaiting_pm']);
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${res.body.id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'closed', runId: res.body.runId, idempotencyKey: randomUUID() })
      .expect(422);
  });

  it('«Не та цитата из ТЗ» без комментария — 409, с комментарием — другая цитата, тот же run', async () => {
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Главную кнопку сделайте серой как в разделе 5', pageOrScreen: 'Профиль', screenshotKey: `${h.projectId}/${randomUUID()}.svg` })
      .expect(201);
    const first = await h.waitFor(created.body.id, ['awaiting_pm']);
    const before = first.citations[0]?.chunkId;
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${created.body.id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'rejected_binding', runId: created.body.runId, idempotencyKey: randomUUID() })
      .expect(409);
    const after = await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${created.body.id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'rejected_binding', comment: 'Смотрите раздел 5 про серую кнопку', runId: created.body.runId, idempotencyKey: randomUUID() })
      .expect(200);
    expect(after.body.status).toBe('triaging'); // тот же run продолжает цикл bind
    const rebound = await h.waitFor(created.body.id, ['awaiting_pm']);
    expect(rebound.runId).toBe(created.body.runId);
    expect(rebound.citations[0]?.chunkId).not.toBe(before);
    const runs = await h.prisma.agentRun.count({ where: { remarkId: created.body.id } });
    expect(runs).toBe(1);
  });

  it('без скрина претензия про цвет — предложение cannot_tell, не дефект', async () => {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Цвет ссылок в футере не тот', pageOrScreen: 'Все страницы, футер' })
      .expect(201);
    const done = await h.waitFor(res.body.id, ['awaiting_pm']);
    expect(done.proposedClass).toBe('cannot_tell');
  });

  it('повтор внутри раунда — предложение duplicate с номером оригинала', async () => {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка Сохранить серая с заливкой опять', pageOrScreen: 'Профиль' })
      .expect(201);
    const done = await h.waitFor(res.body.id, ['awaiting_pm']);
    expect(done.proposedClass).toBe('duplicate');
    expect(done.duplicateOfNumber).toBe(1);
  });
});
