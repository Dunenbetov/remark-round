import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma, type Job } from '@remarkround/db';

/** Что воркеру нужно от взятой задачи (RETURNING claim'а). */
type ClaimedJob = Pick<Job, 'id' | 'kind' | 'payload' | 'runId' | 'attempts' | 'maxAttempts'>;
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export interface JobContext {
  /** 1 — первая попытка. Обработчик графа на повторе чистит чекпоинты и стартует заново. */
  attempt: number;
  maxAttempts: number;
  /** Остановка процесса (SIGTERM): прервать работу; задача вернётся в очередь. */
  signal: AbortSignal;
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

/** Обработчик просит повтор (временная ошибка модели): задача вернётся в очередь с паузой. */
export class RetryJobError extends Error {
  constructor(
    message: string,
    readonly delayMs?: number,
  ) {
    super(message);
  }
}

export interface EnqueueOptions {
  projectId?: string;
  runId?: string;
  maxAttempts?: number;
  delayMs?: number;
  /** Поставить задачу в той же транзакции, что и доменную запись: откат отменит и её, коммит — сделает видимой воркеру. */
  tx?: Prisma.TransactionClient;
}

export interface JobStats {
  queued: number;
  running: number;
}

/** Такой lockedAt — задача осиротела (процесс упал, не дописав): вернуть в очередь. */
const STALE_LOCK_MS = 60_000;
const HEARTBEAT_MS = 15_000;
/** Пауза перед повтором: 30 с, 2 мин, 8 мин — модель «перегружена» редко проходит за секунды. Тесты укорачивают через JOBS_BACKOFF_MS. */
const BACKOFF_MS: number[] = (process.env['JOBS_BACKOFF_MS'] ?? '30000,120000,480000').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v >= 0);
if (!BACKOFF_MS.length) BACKOFF_MS.push(30_000);

/**
 * Очередь фоновых задач в той же Postgres (аудит: no-job-queue). Один воркер в каждом процессе API берёт задачи
 * `SELECT … FOR UPDATE SKIP LOCKED`, держит heartbeat, повторяет временные ошибки с паузой и при остановке процесса
 * возвращает недоделанное в очередь. Обработчики регистрируют модули-владельцы (AgentService — `graph`,
 * RagService — `index_document`): очередь не знает домена, домен не знает очереди.
 * В NODE_ENV=test воркер берёт только задачи своего инстанса: спеки поднимают много приложений на одной БД.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(JobsService.name);
  readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, JobHandler>();
  private readonly concurrency = Number(process.env['JOBS_CONCURRENCY'] ?? 4);
  private readonly pollMs = Number(process.env['JOBS_POLL_MS'] ?? 500);
  private readonly active = new Map<string, AbortController>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async onModuleInit(): Promise<void> {
    // Сироты прошлого процесса (упал, не дописав) — обратно в очередь; в тестах у каждого стенда своя очередь по owner
    if (config().NODE_ENV !== 'test') {
      const n = await this.requeueStale();
      if (n) this.log.warn(`jobs: ${n} осиротевших задач возвращены в очередь`);
      const gone = await this.pruneFinished();
      if (gone) this.log.log(`jobs: удалено ${gone} завершённых задач старше срока хранения`);
    }
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
    this.schedule(0);
  }

  /** SIGTERM: не брать новое, дать активным дописать до 25 с (stop_grace_period 90 с), остальное — назад в очередь. */
  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    const started = Date.now();
    while (this.active.size && Date.now() - started < 25_000) await new Promise((r) => setTimeout(r, 200));
    if (!this.active.size) return;
    this.log.warn(`jobs: ${this.active.size} задач не успели — возвращаю в очередь`);
    for (const [id, ac] of this.active) {
      ac.abort();
      await this.prisma.job.updateMany({ where: { id, status: 'running' }, data: { status: 'queued', lockedAt: null, lockedBy: null } }).catch(() => null);
    }
  }

  async enqueue(kind: string, payload: unknown, opts: EnqueueOptions = {}): Promise<Job> {
    const job = await (opts.tx ?? this.prisma).job.create({
      data: {
        kind,
        payload: payload as Prisma.InputJsonValue,
        projectId: opts.projectId ?? null,
        runId: opts.runId ?? null,
        maxAttempts: opts.maxAttempts ?? 3,
        runAfter: new Date(Date.now() + (opts.delayMs ?? 0)),
        owner: this.instanceId,
      },
    });
    // В транзакции строка видна воркеру только после коммита: ближайший опрос (JOBS_POLL_MS) её подхватит
    this.schedule(opts.tx ? this.pollMs : 0);
    return job;
  }

  /** run.cancel: ещё не начатые задачи прогона снимаются; начатую прерывает AgentService через свой AbortController. */
  async cancelByRun(runId: string): Promise<number> {
    const { count } = await this.prisma.job.updateMany({ where: { runId, status: 'queued' }, data: { status: 'cancelled', finishedAt: new Date() } });
    return count;
  }

  async stats(): Promise<JobStats> {
    const [queued, running] = await Promise.all([this.prisma.job.count({ where: { status: 'queued' } }), this.prisma.job.count({ where: { status: 'running' } })]);
    return { queued, running };
  }

  /** Осиротевшие running (процесс упал, heartbeat стих) → queued; попытка не сгорает. */
  async requeueStale(): Promise<number> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'running', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: 'queued', lockedAt: null, lockedBy: null },
    });
    return count;
  }

  /** Срок хранения завершённых задач: done/cancelled — 30 дней, failed — 90 (с lastError, для разбора). Таблица не растёт вечно. */
  async pruneFinished(now = new Date()): Promise<number> {
    const day = 24 * 60 * 60 * 1000;
    const [a, b] = await Promise.all([
      this.prisma.job.deleteMany({ where: { status: { in: ['done', 'cancelled'] }, finishedAt: { lt: new Date(now.getTime() - 30 * day) } } }),
      this.prisma.job.deleteMany({ where: { status: 'failed', finishedAt: { lt: new Date(now.getTime() - 90 * day) } } }),
    ]);
    return a.count + b.count;
  }

  // ---------- воркер ----------

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      while (!this.stopped && this.active.size < this.concurrency) {
        const job = await this.claim();
        if (!job) break;
        void this.execute(job);
      }
    } catch (e) {
      this.log.warn(`jobs: poll failed: ${(e as Error).message}`);
    } finally {
      this.polling = false;
      this.schedule(this.pollMs);
    }
  }

  /**
   * Одна задача под блокировкой строки одним запросом (без BEGIN/COMMIT туда-обратно): два воркера
   * (второй инстанс, тесты) не возьмут одну и ту же — `FOR UPDATE SKIP LOCKED` пропускает занятую строку.
   */
  private async claim(): Promise<ClaimedJob | null> {
    const onlyOwn = config().NODE_ENV === 'test';
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET "status" = 'running', "lockedAt" = now(), "lockedBy" = ${this.instanceId}, "attempts" = "attempts" + 1, "updatedAt" = now()
      WHERE "id" = (
        SELECT "id" FROM "Job"
        WHERE "status" = 'queued' AND "runAfter" <= now()
          AND (${!onlyOwn}::boolean OR "owner" = ${this.instanceId})
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
      RETURNING "id", "kind", "payload", "runId", "attempts", "maxAttempts"`;
    return rows[0] ?? null;
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const ac = new AbortController();
    this.active.set(job.id, ac);
    const handler = this.handlers.get(job.kind);
    try {
      if (!handler) throw new Error(`нет обработчика для задачи ${job.kind}`);
      await handler(job.payload, { attempt: job.attempts, maxAttempts: job.maxAttempts, signal: ac.signal });
      if (ac.signal.aborted) return; // остановка: onApplicationShutdown вернул задачу в очередь
      await this.prisma.job.update({ where: { id: job.id }, data: { status: 'done', finishedAt: new Date(), lockedAt: null } });
    } catch (e) {
      if (ac.signal.aborted) return;
      const err = e as Error;
      const retry = e instanceof RetryJobError && job.attempts < job.maxAttempts;
      if (retry) {
        const delay = (e as RetryJobError).delayMs ?? BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)]!;
        this.log.warn({ msg: `job ${job.kind} ${job.id}: повтор ${job.attempts}/${job.maxAttempts} через ${Math.round(delay / 1000)} с — ${err.message}`, jobId: job.id, runId: job.runId });
        await this.prisma.job.update({ where: { id: job.id }, data: { status: 'queued', runAfter: new Date(Date.now() + delay), lockedAt: null, lockedBy: null, lastError: err.message } }).catch(() => null);
      } else {
        this.log.error({ msg: `job ${job.kind} ${job.id} failed: ${err.message}`, jobId: job.id, runId: job.runId, err: { name: err.name, message: err.message, stack: err.stack } });
        await this.prisma.job.update({ where: { id: job.id }, data: { status: 'failed', finishedAt: new Date(), lockedAt: null, lastError: err.message } }).catch(() => null);
      }
    } finally {
      this.active.delete(job.id);
      this.schedule(0);
    }
  }

  private async beat(): Promise<void> {
    if (!this.active.size) return;
    await this.prisma.job.updateMany({ where: { id: { in: [...this.active.keys()] }, status: 'running' }, data: { lockedAt: new Date() } }).catch(() => null);
  }
}
