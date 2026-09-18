/**
 * jobs.spec — аудит: no-job-queue, deploy-kills-inflight-and-stale-sweep, llm-outage-retry; P2 плана защиты 18.09.
 * Прогоны графа и индексация идут через очередь в Postgres: REST отвечает сразу, временная ошибка модели
 * повторяется с паузой (человек видит «не получилось» только после последней, четвёртой попытки), задача,
 * осиротевшая после падения процесса, возвращается в очередь — и на старте, и таймером, — run.cancel снимает задачу,
 * кончившийся баланс OpenAI (`insufficient_quota`) не повторяется.
 */
import { randomUUID } from 'node:crypto';
import { createHarness, type Harness } from '../../test/harness';
import type { GraphJob } from '../agent/agent.service';
import { DocumentsService } from '../documents/documents.service';
import { classifyRunError, isRetryable } from '../llm/llm-errors';
import { RemarksService } from '../remarks/remarks.service';
import { JobsService } from './jobs.service';

/** Ошибка в форме OpenAI SDK: `status` и `name` — то, по чему классифицирует classifyRunError. */
function llmError(name: string, status: number, message: string): Error {
  const err = new Error(message);
  err.name = name;
  (err as { status?: number }).status = status;
  return err;
}

describe('jobs queue', () => {
  let h: Harness;
  let jobs: JobsService;
  let nextNumber = 9110;
  const url = (path: string): string => `/api/v1/projects/${h.projectId}${path}`;

  beforeAll(async () => {
    h = await createHarness();
    jobs = h.app.get(JobsService);
  });

  afterAll(async () => {
    for (const n of [...gates.keys()]) release(n);
    await h.cleanup();
  });

  // R-B2: обработчик ждёт «ворота» теста — так задача остаётся running ровно столько, сколько нужно проверке.
  // `released` защищает от гонки: тест может отпустить ворота раньше, чем обработчик их поставит.
  const gates = new Map<string, () => void>();
  const released = new Set<string>();
  const gated = (payload: unknown): Promise<void> => {
    const n = (payload as { n: string }).n;
    if (released.has(n)) return Promise.resolve();
    return new Promise<void>((resolve) => gates.set(n, resolve));
  };
  const release = (n: string): void => {
    released.add(n);
    gates.get(n)?.();
    gates.delete(n);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const statusOf = async (id: string) => (await h.prisma.job.findUniqueOrThrow({ where: { id } })).status;
  const until = async (id: string, status: string, tries = 80) => {
    for (let i = 0; i < tries && (await statusOf(id)) !== status; i++) await sleep(100);
    return statusOf(id);
  };

  /** POST /remarks сам стартует разбор; здесь нужна карточка `imported`, чтобы стартовать разбор явно и следить за задачей. */
  async function createRemark(description: string): Promise<string> {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: nextNumber++, description, expected: 'Кнопка есть', pageOrScreen: 'Главная', status: 'imported' } });
    return remark.id;
  }

  /** Карточка меняет статус внутри обработчика, строка задачи — после него: ждём, пока задача закроется. */
  async function jobOfRun(runId: string) {
    let job = await h.prisma.job.findFirstOrThrow({ where: { runId }, orderBy: { createdAt: 'desc' } });
    for (let i = 0; i < 100 && (job.status === 'running' || job.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    }
    return job;
  }

  it('индексация документа — задача очереди: загрузка отвечает сразу, документ становится indexed', async () => {
    const documents = h.app.get(DocumentsService);
    const ctx = { userId: h.users.pm.id, projectId: h.projectId, role: 'pm' as const };
    const doc = await documents.upload(ctx, { kind: 'spec', fileName: 'extra.md', data: Buffer.from('# Дополнение\n\nРаздел 9. Кнопка «Сохранить» есть на каждой странице.\n'), effectiveAt: new Date('2026-02-01') });
    expect(doc.status).toBe('uploaded');
    let status = doc.status;
    for (let i = 0; i < 100 && status !== 'indexed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await h.prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status;
    }
    expect(status).toBe('indexed');
    const job = await h.prisma.job.findFirstOrThrow({ where: { kind: 'index_document', projectId: h.projectId } });
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(1);
  });

  it('старт разбора: 200 с `triaging` сразу, граф исполняет воркер, задача закрывается done', async () => {
    const remarkId = await createRemark('Нет кнопки «Сохранить» на главной');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    expect(res.body.status).toBe('triaging');
    const done = await h.waitFor(remarkId, ['awaiting_pm', 'cannot_tell']);
    const job = await jobOfRun(done.runId);
    expect(job).toMatchObject({ kind: 'graph', status: 'done', attempts: 1, lockedAt: null });
  });

  it('временная ошибка модели (429): прогон не падает, задача повторяется и доходит до вердикта', async () => {
    h.llm.failNext.push(llmError('RateLimitError', 429, 'Rate limit reached'));
    const remarkId = await createRemark('Пропала кнопка «Сохранить» после обновления');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    // Первая попытка упала — карточка всё ещё «разбирается», не «не получилось»
    await new Promise((r) => setTimeout(r, 150));
    const mid = await h.http.get(url(`/remarks/${remarkId}`)).set(h.auth('pm')).expect(200);
    expect(mid.body.status).toBe('triaging');
    expect(mid.body.runFailure).toBeUndefined();
    const done = await h.waitFor(remarkId, ['awaiting_pm', 'cannot_tell']);
    expect(done.runId).toBe(res.body.runId);
    const job = await jobOfRun(done.runId);
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
    expect(job.lastError).toMatch(/llm_rate_limit/);
    const failed = await h.prisma.agentRun.count({ where: { remarkId, status: 'failed' } });
    expect(failed).toBe(0);
  });

  it('попытки исчерпаны: 4 попытки (паузы 30 с / 2 мин / 8 мин), прогон failed с кодом причины, карточка вернулась в imported', async () => {
    h.llm.failNext.push(llmError('RateLimitError', 429, 'x'), llmError('RateLimitError', 429, 'y'), llmError('RateLimitError', 429, 'z'), llmError('RateLimitError', 429, 'w'));
    const remarkId = await createRemark('Кнопка «Сохранить» не нажимается');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    const back = await h.waitFor(remarkId, ['imported']);
    expect(back.runStatus).toBe('failed');
    expect(back.runFailure).toMatch(/перегружена/);
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.failureCode).toBe('llm_rate_limit');
    const job = await jobOfRun(res.body.runId);
    // P2: при maxAttempts 3 пауза 8 мин не наступала никогда — окно переживало сбой OpenAI лишь ~2,5 мин
    expect(job).toMatchObject({ maxAttempts: 4, attempts: 4 });
    expect(job.status).toBe('done'); // обработчик сам записал failed в run — задача не «упавшая», а завершённая
  });

  it('insufficient_quota (кончился баланс OpenAI): код llm_quota, без повторов, текст для администратора', async () => {
    // Форма ошибки OpenAI SDK: RateLimitError 429, code/type из тела ответа
    const quota = Object.assign(llmError('RateLimitError', 429, '429 You exceeded your current quota, please check your plan and billing details.'), { code: 'insufficient_quota', type: 'insufficient_quota' });
    expect(classifyRunError(quota)).toMatchObject({ code: 'llm_quota' });
    expect(isRetryable(classifyRunError(quota))).toBe(false);
    // Обычный 429 без кода квоты — по-прежнему временная перегрузка
    expect(classifyRunError(llmError('RateLimitError', 429, 'Rate limit reached for requests'))).toMatchObject({ code: 'llm_rate_limit' });

    h.llm.failNext.push(quota);
    const remarkId = await createRemark('Кнопка «Сохранить» пропала после оплаты');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    const back = await h.waitFor(remarkId, ['imported']);
    expect(back.runFailure).toMatch(/баланс OpenAI/);
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.failureCode).toBe('llm_quota');
    expect((await jobOfRun(res.body.runId)).attempts).toBe(1);
  });

  it('ошибка не временная (ключ не принят): без повторов, сразу failed', async () => {
    h.llm.failNext.push(llmError('AuthenticationError', 401, 'Incorrect API key'));
    const remarkId = await createRemark('Кнопка «Сохранить» серая');
    const res = await h.http.post(url(`/remarks/${remarkId}/triage`)).set(h.auth('pm')).expect(200);
    const back = await h.waitFor(remarkId, ['imported']);
    expect(back.runFailure).toMatch(/администратору/);
    const run = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.failureCode).toBe('llm_auth');
    expect((await jobOfRun(res.body.runId)).attempts).toBe(1);
  });

  it('run.cancel снимает ещё не начатую задачу прогона', async () => {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9101, description: 'Отмена в очереди', status: 'triaging' } });
    const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'triage' } });
    const job = await jobs.enqueue('graph', graphStart(h, remark.id, run.id), { projectId: h.projectId, runId: run.id, delayMs: 60_000 });
    await h.http.post(url(`/remarks/${remark.id}/cancel`)).set(h.auth('pm')).send({ runId: run.id, idempotencyKey: randomUUID() }).expect(200);
    const row = await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('cancelled');
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: remark.id } })).status).toBe('imported');
    expect((await h.prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('cancelled');
  });

  it('задача, осиротевшая после падения процесса, возвращается в очередь и исполняется заново', async () => {
    const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number: 9102, description: 'Нет кнопки «Сохранить» — сирота', status: 'triaging' } });
    const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'triage' } });
    const job = await h.prisma.job.create({
      data: {
        kind: 'graph',
        payload: graphStart(h, remark.id, run.id) as object,
        projectId: h.projectId,
        runId: run.id,
        status: 'running',
        attempts: 1,
        lockedAt: new Date(Date.now() - 2 * 60_000),
        lockedBy: 'dead-instance',
        owner: jobs.instanceId,
      },
    });
    expect(await jobs.requeueStale()).toBe(1);
    const done = await h.waitFor(remark.id, ['awaiting_pm', 'cannot_tell']).catch(async (e: Error) => {
      const r = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      throw new Error(`${e.message}; run ${r.status} ${r.failureCode}: ${r.failureMessage}`);
    });
    expect(done.runId).toBe(run.id);
    const row = await jobOfRun(run.id);
    expect(row).toMatchObject({ id: job.id, status: 'done', attempts: 2 });
  });

  it('P2: сирота быстрого рестарта (lockedAt на старте ещё свежий) возвращается в очередь ближайшим тиком таймера', async () => {
    jobs.register('spec_orphan', async () => undefined);
    // Railway поднял новый контейнер раньше, чем погасил старый: на старте нового lockedAt задачи моложе 60 с
    const job = await h.prisma.job.create({
      data: { kind: 'spec_orphan', payload: {}, projectId: h.projectId, status: 'running', attempts: 1, lockedAt: new Date(Date.now() - 58_000), lockedBy: 'old-container', owner: jobs.instanceId },
    });
    await jobs.requeueStale(); // то, что делал только старт процесса: задачу он не видит
    expect(await statusOf(job.id)).toBe('running');
    // Таймер с тем же порогом 60 с (в бою — раз в минуту, здесь чаще): через ~2 с задача старше порога и уходит в очередь
    const stop = jobs.startStaleSweep(250);
    try {
      expect(await until(job.id, 'done', 100)).toBe('done');
    } finally {
      stop();
    }
    expect(await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'done', attempts: 2, lockedAt: null });
  });

  it('P2: задачу с живым воркером сметание не забирает, даже если её heartbeat отстал', async () => {
    jobs.register('spec_alive', gated);
    const job = await jobs.enqueue('spec_alive', { n: 'alive' }, { projectId: h.projectId });
    expect(await until(job.id, 'running')).toBe('running');
    // База «пропала» на пару минут, heartbeat не дописал lockedAt — но задача исполняется в этом процессе
    await h.prisma.job.update({ where: { id: job.id }, data: { lockedAt: new Date(Date.now() - 2 * 60_000) } });
    await jobs.requeueStale();
    expect(await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'running', lockedBy: jobs.instanceId });
    release('alive');
    expect(await until(job.id, 'done')).toBe('done');
    expect((await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(1);
  });

  it('P2: сметание по таймеру не роняет старый прогон, который только что продолжили («Не та цитата»), пока его задача ещё не поставлена', async () => {
    const remarks = h.app.get(RemarksService);
    // Прогон начат час назад; решение PM «Не та цитата» записано `agoMs` назад (та же транзакция вернула run в running), задачи resume нет
    const mk = async (number: number, agoMs: number) => {
      const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number, description: `Продолжение через час ${number}`, status: 'triaging' } });
      const run = await h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'triage', createdAt: new Date(Date.now() - 60 * 60_000) } });
      // История только дописывается (ADR 011): время решения задаём при вставке
      await h.prisma.remarkStatusChange.create({ data: { remarkId: remark.id, fromStatus: 'awaiting_pm', toStatus: 'triaging', action: 'rejected_binding', runId: run.id, userId: h.users.pm.id, role: 'pm', createdAt: new Date(Date.now() - agoMs) } });
      return run;
    };
    const justResumed = await mk(9105, 0);
    const silent = await mk(9106, 11 * 60_000);
    await remarks.failStaleRuns(10 * 60_000);
    expect((await h.prisma.agentRun.findUniqueOrThrow({ where: { id: justResumed.id } })).status).toBe('running');
    // 10 минут без действий и без задачи — это уже сирота
    expect(await h.prisma.agentRun.findUniqueOrThrow({ where: { id: silent.id } })).toMatchObject({ status: 'failed', failureCode: 'process_restart' });
    // Исполнителя у продолженного прогона в этой спеке нет: закрываем, чтобы cleanup не ждал его
    await h.prisma.agentRun.update({ where: { id: justResumed.id }, data: { status: 'cancelled' } });
  });

  it('сметание зависших прогонов не трогает прогон, у которого есть живая задача в очереди', async () => {
    const remarks = h.app.get(RemarksService);
    const old = new Date(Date.now() - 20 * 60_000);
    const mk = async (number: number) => {
      const remark = await h.prisma.remark.create({ data: { projectId: h.projectId, roundId: h.roundId, number, description: `Зависший ${number}`, status: 'triaging' } });
      return h.prisma.agentRun.create({ data: { remarkId: remark.id, projectId: h.projectId, status: 'running', mode: 'triage', createdAt: old } });
    };
    const waiting = await mk(9103);
    const orphan = await mk(9104);
    await jobs.enqueue('graph', graphStart(h, waiting.remarkId, waiting.id), { projectId: h.projectId, runId: waiting.id, delayMs: 60_000 });
    expect(await remarks.failStaleRuns(10 * 60_000)).toBe(1);
    expect((await h.prisma.agentRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('running');
    const dead = await h.prisma.agentRun.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(dead.status).toBe('failed');
    expect(dead.failureCode).toBe('process_restart');
    expect((await h.prisma.remark.findUniqueOrThrow({ where: { id: orphan.remarkId } })).status).toBe('imported');
  });

  it('завершённые задачи старше срока хранения удаляются; свежие и ждущие — остаются', async () => {
    const day = 24 * 60 * 60 * 1000;
    const mk = (status: 'done' | 'failed' | 'queued', ageDays: number) =>
      h.prisma.job.create({ data: { kind: 'spec_prune', payload: {}, projectId: h.projectId, status, owner: 'spec', finishedAt: status === 'queued' ? null : new Date(Date.now() - ageDays * day), runAfter: new Date(Date.now() + 60 * 60 * 1000) } });
    const oldDone = await mk('done', 31);
    const freshDone = await mk('done', 5);
    const oldFailed = await mk('failed', 91);
    const midFailed = await mk('failed', 45);
    const waiting = await mk('queued', 0);
    expect(await jobs.pruneFinished()).toBe(2);
    const left = await h.prisma.job.findMany({ where: { kind: 'spec_prune', projectId: h.projectId }, select: { id: true } });
    expect(left.map((j) => j.id).sort()).toEqual([freshDone.id, midFailed.id, waiting.id].sort());
    expect(left.map((j) => j.id)).not.toContain(oldDone.id);
    expect(left.map((j) => j.id)).not.toContain(oldFailed.id);
  });

  it('лимит на проект (R-B2): пока проект держит слот, идут задачи другого проекта и без проекта, а ждущие не сжигают попытку', async () => {
    jobs.register('spec_fair', gated, { maxPerProject: 1 });
    const a1 = await jobs.enqueue('spec_fair', { n: 'a1' }, { projectId: h.projectId });
    const a2 = await jobs.enqueue('spec_fair', { n: 'a2' }, { projectId: h.projectId });
    const b1 = await jobs.enqueue('spec_fair', { n: 'b1' }, { projectId: randomUUID() });
    const none = await jobs.enqueue('spec_fair', { n: 'none' }, {});
    expect(await until(a1.id, 'running')).toBe('running');
    // Чужой проект и задача без проекта берутся, хотя a1 ещё держит слот; без NULL-guard в claim `none` стояла бы вечно
    await until(b1.id, 'running');
    release('b1');
    await until(none.id, 'running');
    release('none');
    expect(await until(b1.id, 'done')).toBe('done');
    expect(await until(none.id, 'done')).toBe('done');
    expect(await h.prisma.job.findUniqueOrThrow({ where: { id: a2.id } })).toMatchObject({ status: 'queued', attempts: 0 });
    release('a1');
    expect(await until(a1.id, 'done')).toBe('done');
    expect(await until(a2.id, 'running')).toBe('running');
    release('a2');
    expect(await until(a2.id, 'done')).toBe('done');
    expect((await h.prisma.job.findUniqueOrThrow({ where: { id: a2.id } })).attempts).toBe(1);
  });

  it('лимит на вид (R-B2): вторая задача вида ждёт в queued, задача другого вида идёт мимо неё', async () => {
    jobs.register('spec_fair_kind', gated, { maxConcurrent: 1 });
    jobs.register('spec_free', async () => undefined);
    const k1 = await jobs.enqueue('spec_fair_kind', { n: 'k1' }, { projectId: h.projectId });
    const k2 = await jobs.enqueue('spec_fair_kind', { n: 'k2' }, { projectId: randomUUID() });
    const free = await jobs.enqueue('spec_free', {}, {});
    expect(await until(k1.id, 'running')).toBe('running');
    expect(await until(free.id, 'done')).toBe('done');
    expect(await h.prisma.job.findUniqueOrThrow({ where: { id: k2.id } })).toMatchObject({ status: 'queued', attempts: 0 });
    release('k1');
    expect(await until(k1.id, 'done')).toBe('done');
    expect(await until(k2.id, 'running')).toBe('running');
    release('k2');
    expect(await until(k2.id, 'done')).toBe('done');
    expect((await h.prisma.job.findUniqueOrThrow({ where: { id: k2.id } })).attempts).toBe(1);
  });

  it('обработчик просит повтор через свою паузу; без обработчика задача failed с понятной причиной', async () => {
    let calls = 0;
    jobs.register('spec_retry', async () => {
      calls++;
      if (calls === 1) throw new (await import('./jobs.service')).RetryJobError('ещё раз', 50);
    });
    const job = await jobs.enqueue('spec_retry', {}, { projectId: h.projectId });
    for (let i = 0; i < 50 && (await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status !== 'done'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'done', attempts: 2, lastError: 'ещё раз' });

    const unknown = await jobs.enqueue('spec_unknown', {}, { projectId: h.projectId });
    for (let i = 0; i < 50 && (await h.prisma.job.findUniqueOrThrow({ where: { id: unknown.id } })).status === 'queued'; i++) await new Promise((r) => setTimeout(r, 100));
    const row = await h.prisma.job.findUniqueOrThrow({ where: { id: unknown.id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/нет обработчика/);
  });
});

function graphStart(h: Harness, remarkId: string, runId: string): GraphJob {
  const input = { projectId: h.projectId, userId: h.users.pm.id, role: 'pm' as const, remarkId, runId, humanComment: null, excludeChunkIds: [] };
  return {
    action: 'start',
    graph: 'triage',
    remarkId,
    runId,
    input,
    trace: { mode: 'triage', runId, remarkId, projectId: h.projectId, userId: h.users.pm.id, role: 'pm', model: 'fake/rules', resume: false, input: { remarkId } },
  };
}
