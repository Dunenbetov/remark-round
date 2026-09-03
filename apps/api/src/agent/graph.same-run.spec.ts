/**
 * graph.same-run.spec — граф LangGraph с чекпоинтом в Postgres (фаза 6):
 * «Не та цитата» продолжает тот же AgentRun из чекпоинта; faithfulness ловит выдуманный раздел и после двух
 * циклов честно даёт cannot_tell; run.cancel не создаёт вердикт и возвращает замечание в imported.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, Harness } from '../../test/harness';

describe('graph: тот же run, циклы, cancel', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => h.cleanup());

  async function create(description: string, extra: Record<string, unknown> = {}): Promise<{ id: string; runId: string }> {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description, pageOrScreen: 'Профиль', ...extra })
      .expect(201);
    expect(res.body.status).toBe('triaging');
    expect(res.body.runStatus).toBe('running');
    return { id: res.body.id, runId: res.body.runId };
  }

  it('чекпоинты лежат в GraphCheckpoint под runId; reject_binding продолжает тот же run и меняет цитату', async () => {
    const { id, runId } = await create('Кнопка Сохранить серая с заливкой', { expected: 'По ТЗ primary синяя', screenshotKey: `${h.projectId}/${randomUUID()}.png` });
    const first = await h.waitFor(id, ['awaiting_pm']);
    expect(first.runStatus).toBe('awaiting_human');
    expect(await h.prisma.graphCheckpoint.count({ where: { runId } })).toBeGreaterThan(0);
    const before = first.citations[0]?.chunkId;
    expect(before).toBeTruthy();

    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'rejected_binding', comment: 'Смотрите раздел про ошибки', runId, idempotencyKey: randomUUID() })
      .expect(200);
    const second = await h.waitFor(id, ['awaiting_pm']);
    expect(second.runId).toBe(runId);
    expect(second.citations[0]?.chunkId).not.toBe(before);
    expect(await h.prisma.agentRun.count({ where: { remarkId: id } })).toBe(1);
    const verdicts = await h.prisma.humanVerdict.findMany({ where: { remarkId: id } });
    expect(verdicts.map((v) => v.code)).toEqual(['rejected_binding']);

    // accept закрывает run: persisted, замечание у разработчика
    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'defect', runId, idempotencyKey: randomUUID() })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('defect'));
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('persisted');
  });

  it('faithfulness: выдуманный раздел не доходит до PM — два цикла bind, потом cannot_tell', async () => {
    h.llm.nextDraft = 'ТЗ (§9.9) требует, чтобы кнопка была синей.';
    try {
      const { id, runId } = await create('Кнопка Сохранить серая с заливкой снова', { expected: 'По ТЗ primary синяя', screenshotKey: `${h.projectId}/${randomUUID()}.png` });
      const done = await h.waitFor(id, ['awaiting_pm']);
      expect(done.runId).toBe(runId);
      expect(done.proposedClass).toBe('cannot_tell');
      expect(done.draft.join(' ')).not.toMatch(/§9\.9 требует/);
      expect(done.draft[0]).toBe('Недостаточно данных.');
      expect(h.llm.calls.filter((c) => c === 'draft').length).toBeGreaterThanOrEqual(3);
    } finally {
      h.llm.nextDraft = null;
    }
  });

  it('run.cancel: вердикта нет, run = cancelled, замечание снова imported и разбирается заново новым run', async () => {
    const { id, runId } = await create('Логотип не по центру', { screenshotKey: `${h.projectId}/${randomUUID()}.png` });
    await h.waitFor(id, ['awaiting_pm']);
    const res = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/cancel`).set(h.auth('pm')).send({ runId, idempotencyKey: randomUUID() }).expect(200);
    expect(res.body.status).toBe('imported');
    expect(await h.prisma.humanVerdict.count({ where: { remarkId: id } })).toBe(0);
    expect((await h.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe('cancelled');
    expect(await h.prisma.graphCheckpoint.count({ where: { runId } })).toBe(0);

    // developer отменять не может
    await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/cancel`).set(h.auth('developer')).send({ runId, idempotencyKey: randomUUID() }).expect(403);

    const again = await h.http.post(`/api/v1/projects/${h.projectId}/remarks/${id}/triage`).set(h.auth('pm')).expect(200);
    expect(again.body.runId).not.toBe(runId);
    const done = await h.waitFor(id, ['awaiting_pm']);
    expect(done.runId).toBe(again.body.runId);
  });
});
