/**
 * run-cost.spec: AgentRun.inputTokens / outputTokens / costUsd — сумма всех
 * проходов прогона. Раньше второй проход после «Не та цитата» затирал расход первого (присваивание вместо прибавления),
 * а сбойный прогон не писал расход совсем — суточный лимит и Langfuse видели разные суммы.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import type { LlmUsage } from '../llm/triage-llm';

/** Расход одного прохода (порядок как у типичного триажа в evals/results/2026-09-04-live-3.json). */
const PASS: LlmUsage = { inputTokens: 3133, outputTokens: 200, costUsd: 0.002 };

function llmError(name: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { name, status });
}

describe('стоимость прогона: прибавляется, а не перезаписывается (P3)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    // FakeLlm (правила) токенов не тратит: каждый проход отдаёт фиксированный расход, как OpenAiTriageLlm.takeUsage
    h.llm.takeUsage = () => ({ ...PASS });
  });

  afterAll(() => h.cleanup());

  async function create(description: string): Promise<{ id: string; runId: string }> {
    const res = await h.http
      .post(`/api/v1/projects/${h.projectId}/rounds/${h.roundId}/remarks`)
      .set(h.auth('business'))
      .send({ description, pageOrScreen: 'Профиль', expected: 'По ТЗ primary синяя', screenshotKey: `${h.projectId}/${randomUUID()}.png` })
      .expect(201);
    return { id: res.body.id, runId: res.body.runId };
  }

  const usageOf = async (runId: string) => {
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    return { status: run.status, inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: Number(run.costUsd) };
  };

  it('«Не та цитата»: второй проход того же run прибавляет токены и стоимость к первому', async () => {
    const { id, runId } = await create('Кнопка Сохранить серая с заливкой — стоимость');
    await h.waitFor(id, ['awaiting_pm']);
    expect(await usageOf(runId)).toEqual({ status: 'awaiting_human', inputTokens: 3133, outputTokens: 200, costUsd: 0.002 });

    await h.http
      .post(`/api/v1/projects/${h.projectId}/remarks/${id}/verdict`)
      .set(h.auth('pm'))
      .send({ verdict: 'rejected_binding', comment: 'Смотрите раздел про ошибки', runId, idempotencyKey: randomUUID() })
      .expect(200);
    const second = await h.waitFor(id, ['awaiting_pm']);
    expect(second.runId).toBe(runId);
    // Раньше здесь снова было 3133 / 200 / 0.002 — расход первого прохода терялся
    expect(await usageOf(runId)).toEqual({ status: 'awaiting_human', inputTokens: 6266, outputTokens: 400, costUsd: 0.004 });
  });

  it('сбойный прогон тоже пишет оплаченный расход — его видит суточный лимит', async () => {
    h.llm.failNext.push(llmError('AuthenticationError', 401, 'Incorrect API key'));
    const { id, runId } = await create('Кнопка Сохранить серая — сбой модели');
    await h.waitFor(id, ['imported']);
    expect(await usageOf(runId)).toEqual({ status: 'failed', inputTokens: 3133, outputTokens: 200, costUsd: 0.002 });
  });
});
