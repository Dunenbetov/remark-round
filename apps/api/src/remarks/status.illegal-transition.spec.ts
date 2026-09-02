/** status.illegal-transition.spec — developer не закрывает, статусы ходят только по docs/STATUS.md. */
import { randomUUID } from 'node:crypto';
import { createHarness, Harness } from '../../test/harness';

describe('status transitions', () => {
  let h: Harness;
  let remarkId = '';
  let runId = '';

  beforeAll(async () => {
    h = await createHarness();
    const created = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description: 'Кнопка Сохранить серая с заливкой', expected: 'По ТЗ primary синяя Сохранить', pageOrScreen: 'Профиль / Сохранить' })
      .expect(201);
    remarkId = created.body.id;
    runId = created.body.runId;
  });

  afterAll(() => h.cleanup());

  it('новое замечание сразу разобрано и ждёт PM', async () => {
    const res = await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${remarkId}`).set(h.auth('pm')).expect(200);
    expect(res.body.status).toBe('awaiting_pm');
    expect(res.body.number).toBe(1);
    expect(runId).toBeTruthy();
  });

  it('разработчик не видит awaiting_pm ни в очереди, ни по прямой ссылке', async () => {
    const queue = await h.http.get(`/api/v1/projects/${h.projectId}/dev-queue`).set(h.auth('developer')).expect(200);
    expect(queue.body).toEqual([]);
    await h.http.get(`/api/v1/projects/${h.projectId}/remarks/${remarkId}`).set(h.auth('developer')).expect(404);
  });

  it('закрыть из awaiting_pm нельзя даже бизнесу — 409', async () => {
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('business')).expect(409);
  });

  it('ready-for-retest до вердикта — 409, а от PM — 403 по роли', async () => {
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/ready-for-retest`).set(h.auth('developer')).expect(409);
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/ready-for-retest`).set(h.auth('pm')).expect(403);
  });

  it('бизнес не ставит вердикт из awaiting_pm — 403', async () => {
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`)
      .set(h.auth('business'))
      .send({ verdict: 'defect', runId, idempotencyKey: randomUUID() })
      .expect(403);
  });

  it('полный законный путь: defect → ready_for_retest → awaiting_business_close → closed', async () => {
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'defect', runId, idempotencyKey: randomUUID() })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('defect'));

    const queue = await h.http.get(`/api/v1/projects/${h.projectId}/dev-queue`).set(h.auth('developer')).expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toEqual([remarkId]);

    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/ready-for-retest`).set(h.auth('developer')).expect(200);

    // developer и pm закрыть не могут — 403 по роли
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('developer')).expect(403);
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('pm')).expect(403);

    // бизнес закрывает только после нового кадра
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('business')).expect(409);
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/retest`)
      .set(h.auth('business'))
      .send({ screenshotKey: `${h.projectId}/${randomUUID()}.svg` })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('awaiting_business_close'));
    const closed = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('business')).expect(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.closedByUserId).toBe(h.users.business.id);
  });

  it('из closed нельзя ни в ретест, ни закрыть снова — 409', async () => {
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/close`).set(h.auth('business')).expect(409);
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${remarkId}/ready-for-retest`).set(h.auth('developer')).expect(409);
  });
});
