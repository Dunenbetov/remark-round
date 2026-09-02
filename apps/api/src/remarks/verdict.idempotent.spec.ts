/** verdict.idempotent.spec — двойной approve с тем же ключом даёт один HumanVerdict. */
import { randomUUID } from 'node:crypto';
import { createHarness, Harness } from '../../test/harness';

describe('verdict idempotency', () => {
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
  });

  afterAll(() => h.cleanup());

  it('повтор с тем же idempotencyKey: тот же результат, второго вердикта нет', async () => {
    const key = randomUUID();
    const body = { verdict: 'defect', comment: 'Тост — дефект по протоколу', runId, idempotencyKey: key };
    const first = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`).set(h.auth('pm')).send(body).expect(200);
    const second = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`).set(h.auth('pm')).send(body).expect(200);
    expect(first.body.status).toBe('defect');
    expect(second.body.status).toBe('defect');
    expect(second.body.verdict.at).toBe(first.body.verdict.at);

    const verdicts = await h.prisma.humanVerdict.findMany({ where: { remarkId } });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.comment).toBe('Тост — дефект по протоколу');
  });

  it('другой ключ после решения — уже нелегальный переход, 409, вердикт не дублируется', async () => {
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'change_request', runId, idempotencyKey: randomUUID() })
      .expect(409);
    expect(await h.prisma.humanVerdict.count({ where: { remarkId } })).toBe(1);
  });

  it('runId чужого прогона — 409', async () => {
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'defect', runId: randomUUID(), idempotencyKey: randomUUID() })
      .expect(409);
  });
});
