import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Command } from '@langchain/langgraph';
import type { RemarkStatus } from '@remarkround/db';
import { DiffService } from '../diff/diff.service';
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
import { buildRetestGraph, retestStrategyFromEnv, type RetestGraph, type RetestInput } from './retest.graph';
import { RunEvents, type Phase } from './run-events';
import { buildTriageGraph, type TriageGraph, type TriageInput } from './triage.graph';

export interface RunOptions {
  /** Дождаться interrupt/конца (импорт, тесты). По умолчанию прогон идёт в фоне, фазы — по WS. */
  wait?: boolean;
}

/** Прогоны, зависшие в `running` дольше этого после падения процесса, помечаются failed на старте. */
const STALE_RUN_MS = 10 * 60 * 1000;

/**
 * Оркестратор графа: старт прогона, продолжение по решению человека, отмена. Запись — только RemarksService,
 * граф — только LangGraph с чекпоинтом в Postgres (thread_id = AgentRun.id). REST и WS зовут одни и те же методы.
 */
@Injectable()
export class AgentService implements OnModuleInit {
  private readonly log = new Logger(AgentService.name);
  private triage!: TriageGraph;
  private retestGraph!: RetestGraph;
  private checkpointer!: PrismaCheckpointSaver;
  private readonly running = new Map<string, AbortController>();
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
  ) {}

  onModuleInit(): void {
    this.checkpointer = new PrismaCheckpointSaver(this.prisma);
    const deps: GraphDeps = { remarks: this.remarks, rag: this.rag, diff: this.diff, storage: this.storage, llm: this.llm, events: this.events };
    this.triage = buildTriageGraph(deps, this.checkpointer);
    this.retestGraph = buildRetestGraph(deps, this.checkpointer);
    void this.remarks
      .failStaleRuns(STALE_RUN_MS)
      .then((n) => n && this.log.warn(`stale runs marked failed: ${n}`))
      .catch((e: Error) => this.log.warn(`stale runs sweep: ${e.message}`));
  }

  get model(): string {
    return this.llm.model;
  }

  phaseOf(runId: string): Phase | undefined {
    return this.events.phaseOf(runId);
  }

  /** imported | cannot_tell | reopened → triaging → (граф) → awaiting_pm. Ответ — сразу, с runId; фазы идут в комнату. */
  async startTriage(ctx: ProjectContext, remarkId: string, opts: RunOptions = {}): Promise<RemarkView> {
    const { runId } = await this.remarks.beginTriage(ctx, remarkId, this.llm.model);
    const input: TriageInput = { projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, remarkId, runId, humanComment: null, excludeChunkIds: [] };
    const done = this.run(this.triage, remarkId, runId, input, this.trace(ctx, 'triage', runId, remarkId, false, { remarkId }));
    if (opts.wait) await done;
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
        excludeChunkIds: remark.citations.map((c) => c.chunkId),
      };
      const decision: HumanDecision = { kind: 'reject_binding', comment: dto.comment ?? '' };
      const done = this.resume(this.triage, remarkId, dto.runId, decision, this.trace(ctx, 'triage', dto.runId, remarkId, true, { verdict: dto.verdict, decision }), fallback);
      if (opts.wait) await done;
      return remark;
    }
    const decision: HumanDecision = dto.verdict === 'cannot_tell' ? { kind: 'request_screenshot' } : { kind: 'accept' };
    const done = this.resume(this.triage, remarkId, dto.runId, decision, this.trace(ctx, 'triage', dto.runId, remarkId, true, { verdict: dto.verdict, decision })).then(() => this.emitPersisted(ctx, remarkId, dto.runId));
    if (opts.wait) await done;
    return remark;
  }

  /** run.cancel: вердикта нет, run = cancelled; бегущий граф прерывается, чекпоинты снимаются. */
  async cancel(ctx: ProjectContext, remarkId: string, runId: string): Promise<RemarkView> {
    if (ctx.role !== 'pm' && ctx.role !== 'business') throw new ForbiddenException();
    this.running.get(runId)?.abort();
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
    const { runId } = await this.remarks.beginRetest(ctx, remarkId, screenshotKey, this.llm.model);
    const input: RetestInput = { projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, remarkId, runId, strategy: this.retestStrategy };
    const done = this.run(this.retestGraph, remarkId, runId, input, this.trace(ctx, 'retest', runId, remarkId, false, { remarkId, screenshotKey, strategy: this.retestStrategy }));
    if (opts.wait) await done;
    return this.remarks.get(ctx, remarkId);
  }

  async close(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const view = await this.remarks.close(ctx, remarkId);
    this.finishRetest(ctx, view, { kind: 'close' });
    return view;
  }

  async notFixed(ctx: ProjectContext, remarkId: string): Promise<RemarkView> {
    const view = await this.remarks.notFixed(ctx, remarkId);
    this.finishRetest(ctx, view, { kind: 'not_fixed' });
    return view;
  }

  private finishRetest(ctx: ProjectContext, view: RemarkView, decision: RetestDecision): void {
    if (!view.runId || view.runMode !== 'retest') return;
    const runId = view.runId;
    void this.resume(this.retestGraph, view.id, runId, decision, this.trace(ctx, 'retest', runId, view.id, true, { decision })).then(() => this.emitPersisted(ctx, view.id, runId));
  }

  /** Атрибуты trace Langfuse одного прогона: кто нажал, какое замечание, какой run (фаза 8). */
  private trace(ctx: ProjectContext, mode: RunTrace['mode'], runId: string, remarkId: string, resume: boolean, input: unknown): RunTrace {
    return { mode, runId, remarkId, projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, model: this.llm.model, resume, input };
  }

  // ---------- исполнение ----------

  /**
   * Один вызов графа = один корневой span в trace прогона (Langfuse, фаза 8): ноды графа под ним через CallbackHandler,
   * вызовы OpenAI и эмбеддинги — как generation / embedding. Ошибка прогона попадает в span, отмена — тоже.
   */
  private async run(graph: TriageGraph | RetestGraph, remarkId: string, runId: string, input: TriageInput | RetestInput | Command, trace: RunTrace): Promise<void> {
    const ac = new AbortController();
    this.running.set(runId, ac);
    try {
      await this.observability.run(trace, async (span) => {
        const state = await (graph as TriageGraph).invoke(input as TriageInput, {
          configurable: { thread_id: runId },
          signal: ac.signal,
          recursionLimit: 80,
          callbacks: this.observability.callbacks(trace),
        });
        span.update({ output: summarize(trace.mode, state as Record<string, unknown>) });
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      const message = (e as Error).message ?? String(e);
      this.log.error(`run ${runId} failed: ${message}`);
      await this.remarks.failRun(runId).catch(() => null);
      this.events.emit(remarkId, { type: 'run.failed', runId, message: 'Не получилось разобрать. Можно запустить снова' });
    } finally {
      this.running.delete(runId);
    }
  }

  /** Продолжить run из чекпоинта; если чекпоинта нет (seed, старые прогоны) — начать заново тем же runId. */
  private async resume(graph: TriageGraph | RetestGraph, remarkId: string, runId: string, decision: HumanDecision | RetestDecision, trace: RunTrace, fallback?: TriageInput): Promise<void> {
    const config = { configurable: { thread_id: runId } };
    let pending = false;
    try {
      const state = await (graph as TriageGraph).getState(config);
      pending = (state.next?.length ?? 0) > 0 || (state.tasks ?? []).some((t) => (t.interrupts?.length ?? 0) > 0);
    } catch (e) {
      this.log.warn(`getState ${runId}: ${(e as Error).message}`);
    }
    if (pending) return this.run(graph, remarkId, runId, new Command({ resume: decision }), trace);
    if (fallback) return this.run(graph, remarkId, runId, fallback, { ...trace, resume: false });
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
