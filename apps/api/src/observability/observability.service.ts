import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { CallbackHandler } from '@langfuse/langchain';
import { observeOpenAI } from '@langfuse/openai';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startActiveObservation, type LangfuseSpan } from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createHash } from 'node:crypto';
import type OpenAI from 'openai';
import type { LlmCallMeta } from '../llm/triage-llm';

/** Langfuse ходит по этому адресу из API (в compose — `http://langfuse-web:3000`), ссылку человеку даём по публичному. */
const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_PROJECT_ID = 'remarkround';

/** Что нужно, чтобы прогон графа лёг в Langfuse одним трейсом: thread графа = AgentRun = trace. */
export interface RunTrace {
  mode: 'triage' | 'retest';
  runId: string;
  remarkId: string;
  projectId: string;
  userId: string;
  role: string;
  model: string;
  /** Продолжение после interrupt (вердикт PM, закрытие бизнесом): тот же trace, новый корневой span. */
  resume: boolean;
  /** Вход прогона — что показать в корне трейса (без кадров и без токенов). */
  input: unknown;
}

/**
 * ObservabilityModule (REMARKROUND.md §7.1, docs/ENGINEERING.md паттерн 3): Langfuse на каждый LLM-вызов.
 *
 * Как устроено: OpenTelemetry-провайдер регистрируется один раз на процесс; span'ы летят в Langfuse батчами.
 * Один `AgentRun` = один trace (traceId детерминирован из runId, поэтому продолжение после interrupt —
 * из другого HTTP-запроса, через часы — попадает в тот же trace). Внутри: ноды графа (CallbackHandler LangGraph),
 * generation-span на каждый вызов OpenAI (модель, параметры, токены, стрим), embedding-span на каждый
 * вызов эмбеддингов, retriever-span на поиск по pgvector. Trace несёт userId (кто нажал), sessionId = remarkId
 * (все прогоны одного замечания — одна сессия), теги `triage` / `retest` и metadata projectId / remarkId / runId.
 *
 * Без ключей (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`) или с `LANGFUSE_TRACING_ENABLED=false`
 * модуль молчит: span'ы не создаются (noop-tracer OpenTelemetry), код нод не меняется. Тесты идут так.
 */
@Injectable()
export class ObservabilityService implements OnApplicationShutdown {
  private readonly log = new Logger(ObservabilityService.name);
  readonly enabled: boolean;
  private readonly publicUrl: string;
  private readonly projectId: string;
  private processor: LangfuseSpanProcessor | null = null;
  private provider: NodeTracerProvider | null = null;

  constructor() {
    const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
    const secretKey = process.env['LANGFUSE_SECRET_KEY'];
    const baseUrl = process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'] ?? DEFAULT_BASE_URL;
    this.publicUrl = (process.env['LANGFUSE_PUBLIC_URL'] ?? baseUrl).replace(/\/$/, '');
    this.projectId = process.env['LANGFUSE_PROJECT_ID'] ?? DEFAULT_PROJECT_ID;
    const off = process.env['LANGFUSE_TRACING_ENABLED'] === 'false';
    this.enabled = Boolean(publicKey && secretKey) && !off;
    if (!this.enabled) {
      this.log.log(off ? 'langfuse: выключен (LANGFUSE_TRACING_ENABLED=false)' : 'langfuse: ключей нет, трейсы не пишутся');
      return;
    }
    this.processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment: process.env['LANGFUSE_TRACING_ENVIRONMENT'] ?? 'local',
      flushAt: 20,
      flushInterval: 2,
    });
    this.provider = new NodeTracerProvider({ spanProcessors: [this.processor] });
    this.provider.register();
    this.log.log(`langfuse: ${baseUrl}, проект ${this.projectId}, ссылки на ${this.publicUrl}`);
  }

  /** 32 hex из runId: одинаков при старте и при продолжении прогона, поэтому оба ложатся в один trace. */
  static traceIdOf(runId: string): string {
    return createHash('sha256').update(runId).digest('hex').slice(0, 32);
  }

  /** Ссылка на trace прогона в UI Langfuse — для карточки («Трейс в Langfuse») и защиты. */
  traceUrl(runId: string): string | undefined {
    if (!this.enabled) return undefined;
    return `${this.publicUrl}/project/${this.projectId}/traces/${ObservabilityService.traceIdOf(runId)}`;
  }

  /**
   * Корневой span прогона (или его продолжения) + атрибуты trace, которые унаследуют все вложенные span'ы:
   * ноды графа, generation'ы OpenAI, embedding'и. Ошибка прогона попадает в span и летит дальше.
   */
  async run<T>(trace: RunTrace, fn: (span: LangfuseSpan) => Promise<T>): Promise<T> {
    if (!this.enabled) return fn(noopSpan);
    const traceId = ObservabilityService.traceIdOf(trace.runId);
    const name = trace.resume ? `${trace.mode}.resume` : trace.mode;
    const metadata = { projectId: trace.projectId, remarkId: trace.remarkId, runId: trace.runId, role: trace.role, model: trace.model };
    return startActiveObservation(
      name,
      (span) =>
        propagateAttributes({ traceName: trace.mode, userId: trace.userId, sessionId: trace.remarkId, tags: [trace.mode, ...(trace.resume ? ['resume'] : [])], metadata }, async () => {
          // Родитель фиктивный (см. ниже), поэтому Langfuse просим считать этот span корнем trace.
          span.otelSpan.setAttribute(AS_ROOT_ATTRIBUTE, true);
          span.update({ input: trace.input, metadata });
          return fn(span);
        }),
      // traceId задаётся только через родительский контекст: у старта и у продолжения он один — из runId.
      { asType: 'agent', parentSpanContext: { traceId, spanId: trace.resume ? RESUME_PARENT_SPAN_ID : ROOT_PARENT_SPAN_ID, traceFlags: 1 } },
    );
  }

  /** Ноды LangGraph как span'ы под корнем прогона: видно циклы rewrite / bind и interrupt. */
  callbacks(trace: Pick<RunTrace, 'userId' | 'remarkId' | 'mode' | 'projectId' | 'runId'>): CallbackHandler[] {
    if (!this.enabled) return [];
    return [new CallbackHandler({ userId: trace.userId, sessionId: trace.remarkId, tags: [trace.mode], traceMetadata: { projectId: trace.projectId, runId: trace.runId } })];
  }

  /** Клиент OpenAI, у которого каждый `chat.completions.create` — generation-span с именем ноды и метаданными прогона. */
  openai(client: OpenAI, meta: LlmCallMeta): OpenAI {
    if (!this.enabled) return client;
    return observeOpenAI(client, { generationName: meta.node, generationMetadata: { node: meta.node, runId: meta.runId, remarkId: meta.remarkId, projectId: meta.projectId } });
  }

  async flush(): Promise<void> {
    await this.processor?.forceFlush();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.provider?.shutdown().catch((e: Error) => this.log.warn(`langfuse shutdown: ${e.message}`));
  }
}

/**
 * Langfuse принимает span с родителем, которого нет: тогда span рисуется на верхнем уровне trace.
 * Так и первый прогон, и продолжения оказываются в trace с id из runId, а не в случайном.
 */
const ROOT_PARENT_SPAN_ID = '0000000000000001';
const RESUME_PARENT_SPAN_ID = '0000000000000002';
/** `LangfuseOtelSpanAttributes.AS_ROOT`: сервер Langfuse берёт имя, userId и сессию trace из такого span'а. */
const AS_ROOT_ATTRIBUTE = 'langfuse.internal.as_root';

/** Без Langfuse ноды получают «пустой» span: те же вызовы `update`, ничего не происходит. */
const noopSpan = { update: () => noopSpan, end: () => undefined } as unknown as LangfuseSpan;
