import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { sentryEnabled } from '../instrument';
import { config } from '../config';
import { JobsService, type JobStats } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
import { ObservabilityService, type TracingStatus } from '../observability/observability.service';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';

export interface HealthView {
  ok: boolean;
  db: 'ok' | 'down';
  /** Версия сборки (APP_VERSION из образа): ответ на «какая версия на сервере». */
  version: string;
  /** Чем работает граф: `rules` — черновики по правилам без модели (в production только по LLM_MODE=rules). */
  llm: 'openai' | 'rules';
  /** HNSW-индекс pgvector на месте: `missing` — retrieve полным сканом, см. packages/db/README.md. */
  vectorIndex: 'ok' | 'missing' | 'unknown';
  /** Очередь фоновых задач: сколько ждёт и сколько выполняется (все инстансы). */
  jobs: JobStats;
  /**
   * Трейсы Langfuse: `on` — span'ы идут в наш процессор Langfuse; `degraded` — ключи заданы, но провайдер
   * OpenTelemetry не наш (span'ы не доедут, причина — в логе `langfuse:` / `otel:`); `off` — ключей нет
   * или LANGFUSE_TRACING_ENABLED=false. Отказ самого Langfuse (401, сеть) виден только в логе `otel:` и в UI.
   */
  tracing: TracingStatus;
  /** Sentry (R-L5): `on`, если задан SENTRY_DSN. */
  sentry: 'on' | 'off';
}

const DB_TIMEOUT_MS = 2000;

/**
 * Health для compose и балансировщика: живой процесс без базы — 503, а не «ok».
 * Без лимита запросов (R-H5): healthcheck compose каждые 10 с, uptime-монитор и alerts.sh идут с одного адреса.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly rag: RagService,
    private readonly jobs: JobsService,
    private readonly observability: ObservabilityService,
  ) {}

  @Public()
  @Get()
  async health(): Promise<HealthView> {
    const base = { version: config().APP_VERSION, llm: this.llm.mode, vectorIndex: this.rag.vectorIndexStatus, tracing: this.observability.tracingStatus(), sentry: sentryEnabled ? ('on' as const) : ('off' as const) };
    let jobs: JobStats = { queued: -1, running: -1 };
    try {
      jobs = (await Promise.race([
        this.jobs.stats(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS).unref()),
      ])) as JobStats;
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down', ...base, jobs } satisfies HealthView);
    }
    return { ok: true, db: 'ok', ...base, jobs };
  }
}
