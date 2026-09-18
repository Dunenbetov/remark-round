import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma, type Job } from '@remarkround/db';

/** Что воркеру нужно от взятой задачи (RETURNING claim'а). */
type ClaimedJob = Pick<Job, 'id' | 'kind' | 'payload' | 'projectId' | 'runId' | 'attempts' | 'maxAttempts'>;
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

/**
 * Лимиты вида задач (аудит беты R-B2, head-of-line blocking): очередь не берёт задачу, если её вид или пара
 * (вид, проект) уже занимает столько слотов. Импорт на 200 строк ставит 200 прогонов одного проекта — при
 * `maxPerProject: 2` два идут, остальные ждут в очереди, а индексация и прогоны других проектов не стоят.
 * Считается по памяти процесса: один инстанс API (docs/PROD.md), второй удвоил бы лимиты.
 */
export interface JobKindOptions {
  /** Сколько задач этого вида одновременно во всём процессе. */
  maxConcurrent?: number;
  /** Сколько задач этого вида одновременно на один projectId; задачи без проекта лимит не считают. */
  maxPerProject?: number;
}

interface ActiveJob {
  ac: AbortController;
  kind: string;
  projectId: string | null;
}

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

/** Такой lockedAt — задача осиротела (процесс упал, не дописав): вернуть в очередь. Живой воркер обновляет lockedAt каждые HEARTBEAT_MS. */
const STALE_LOCK_MS = 60_000;
const HEARTBEAT_MS = 15_000;
/**
 * Сметание сирот по таймеру, а не только на старте (P2, аудит 18.09 §3.1). На Railway новый контейнер стартует
 * раньше, чем гасится старый: на его старте задачи старого ещё свежие (heartbeat), а через минуту старого убили.
 * Раньше такие задачи висели `running` до следующего деплоя; теперь их вернёт ближайший тик — через 60–120 с.
 */
const STALE_SWEEP_MS = 60_000;
/** Чистка завершённых задач — раз в сутки (и на старте). */
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
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
  private readonly options = new Map<string, JobKindOptions>();
  /** Слотов больше, чем прогонов графа (GRAPH_MAX_CONCURRENT): индексация документов не ждёт модель. */
  private readonly concurrency = Number(process.env['JOBS_CONCURRENCY'] ?? 8);
  private readonly pollMs = Number(process.env['JOBS_POLL_MS'] ?? 500);
  private readonly active = new Map<string, ActiveJob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private prune: ReturnType<typeof setInterval> | null = null;
  private staleSweep: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private stopped = false;
  private polling = false;
  /** Пока шёл опрос, освободился слот: следующий опрос — сразу, а не через pollMs. */
  private wake = false;

  constructor(private readonly prisma: PrismaService) {}

  register(kind: string, handler: JobHandler, options: JobKindOptions = {}): void {
    this.handlers.set(kind, handler);
    this.options.set(kind, options);
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
    // Срок хранения завершённых задач держится не только стартом процесса (R-M2): api под restart: always живёт месяцами
    if (config().NODE_ENV !== 'test') {
      this.prune = setInterval(() => void this.pruneFinished().then((n) => n && this.log.log(`jobs: удалено ${n} завершённых задач старше срока хранения`)).catch(() => null), PRUNE_EVERY_MS);
      this.prune.unref();
      // В тестах таймер не заводится сам: спеки на общей БД вызывают requeueStale / startStaleSweep явно
      this.startStaleSweep();
    }
    this.schedule(0);
  }

  /**
   * Раз в `everyMs` вернуть осиротевшие задачи в очередь (requeueStale). Один UPDATE по индексу status — дёшево;
   * идемпотентно: вторая сметка ту же задачу уже не найдёт (она queued), пересекающиеся тики пропускаются.
   * Возвращает остановку таймера (спеки).
   */
  startStaleSweep(everyMs = STALE_SWEEP_MS): () => void {
    if (this.staleSweep) clearInterval(this.staleSweep);
    const timer = setInterval(() => void this.sweepStale(), everyMs);
    timer.unref();
    this.staleSweep = timer;
    return () => {
      clearInterval(timer);
      if (this.staleSweep === timer) this.staleSweep = null;
    };
  }

  private async sweepStale(): Promise<void> {
    if (this.sweeping || this.stopped) return;
    this.sweeping = true;
    try {
      const n = await this.requeueStale();
      if (n) {
        this.log.warn(`jobs: ${n} осиротевших задач возвращены в очередь`);
        this.schedule(0);
      }
    } catch (e) {
      this.log.warn(`jobs: stale sweep failed: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** SIGTERM: не брать новое, дать активным дописать до 25 с (stop_grace_period 90 с), остальное — назад в очередь. */
  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.prune) clearInterval(this.prune);
    if (this.staleSweep) clearInterval(this.staleSweep);
    const started = Date.now();
    while (this.active.size && Date.now() - started < 25_000) await new Promise((r) => setTimeout(r, 200));
    if (!this.active.size) return;
    this.log.warn(`jobs: ${this.active.size} задач не успели — возвращаю в очередь`);
    for (const [id, { ac }] of this.active) {
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

  /**
   * Осиротевшие running (процесс упал, heartbeat стих) → queued. Задачу с живым воркером не трогает: heartbeat
   * держит её lockedAt моложе 15 с (порог — 60 с), а задачи своего процесса исключены явно — даже если heartbeat
   * пропустил тики (база недоступна минуту), своя бегущая задача не уйдёт второму исполнителю.
   */
  async requeueStale(): Promise<number> {
    const own = [...this.active.keys()];
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'running', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) }, ...(own.length ? { id: { notIn: own } } : {}) },
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
    // Опрос уже идёт: его finally перезапустит таймер; запомним, что ждать pollMs не нужно
    if (this.polling && delay === 0) {
      this.wake = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      // `active` пополняется синхронно в execute(), поэтому каждый следующий claim видит уже занятые слоты
      while (!this.stopped && this.active.size < this.concurrency) {
        const job = await this.claim();
        if (!job) break;
        void this.execute(job);
      }
    } catch (e) {
      this.log.warn(`jobs: poll failed: ${(e as Error).message}`);
    } finally {
      this.polling = false;
      const delay = this.wake ? 0 : this.pollMs;
      this.wake = false;
      this.schedule(delay);
    }
  }

  /**
   * Одна задача под блокировкой строки одним запросом (без BEGIN/COMMIT туда-обратно): два воркера
   * (второй инстанс, тесты) не возьмут одну и ту же — `FOR UPDATE SKIP LOCKED` пропускает занятую строку.
   * Насыщенные виды и пары (вид, проект) пропускаются прямо в WHERE (R-B2): задача ждёт в `queued`,
   * попытка не сгорает, слот воркера не занят ожиданием семафора.
   */
  private async claim(): Promise<ClaimedJob | null> {
    const onlyOwn = config().NODE_ENV === 'test';
    const { kinds, pairs } = this.saturated();
    const kindFilter = kinds.length ? Prisma.sql`AND "kind" NOT IN (${Prisma.join(kinds)})` : Prisma.empty;
    // Row-value NOT IN с NULL даёт NULL — без `"projectId" IS NULL OR` задача без проекта не бралась бы никогда
    const pairFilter = pairs.length
      ? Prisma.sql`AND ("projectId" IS NULL OR ("kind", "projectId") NOT IN (${Prisma.join(pairs.map(([kind, projectId]) => Prisma.sql`(${kind}, ${projectId})`))}))`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET "status" = 'running', "lockedAt" = now(), "lockedBy" = ${this.instanceId}, "attempts" = "attempts" + 1, "updatedAt" = now()
      WHERE "id" = (
        SELECT "id" FROM "Job"
        WHERE "status" = 'queued' AND "runAfter" <= now()
          AND (${!onlyOwn}::boolean OR "owner" = ${this.instanceId})
          ${kindFilter}
          ${pairFilter}
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
      RETURNING "id", "kind", "payload", "projectId", "runId", "attempts", "maxAttempts"`;
    return rows[0] ?? null;
  }

  /** Виды и пары (вид, проект), у которых занято не меньше лимита: их задачи в этом claim'е не берём. */
  private saturated(): { kinds: string[]; pairs: Array<[string, string]> } {
    const byKind = new Map<string, number>();
    const byPair = new Map<string, number>();
    for (const { kind, projectId } of this.active.values()) {
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
      if (projectId) byPair.set(`${kind}\0${projectId}`, (byPair.get(`${kind}\0${projectId}`) ?? 0) + 1);
    }
    const kinds: string[] = [];
    for (const [kind, n] of byKind) {
      const max = this.options.get(kind)?.maxConcurrent;
      if (max && n >= max) kinds.push(kind);
    }
    const pairs: Array<[string, string]> = [];
    for (const [key, n] of byPair) {
      const [kind, projectId] = key.split('\0') as [string, string];
      const max = this.options.get(kind)?.maxPerProject;
      if (max && n >= max) pairs.push([kind, projectId]);
    }
    return { kinds, pairs };
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const ac = new AbortController();
    this.active.set(job.id, { ac, kind: job.kind, projectId: job.projectId });
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
