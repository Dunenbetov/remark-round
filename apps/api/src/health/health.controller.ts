import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { config } from '../config';
import { JobsService, type JobStats } from '../jobs/jobs.service';
import { LlmService } from '../llm/llm.service';
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
}

const DB_TIMEOUT_MS = 2000;

/** Health для compose и балансировщика: живой процесс без базы — 503, а не «ok». */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly rag: RagService,
    private readonly jobs: JobsService,
  ) {}

  @Public()
  @Get()
  async health(): Promise<HealthView> {
    const base = { version: config().APP_VERSION, llm: this.llm.mode, vectorIndex: this.rag.vectorIndexStatus };
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
