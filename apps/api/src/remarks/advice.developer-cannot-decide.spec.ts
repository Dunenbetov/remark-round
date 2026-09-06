/**
 * advice.developer-cannot-decide.spec — совет разработчика по замечанию в awaiting_pm: PM его видит,
 * статус не меняется, решение остаётся за PM. Разработчик читает такие карточки, но в его журнале и очереди их нет.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, Harness } from '../../test/harness';

describe('developer advice', () => {
  let h: Harness;
  let remarkId = '';
  let runId = '';

  beforeAll(async () => {
    h = await createHarness();
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Ошибка 500 показывается тостом сверху', expected: 'Ошибка под полем красным', pageOrScreen: 'Оплата' })
      .expect(201);
    remarkId = created.body.id;
    runId = created.body.runId;
    await h.waitFor(remarkId, ['awaiting_pm']);
  });

  afterAll(() => h.cleanup());

  const url = () => `/api/v1/projects/${h.projectId}/remarks/${remarkId}/advice`;

  it('разработчик видит awaiting_pm в advisory-queue и по id, но не в журнале раунда и не в dev-queue', async () => {
    const queue = await h.http.get(`/api/v1/projects/${h.projectId}/advisory-queue`).set(h.auth('developer')).expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toContain(remarkId);
    expect(queue.body.every((r: { status: string }) => r.status === 'awaiting_pm')).toBe(true);
    const one = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${remarkId}`).set(h.auth('developer')).expect(200);
    expect(one.body.advice).toEqual([]);
    const list = await h.http.get(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`).set(h.auth('developer')).expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).not.toContain(remarkId);
    const dev = await h.http.get(`/api/v1/projects/${h.projectId}/dev-queue`).set(h.auth('developer')).expect(200);
    expect(dev.body.map((r: { id: string }) => r.id)).not.toContain(remarkId);
    // бизнесу и PM advisory-queue не положена
    await h.http.get(`/api/v1/projects/${h.projectId}/advisory-queue`).set(h.auth('pm')).expect(403);
  });

  it('совет пишется и меняется (одна запись), статус остаётся awaiting_pm; PM видит совет с именем и ролью', async () => {
    const first = await h.http.put(url()).set(h.auth('developer')).send({ code: 'defect', comment: 'Чиню за час' }).expect(200);
    expect(first.body.status).toBe('awaiting_pm');
    expect(first.body.advice).toHaveLength(1);
    expect(first.body.advice[0]).toMatchObject({ code: 'defect', userId: h.users.developer.id, role: 'developer', comment: 'Чиню за час' });
    expect(first.body.advice[0].userName).toBe('developer');

    const second = await h.http.put(url()).set(h.auth('developer')).send({ code: 'change_request' }).expect(200);
    expect(second.body.advice).toHaveLength(1);
    expect(second.body.advice[0].code).toBe('change_request');
    expect(second.body.advice[0].comment).toBeUndefined();
    expect(await h.prisma.developerAdvice.count({ where: { remarkId } })).toBe(1);

    const pm = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${remarkId}`).set(h.auth('pm')).expect(200);
    expect(pm.body.status).toBe('awaiting_pm');
    expect(pm.body.advice[0].code).toBe('change_request');
    expect(await h.prisma.humanVerdict.count({ where: { remarkId } })).toBe(0);
  });

  it('не разработчик — 403; «Повтор» советовать нельзя — 422; снять совет — пусто', async () => {
    await h.http.put(url()).set(h.auth('pm')).send({ code: 'defect' }).expect(403);
    await h.http.put(url()).set(h.auth('business')).send({ code: 'defect' }).expect(403);
    await h.http.put(url()).set(h.auth('developer')).send({ code: 'duplicate' }).expect(422);
    const gone = await h.http.delete(url()).set(h.auth('developer')).expect(200);
    expect(gone.body.advice).toEqual([]);
    expect(gone.body.status).toBe('awaiting_pm');
  });

  it('вердикт PM после совета: совет остаётся в карточке, статус меняет только PM; совет по решённому — 409', async () => {
    await h.http.put(url()).set(h.auth('developer')).send({ code: 'defect', comment: 'Точно баг' }).expect(200);
    const decided = await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'defect', runId, idempotencyKey: randomUUID() })
      .expect(200);
    expect(decided.body.status).toBe('defect');
    expect(decided.body.advice[0]).toMatchObject({ code: 'defect', comment: 'Точно баг' });
    await h.http.put(url()).set(h.auth('developer')).send({ code: 'change_request' }).expect(409);
  });
});
