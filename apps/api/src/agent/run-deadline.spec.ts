/**
 * run-deadline.spec — аудит беты R-H2: прогон графа не живёт дольше GRAPH_RUN_TIMEOUT_MS (вызовы модели × ретраи SDK ×
 * циклы rewrite/bind) и падает с кодом `timeout` без повторов очереди; стоимость модели на проект за сутки ограничена
 * GRAPH_DAILY_USD_PER_PROJECT — старт разбора отвечает 409 llm_budget, а не жжёт счёт дальше.
 */
import { createHarness, type Harness } from '../../test/harness';
import { resetConfig } from '../config';
import { AgentService } from './agent.service';

describe('run deadline and budget', () => {
  let h: Harness;
  let nextNumber = 9310;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    delete process.env['GRAPH_RUN_TIMEOUT_MS'];
    delete process.env['GRAPH_DAILY_USD_PER_PROJECT'];
    resetConfig();
    await h.cleanup();
  });

  /** POST /remarks сам стартует разбор; здесь карточка `imported`, чтобы стартовать явно и следить за прогоном. */
  async function imported(description: string): Promise<string> {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: nextNumber++, description, expected: 'Кнопка есть', pageOrScreen: 'Главная', status: 'imported' } });
    return remark.id;
  }

  it('прогон дольше дедлайна — failed с кодом timeout без повторов, карточка вернулась в imported и стартует снова', async () => {
    // Дедлайн 300 мс — только на медленный прогон: обычный граф на загруженном раннере CI в него не укладывается.
    // Прогон читает дедлайн при старте, поэтому вернуть дефолт можно, как только карточка вернулась в imported
    process.env['GRAPH_RUN_TIMEOUT_MS'] = '300';
    resetConfig();
    h.llm.delayMs = 1500;
    const remarkId = await imported('Нет кнопки «Сохранить» — модель отвечает медленно');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    const back = await h.waitFor(remarkId, ['imported']).finally(() => {
      delete process.env['GRAPH_RUN_TIMEOUT_MS'];
      resetConfig();
    });
    expect(back.runStatus).toBe('failed');
    expect(back.runFailure).toMatch(/не уложился/);
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.failureCode).toBe('timeout');
    // Дедлайн — не временная ошибка модели: задача закрывается с первой попытки
    let job = await h.prisma.job.findFirstOrThrow({ where: { runId: run.id } });
    for (let i = 0; i < 50 && job.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    }
    expect(job).toMatchObject({ status: 'done', attempts: 1 });
    h.llm.delayMs = 0;
    const again = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    expect(again.body.status).toBe('triaging');
    await h.waitFor(remarkId, ['awaiting_pm', 'cannot_tell']);
  });

  it('чекпоинты завершённых прогонов старше недели удаляются, свежие и бегущие — остаются (R-M2)', async () => {
    const agent = h.app.get(AgentService);
    const remarkId = await imported('Ретеншн чекпоинтов');
    const day = 24 * 60 * 60 * 1000;
    // Старый «бегущий» прогон здесь не создаём: failStaleRuns соседних спек глобален и пометил бы его failed
    const mk = (status: 'persisted' | 'failed' | 'awaiting_human' | 'running', ageDays: number) =>
      h.prisma.agentRun.create({ data: { remarkId, projectId: h.projectId, mode: 'triage', status, createdAt: new Date(Date.now() - ageDays * day) } });
    const oldDone = await mk('persisted', 8);
    const oldFailed = await mk('failed', 30);
    const freshDone = await mk('persisted', 2);
    const oldWaiting = await mk('awaiting_human', 9);
    const running = await mk('running', 0);
    const runs = [oldDone, oldFailed, freshDone, oldWaiting, running];
    for (const run of runs) {
      await h.prisma.graphCheckpoint.create({ data: { runId: run.id, ns: '', checkpointId: `cp-${run.id}`, blob: {}, metadata: {} } });
    }
    expect(await agent.pruneCheckpoints()).toBe(2);
    const left = await h.prisma.graphCheckpoint.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { runId: true } });
    expect(left.map((c) => c.runId).sort()).toEqual([freshDone.id, oldWaiting.id, running.id].sort());
    await h.prisma.agentRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
  });

  it('лимит стоимости за сутки: 409 llm_budget, пока сумма costUsd прогонов проекта ≥ лимита; прогоны старше суток не считаются', async () => {
    process.env['GRAPH_DAILY_USD_PER_PROJECT'] = '1';
    resetConfig();
    const remarkId = await imported('Кнопка «Сохранить» не на месте — бюджет');
    const spend = (costUsd: number) => h.prisma.agentRun.create({ data: { remarkId, projectId: h.projectId, mode: 'triage', status: 'persisted', costUsd } });
    const older = await spend(0.6);
    await spend(0.5);
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(409);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'llm_budget' });
    expect(res.body.message).toMatch(/Лимит стоимости модели/);
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: remarkId } })).status).toBe('imported');
    // Прогон старше суток выпадает из окна — сумма 0,5 < 1, разбор стартует
    await h.prisma.agentRun.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const ok = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    expect(ok.body.status).toBe('triaging');
    await h.waitFor(remarkId, ['awaiting_pm', 'cannot_tell']);
  });
});
