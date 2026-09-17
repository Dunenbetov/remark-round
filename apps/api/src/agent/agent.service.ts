import { ConflictException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Command } from '@langchain/langgraph';
import type { RemarkStatus } from '@remarkround/db';
import { config } from '../config';
import { DiffService } from '../diff/diff.service';
import { JobsService, RetryJobError, type JobContext } from '../jobs/jobs.service';
import { classifyRunError, isRetryable, type RunFailure } from '../llm/llm-errors';
import { LlmService } from '../llm/llm.service';
import { ObservabilityService, type RunTrace } from '../observability/observability.service';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import type { RemarkView, VerdictDto } from '../remarks/remark.dto';
import { RemarksService } from '../remarks/remarks.service';
import { StorageService } from '../storage/storage.service';
import type { ProjectContext } from '../tenancy/project-context';
import type { GraphDeps } from './graph-deps';
import type { HumanDecision, RetestDecision, RetestStrategy } from './graph-state';
import { PrismaCheckpointSaver } from './prisma-checkpointer';
import { Semaphore } from './semaphore';
import { buildRetestGraph, retestStrategyFromEnv, type RetestGraph, type RetestInput } from './retest.graph';
import { RunEvents, type Phase } from './run-events';
import { buildTriageGraph, type TriageGraph, type TriageInput } from './triage.graph';

export { classifyRunError } from '../llm/llm-errors';

export interface RunOptions {
  /** Дождаться interrupt/конца прямо здесь (evals, тесты). По умолчанию прогон уходит в очередь задач, фазы — по WS. */
  wait?: boolean;
}

/** Прогоны, зависшие в `running` дольше этого без задачи в очереди, помечаются failed на старте. */
const STALE_RUN_MS = 10 * 60 * 1000;
/** Чекпоинты завершённых прогонов старше недели удаляются (R-M2): продолжать их некому, а полное состояние графа в каждом — мегабайты. */
const CHECKPOINT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

type GraphKind = 'triage' | 'retest';

/** Задача очереди `graph` (JobsService): всё, что нужно, чтобы выполнить прогон в любом процессе API. */
export type GraphJob =
  | { action: 'start'; graph: GraphKind; remarkId: string; runId: string; input: TriageInput | RetestInput; trace: RunTrace }
  | { action: 'resume'; graph: GraphKind; remarkId: string; runId: string; decision: HumanDecision | RetestDecision; trace: RunTrace; fallback?: TriageInput; persisted: ProjectContext | null };

interface RunOutcome {
  /** Временная ошибка модели, а попытки ещё есть: run оставлен `running`, задача уйдёт на повтор. */
  retry?: RunFailure;
}

interface RunExec {
  /** Остановка процесса или run.cancel извне очереди. */
  signal?: AbortSignal;
  /** Последняя попытка (или прогон без очереди): временная ошибка тоже становится failed. */
  final: boolean;
}

/**
 * Оркестратор графа: старт прогона, продолжение по решению человека, отмена. Запись — только RemarksService,
 * граф — только LangGraph с чекпоинтом в Postgres (thread_id = AgentRun.id). REST и WS зовут одни и те же методы.
 * Сам прогон исполняет очередь задач (JobsService, аудит: no-job-queue): REST отвечает сразу, рестарт API не теряет
 * работу, временные ошибки модели повторяются с паузой; `wait: true` (evals, импорт в тестах) исполняет прямо здесь.
 */
@Injectable()
export class AgentService implements OnModuleInit {
  private readonly log = new Logger(AgentService.name);
  private triage!: TriageGraph;
  private retestGraph!: RetestGraph;
  private checkpointer!: PrismaCheckpointSaver;
  private readonly running = new Map<string, AbortController>();
  /**
   * Лимит параллельных прогонов (фаза 11): глобальный и на проект — импорт на 200 строк не съедает всё, REST уже ответил `triaging`.
   * Для задач очереди те же лимиты держит сам claim (JobsService, R-B2): ждущий прогон остаётся `queued`, а не занимает слот воркера.
   * Семафоры здесь — страховка для прогонов мимо очереди (`wait: true`: evals, импорт в тестах).
   */
  private readonly maxConcurrent = Number(process.env['GRAPH_MAX_CONCURRENT'] ?? 4);
  private readonly globalSlots = new Semaphore(this.maxConcurrent);
  private readonly projectSlots = new Map<string, Semaphore>();
  private readonly perProject = Number(process.env['GRAPH_MAX_PER_PROJECT'] ?? 2);
  /** Ветка ретеста (ADR 002 п.4): дефолт — победитель A/B; раннер evals переключает её, чтобы сравнить обе на одном коде. */
  retestStrategy: RetestStrategy = retestStrategyFromEnv();

  constructor(
    private readonly remarks: RemarksService,
    private readonly rag: RagService,
    private readonly diff: DiffService,
    private readonly storage: StorageService,
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    private readonly events: RunEvents,
    private readonly observability: ObservabilityService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.checkpointer = new PrismaCheckpointSaver(this.prisma);
    const deps: GraphDeps = { remarks: this.remarks, rag: this.rag, diff: this.diff, storage: this.storage, llm: this.llm, events: this.events };
    this.triage = buildTriageGraph(deps, this.checkpointer);
    this.retestGraph = buildRetestGraph(deps, this.checkpointer);
    this.jobs.register('graph', (payload, ctx) => this.executeJob(payload as GraphJob, ctx), { maxConcurrent: this.maxConcurrent, maxPerProject: this.perProject });
    void this.remarks
      .failStaleRuns(STALE_RUN_MS)
      .then((n) => n && this.log.warn(`stale runs marked failed: ${n}`))
      .catch((e: Error) => this.log.warn(`stale runs sweep: ${e.message}`));
    // Ретеншн чекпоинтов: на старте и раз в сутки; в тестах много стендов на одной БД — не трогаем чужие прогоны
    if (config().NODE_ENV !== 'test') {
      const sweep = () => void this.pruneCheckpoints().then((n) => n && this.log.log(`checkpoints: удалено ${n} строк завершённых прогонов старше недели`)).catch((e: Error) => this.log.warn(`checkpoints prune: ${e.message}`));
      sweep();
      setInterval(sweep, PRUNE_EVERY_MS).unref();
    }
  }

  /** Чекпоинты прогонов, которые завершились (persisted / failed / cancelled) раньше `olderThanMs` назад: продолжать их некому. */
  async pruneCheckpoints(olderThanMs = CHECKPOINT_RETENTION_MS, now = new Date()): Promise<number> {
    const { count } = await this.prisma.graphCheckpoint.deleteMany({
      where: { run: { status: { in: ['persisted', 'failed', 'cancelled'] }, createdAt: { lt: new Date(now.getTime() - olderThanMs) } } },
    });
    return count;
  }

  get model(): string {
    return this.llm.model;
  }

  phaseOf(runId: string): Phase | undefined {
    return this.events.phaseOf(runId);
  }

  /** imported | cannot_tell | reopened → triaging → (граф) → awaiting_pm. Ответ — сразу, с runId; фазы идут в комнату. */
  async startTriage(ctx: ProjectContext, remarkId: string, opts: RunOptions = {}): Promise<RemarkView> {
    await this.assertBudget(ctx.projectId);
    const { runId } = await this.remarks.beginTriage(ctx, remarkId, this.llm.model);
    const input: TriageInput = { projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, remarkId, runId, humanComment: null, excludeChunkIds: [] };
    await this.dispatchStart('triage', remarkId, runId, input, this.trace(ctx, 'triage', runId, remarkId, false, { remarkId }), opts);
    return this.remarks.get(ctx, remarkId);
  }

  /**
   * HITL: вердикт пишет RemarksService (идемпотентно), затем граф продолжается из чекпоинта того же run:
   * accept → persist, «Не та цитата» → цикл bind в том же AgentRun, «Не хватает скрина» → pause.
   */
  async verdict(ctx: ProjectContext, remarkId: string, dto: VerdictDto, opts: RunOptions = {}): Promise<RemarkView> {
    const { remark, applied } = await this.remarks.verdict(ctx, remarkId, dto);
    if (!applied) return remark;
    if (dto.verdict === 'rejected_binding') {
      const fallback: TriageInput = {
        projectId: ctx.projectId,
        userId: ctx.userId,
        role: ctx.role,
        remarkId,
        runId: dto.runId,
        humanComment: dto.comment ?? '',
        excludeChunkIds: remark.citations.map((c) => c.chunkId).filter((id): id is string => Boolean(id)),
      };
      const decision: HumanDecision = { kind: 'reject_binding', comment: dto.comment ?? '' };
      await this.dispatchResume('triage', remarkId, dto.runId, decision, this.trace(ctx, 'triage', dto.runId, remarkId, true, { verdict: dto.verdict, decision }), opts, fallback, null);
      return remark;
    }
    const decision: HumanDecision = dto.verdict === 'cannot_tell' ? { kind: 'request_screenshot' } : { kind: 'accept' };
    await this.dispatchResume('triage', remarkId, dto.runId, decision, this.trace(ctx, 'triage', dto.runId, remarkId, true, { verdict: dto.verdict, decision }), opts, undefined, ctx);
    return remark;
  }

  /** run.cancel: вердикта нет, run = cancelled; бегущий граф прерывается, задача в очереди снимается, чекпоинты удаляются. */
  async cancel(ctx: ProjectContext, remarkId: string, runId: string): Promise<RemarkView> {
    if (ctx.role !== 'pm' && ctx.role !== 'business') throw new ForbiddenException();
    this.running.get(runId)?.abort();
    await this.jobs.cancelByRun(runId);
    const before = await this.remarks.get(ctx, remarkId);
    const view = await this.remarks.cancelRun(ctx, remarkId, runId);
    if (before.runId === runId && (before.runStatus === 'running' || before.runStatus === 'awaiting_human')) {
      await this.checkpointer.deleteThread(runId);
      this.events.emit(remarkId, { type: 'run.cancelled', runId, remarkStatus: view.status });
    }
    return view;
  }

  /** Ретест: новый кадр → граф (дифф → explain) → awaiting_business_close; закрывает только бизнес. */
  async retest(ctx: ProjectContext, remarkId: string, screenshotKey: string, opts: RunOptions = {}): Promise<RemarkView> {
    await this.assertBudget(ctx.projectId);
    const { runId } = await this.remarks.beginRetest(ctx, remarkId, screenshotKey, this.llm.model);
    const input: RetestInput = { projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, remarkId, runId, strategy: this.retestStrategy };
    await this.dispatchStart('retest', remarkId, runId, input, this.trace(ctx, 'retest', runId, remarkId, false, { remarkId, screenshotKey, strategy: this.retestStrategy }), opts);
    return this.remarks.get(ctx, remarkId);
  }

  async close(ctx: ProjectContext, remarkId: string, comment?: string | null): Promise<RemarkView> {
    const view = await this.remarks.close(ctx, remarkId, comment);
    // Закрыли без нового кадра (ADR 010) — ретест-графа нет; последний ретест-прогон, если был, уже завершён «не исправлено»
    if (view.closedVia === 'retest') await this.finishRetest(ctx, view, { kind: 'close' });
    return view;
  }

  async notFixed(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const view = await this.remarks.notFixed(ctx, remarkId);
    await this.finishRetest(ctx, view, { kind: 'not_fixed' });
    return view;
  }

  private async finishRetest(ctx: ProjectContext, view: RemarkView, decision: RetestDecision): Promise<void> {
    if (!view.runId || view.runMode !== 'retest') return;
    const runId = view.runId;
    await this.dispatchResume('retest', view.id, runId, decision, this.trace(ctx, 'retest', runId, view.id, true, { decision }), {}, undefined, ctx);
  }

  /**
   * Потолок стоимости модели на проект за скользящие сутки (R-H2): SUM(costUsd) по AgentRun проекта; 409 `llm_budget`,
   * пока окно не сдвинется или администратор не поднимет GRAPH_DAILY_USD_PER_PROJECT. Сбойные прогоны стоимость не пишут
   * (failRun) — считаются только дошедшие до черновика. Продолжение после решения PM лимит не проверяет: прогон уже начат.
   */
  private async assertBudget(projectId: string): Promise<void> {
    const limit = config().GRAPH_DAILY_USD_PER_PROJECT;
    if (!limit) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { _sum } = await this.prisma.agentRun.aggregate({ _sum: { costUsd: true }, where: { projectId, createdAt: { gte: since } } });
    const spent = Number(_sum.costUsd ?? 0);
    if (spent < limit) return;
    throw new ConflictException({
      code: 'llm_budget',
      message: `Лимит стоимости модели на сутки исчерпан (${spent.toFixed(2)} из ${limit} $) — попробуйте позже или попросите администратора поднять GRAPH_DAILY_USD_PER_PROJECT`,
    });
  }

  /** Атрибуты trace Langfuse одного прогона: кто нажал, какое замечание, какой run (фаза 8). */
  private trace(ctx: ProjectContext, mode: RunTrace['mode'], runId: string, remarkId: string, resume: boolean, input: unknown): RunTrace {
    return { mode, runId, remarkId, projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, model: this.llm.model, resume, input };
  }

  // ---------- очередь ----------

  private async dispatchStart(graph: GraphKind, remarkId: string, runId: string, input: TriageInput | RetestInput, trace: RunTrace, opts: RunOptions): Promise<void> {
    if (opts.wait) {
      await this.run(this.graphOf(graph), remarkId, runId, input, trace, { final: true });
      return;
    }
    const job: GraphJob = { action: 'start', graph, remarkId, runId, input, trace };
    await this.jobs.enqueue('graph', job, { projectId: trace.projectId, runId });
  }

  private async dispatchResume(
    graph: GraphKind,
    remarkId: string,
    runId: string,
    decision: HumanDecision | RetestDecision,
    trace: RunTrace,
    opts: RunOptions,
    fallback: TriageInput | undefined,
    persisted: ProjectContext | null,
  ): Promise<void> {
    if (opts.wait) {
      await this.resume(this.graphOf(graph), remarkId, runId, decision, trace, fallback, { final: true });
      if (persisted) await this.emitPersisted(persisted, remarkId, runId);
      return;
    }
    const job: GraphJob = { action: 'resume', graph, remarkId, runId, decision, trace, fallback, persisted };
    await this.jobs.enqueue('graph', job, { projectId: trace.projectId, runId });
  }

  /** Обработчик задачи `graph`: то же исполнение, что и `wait: true`, но с повторами и прерыванием по SIGTERM. */
  private async executeJob(job: GraphJob, ctx: JobContext): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: job.runId }, select: { status: true } });
    // Отменили или прогон упал, пока задача ждала. Продолжение после вердикта идёт при run = persisted:
    // вердикт записан RemarksService, графу осталось дойти до persist и разослать run.persisted.
    if (!run || run.status === 'cancelled' || run.status === 'failed') return;
    if (job.action === 'start' && run.status !== 'running') return;
    const graph = this.graphOf(job.graph);
    const exec: RunExec = { signal: ctx.signal, final: ctx.attempt >= ctx.maxAttempts };
    let outcome: RunOutcome;
    if (job.action === 'start') {
      // Повтор после сбоя или рестарта: прогон начинается заново, недописанные чекпоинты первой попытки не нужны
      if (ctx.attempt > 1) await this.checkpointer.deleteThread(job.runId);
      outcome = await this.run(graph, job.remarkId, job.runId, job.input, job.trace, exec);
    } else {
      outcome = await this.resume(graph, job.remarkId, job.runId, job.decision, job.trace, job.fallback, exec);
      if (!outcome.retry && !ctx.signal.aborted && job.persisted) await this.emitPersisted(job.persisted, job.remarkId, job.runId);
    }
    if (outcome.retry) throw new RetryJobError(`${outcome.retry.code}: ${outcome.retry.message}`);
  }

  private graphOf(kind: GraphKind): TriageGraph | RetestGraph {
    return kind === 'triage' ? this.triage : this.retestGraph;
  }

  // ---------- исполнение ----------

  /**
   * Один вызов графа = один корневой span в trace прогона (Langfuse, фаза 8): ноды графа под ним через CallbackHandler,
   * вызовы OpenAI и эмбеддинги — как generation / embedding. Ошибка прогона попадает в span, отмена — тоже.
   */
  private async run(graph: TriageGraph | RetestGraph, remarkId: string, runId: string, input: TriageInput | RetestInput | Command, trace: RunTrace, exec: RunExec): Promise<RunOutcome> {
    const ac = new AbortController();
    const onOuterAbort = () => ac.abort();
    exec.signal?.addEventListener('abort', onOuterAbort, { once: true });
    this.running.set(runId, ac);
    // Сначала слот проекта, потом общий: ожидание в очереди проекта не занимает общий слот.
    // Задачи из очереди сюда приходят уже в пределах лимитов (claim их не берёт сверх), ждут здесь только прогоны с `wait: true`
    const project = this.projectSlots.get(trace.projectId) ?? new Semaphore(this.perProject);
    this.projectSlots.set(trace.projectId, project);
    const releaseProject = await project.acquire();
    const releaseGlobal = await this.globalSlots.acquire();
    let deadline: AbortSignal | null = null;
    try {
      if (ac.signal.aborted) return {};
      // Дедлайн прогона (R-H2): вызовы модели по 60 с × ретраи SDK × циклы rewrite/bind не растянутся дольше
      // GRAPH_RUN_TIMEOUT_MS; отсчёт — после получения слотов, ожидание в очереди в него не входит
      const timeoutMs = config().GRAPH_RUN_TIMEOUT_MS;
      deadline = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any([ac.signal, deadline]);
      await this.observability.run(trace, async (span) => {
        const state = await (graph as TriageGraph).invoke(input as TriageInput, {
          configurable: { thread_id: runId },
          signal,
          recursionLimit: 80,
          callbacks: this.observability.callbacks(trace),
        });
        span.update({ output: summarize(trace.mode, state as Record<string, unknown>) });
      });
      return {};
    } catch (e) {
      if (ac.signal.aborted) {
        // Отмена человеком или остановка процесса: учёт токенов этого прогона больше никому не нужен
        this.llm.takeUsage(runId);
        return {};
      }
      const err = e as Error;
      const minutes = Math.max(1, Math.round(config().GRAPH_RUN_TIMEOUT_MS / 60_000));
      // Истёкший дедлайн — не временная ошибка модели: без повторов очереди, сразу на карточку
      const failure: RunFailure = deadline?.aborted ? { code: 'timeout', message: `Прогон не уложился в ${minutes} мин — запустите снова` } : classifyRunError(e);
      if (failure.code !== 'timeout' && isRetryable(failure) && !exec.final) {
        // Временная ошибка модели: run остаётся running, очередь повторит с паузой; человеку пока ничего не показываем.
        // Учёт токенов не сбрасываем: повтор добавит свои, и в AgentRun ляжет честная сумма
        this.log.warn({ msg: `run ${runId}: ${failure.code}, будет повтор`, runId, remarkId, projectId: trace.projectId, err: { name: err?.name, message: err?.message } });
        return { retry: failure };
      }
      // Окончательный сбой: прогон не дойдёт до persist, где учёт токенов забирают, — забираем сами, иначе запись течёт
      this.llm.takeUsage(runId);
      // Причина сбоя — со стеком в лог и человеческим текстом на карточку (аудит: no-error-tracking)
      this.log.error({ msg: `run ${runId} failed: ${failure.code}`, runId, remarkId, projectId: trace.projectId, failure: failure.code, err: { name: err?.name, message: err?.message, stack: err?.stack } });
      await this.remarks.failRun(runId, failure).catch(() => null);
      this.events.emit(remarkId, { type: 'run.failed', runId, message: failure.message });
      return {};
    } finally {
      exec.signal?.removeEventListener('abort', onOuterAbort);
      this.running.delete(runId);
      releaseGlobal();
      releaseProject();
      if (project.idle) this.projectSlots.delete(trace.projectId);
    }
  }

  /** Продолжить run из чекпоинта; если чекпоинта нет (seed, старые прогоны) — начать заново тем же runId. */
  private async resume(graph: TriageGraph | RetestGraph, remarkId: string, runId: string, decision: HumanDecision | RetestDecision, trace: RunTrace, fallback: TriageInput | undefined, exec: RunExec): Promise<RunOutcome> {
    const config = { configurable: { thread_id: runId } };
    let pending = false;
    try {
      const state = await (graph as TriageGraph).getState(config);
      pending = (state.next?.length ?? 0) > 0 || (state.tasks ?? []).some((t) => (t.interrupts?.length ?? 0) > 0);
    } catch (e) {
      this.log.warn(`getState ${runId}: ${(e as Error).message}`);
    }
    if (pending) return this.run(graph, remarkId, runId, new Command({ resume: decision }), trace, exec);
    if (fallback) return this.run(graph, remarkId, runId, fallback, { ...trace, resume: false }, exec);
    return {};
  }

  private async emitPersisted(ctx: ProjectContext, remarkId: string, runId: string): Promise<void> {
    let remarkStatus: RemarkStatus;
    try {
      remarkStatus = await this.remarks.statusOf(ctx, remarkId);
    } catch {
      return;
    }
    this.events.emit(remarkId, { type: 'run.persisted', runId, remarkStatus });
  }
}

/** Итог прогона для корня trace: без кадров, без токенов черновика — только то, что решает человек. */
function summarize(mode: RunTrace['mode'], state: Record<string, unknown>): Record<string, unknown> {
  if (mode === 'retest') return { strategy: state['strategy'] ?? null, result: state['result'] ?? null, diff: (state['diff'] as { regionText?: string } | null)?.regionText ?? null, decision: state['decision'] ?? null };
  return {
    proposedClass: state['proposedClass'] ?? null,
    duplicateOfNumber: state['duplicateOfNumber'] ?? null,
    binding: state['binding'] ?? null,
    chunkIds: state['chunkIds'] ?? [],
    rewriteCount: state['rewriteCount'] ?? 0,
    bindLoops: state['bindLoops'] ?? 0,
    faithfulnessIssue: state['faithfulnessIssue'] ?? null,
    injectionMatches: state['injectionMatches'] ?? [],
    rationale: state['rationale'] ?? [],
    decision: state['decision'] ?? null,
  };
}
