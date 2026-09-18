import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { config } from '../config';
import { JobsService, RetryJobError } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { offsiteSettings, parseRcloneStats, rcloneArgs, rcloneEnv, type OffsiteSettings, type RcloneCounts } from './offsite';

export const OFFSITE_JOB = 'offsite_copy';
const EVERY_MS = 24 * 60 * 60 * 1000;
/** Первая копия — через пару минут после старта: миграции и healthcheck деплоя важнее. */
const FIRST_DELAY_MS = 2 * 60 * 1000;
/** Потолок одного прохода: первый (весь том) — самый долгий, дальше копируется только новое. */
const TIMEOUT_MS = Number(process.env['OFFSITE_TIMEOUT_MS'] ?? 30 * 60 * 1000);

/**
 * Раз в сутки копирует STORAGE_DIR в Backblaze B2 (`b2:<бакет>/storage/`) — задача A3, аудит R-M3; runbook —
 * docs/PROD-RAILWAY.md, шаг 9. Задача идёт через общую очередь (JobsService): повтор при сбое сети, видна в /health → jobs.
 * Расписание — как у суточных чисток (R-M2): setInterval + постановка на старте; Railway перезапускает api на каждом деплое,
 * поэтому копия на старте — не лишняя, а повторный проход дешёвый (копируется только новое).
 */
@Injectable()
export class OffsiteService implements OnModuleInit {
  private readonly log = new Logger(OffsiteService.name);
  private readonly settings: OffsiteSettings | null = offsiteSettings(config());

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  get enabled(): boolean {
    return this.settings !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.settings) {
      if (config().isProduction) this.log.warn('offsite: копия файлов вне сервера не настроена (OFFSITE_B2_* не заданы) — документы и кадры живут только на томе');
      return;
    }
    this.jobs.register(OFFSITE_JOB, (_payload, ctx) => this.copy(ctx.signal).then(() => undefined), { maxConcurrent: 1 });
    // В тестах много стендов на одной БД и rclone нет — расписание не заводим
    if (config().NODE_ENV === 'test') return;
    await this.enqueueOnce(FIRST_DELAY_MS).catch((e: Error) => this.log.warn(`offsite: не удалось поставить копию в очередь: ${e.message}`));
    setInterval(() => void this.enqueueOnce(0).catch((e: Error) => this.log.warn(`offsite: не удалось поставить копию в очередь: ${e.message}`)), EVERY_MS).unref();
    this.log.log(`offsite: копия файлов вне сервера включена — бакет ${this.settings.bucket}, раз в сутки`);
  }

  /** Частые деплои не должны копить задачи: если копия уже ждёт или идёт, вторую не ставим. */
  private async enqueueOnce(delayMs: number): Promise<void> {
    const waiting = await this.prisma.job.count({ where: { kind: OFFSITE_JOB, status: { in: ['queued', 'running'] } } });
    if (!waiting) await this.jobs.enqueue(OFFSITE_JOB, {}, { delayMs, maxAttempts: 3 });
  }

  /** Один проход rclone. Ненулевой код выхода или таймаут — повтор задачи с паузой очереди. */
  async copy(signal?: AbortSignal): Promise<RcloneCounts> {
    const s = this.settings;
    if (!s) throw new Error('offsite: копия не настроена');
    const started = Date.now();
    const { code, output, timedOut } = await run('rclone', rcloneArgs(s, this.storage.root), rcloneEnv(s), TIMEOUT_MS, signal);
    const counts = parseRcloneStats(output);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (signal?.aborted) throw new Error('offsite: прервано остановкой процесса');
    if (timedOut) throw new RetryJobError(`offsite: rclone не уложился в ${Math.round(TIMEOUT_MS / 60_000)} мин (загружено ${counts.copied}) — следующий проход продолжит`);
    if (code !== 0) throw new RetryJobError(`offsite: rclone завершился с кодом ${code}, ошибок ${counts.errors}: ${tail(output)}`);
    this.log.log(`offsite: копия файлов готова — загружено ${counts.copied}, уже было ${counts.checked}, ошибок ${counts.errors}, ${seconds} с`);
    return counts;
  }
}

/** Хвост вывода rclone для сообщения об ошибке: секреты туда не попадают (rclone их не печатает, в аргументах их нет). */
function tail(output: string): string {
  return output.trim().split('\n').slice(-3).join(' | ').slice(0, 500);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    // Сводка — в конце вывода: держим только хвост, чтобы тысячи строк об ошибках не съели память
    const keep = (chunk: Buffer) => (output = (output + chunk.toString('utf8')).slice(-16_384));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    timer.unref();
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (e) => {
      done();
      reject(new Error(`offsite: rclone не запустился (${e.message}) — он должен быть в образе api (apps/api/Dockerfile)`));
    });
    child.on('close', (code) => {
      done();
      resolve({ code, output, timedOut });
    });
  });
}
