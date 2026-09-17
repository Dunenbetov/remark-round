import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';

/** `<projectId>/<uuid>.<ext>` — единственная форма ключа, которую выдаёт save(). */
const KEY = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.[a-z0-9]{1,5}$/;
const MB = 1024 * 1024;
/** Сумма файлов проекта считается сканом каталога (размер кадра в БД не хранится) и кэшируется на минуту. */
const USAGE_CACHE_MS = 60_000;

export const STORAGE_FULL = 'На сервере кончается место — сообщите администратору';
export const PROJECT_QUOTA = 'Проект исчерпал квоту на файлы — сообщите администратору';

/** 507 с кодом `storage_full`: место кончается или проект выбрал квоту (аудит беты R-H4). */
export class StorageFullException extends HttpException {
  constructor(message: string) {
    super({ code: 'storage_full', message }, 507);
  }
}

/**
 * Файлы пакета документов и скринов на диске. Ключ — путь относительно STORAGE_DIR,
 * первый сегмент всегда projectId: файлы одного проекта не лежат рядом с чужими.
 * Перед записью — проверка места (R-H4): ENOSPC ронял бы каждый кадр и Postgres на том же диске; квота на проект —
 * чтобы один импорт кадров не съел диск всем. Пороги читаются из env при каждом вызове: STORAGE_MIN_FREE_MB (2048),
 * STORAGE_QUOTA_MB_PER_PROJECT (2048; 0 — без квоты).
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  readonly root = resolve(process.env['STORAGE_DIR'] ?? join(process.cwd(), 'storage'));
  private readonly usage = new Map<string, { bytes: number; at: number }>();

  async save(projectId: string, originalName: string, data: Buffer): Promise<string> {
    await this.assertRoom(projectId, data.length);
    const ext = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const key = `${projectId}/${randomUUID()}${ext}`;
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    const cached = this.usage.get(projectId);
    if (cached) cached.bytes += data.length;
    return key;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.path(storageKey));
  }

  /** Ключ из тела запроса (screenshotKey) принимается, только если он этого проекта и той же формы, что даёт save(). */
  belongsTo(projectId: string, storageKey: string): boolean {
    return KEY.test(storageKey) && storageKey.startsWith(`${projectId}/`);
  }

  /** Сколько байт занимают файлы проекта (кэш на минуту). */
  async projectUsage(projectId: string): Promise<number> {
    const cached = this.usage.get(projectId);
    if (cached && Date.now() - cached.at < USAGE_CACHE_MS) return cached.bytes;
    let bytes = 0;
    try {
      const dir = join(this.root, projectId);
      for (const name of await readdir(dir)) {
        try {
          bytes += (await stat(join(dir, name))).size;
        } catch {
          // файл убрали параллельно — не считаем
        }
      }
    } catch {
      bytes = 0; // каталога проекта ещё нет
    }
    this.usage.set(projectId, { bytes, at: Date.now() });
    return bytes;
  }

  private async assertRoom(projectId: string, incoming: number): Promise<void> {
    const minFree = Number(process.env['STORAGE_MIN_FREE_MB'] ?? 2048) * MB;
    const quota = Number(process.env['STORAGE_QUOTA_MB_PER_PROJECT'] ?? 2048) * MB;
    await mkdir(this.root, { recursive: true });
    const fs = await statfs(this.root);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (free - incoming < minFree) {
      this.log.error({ msg: `storage: свободно ${Math.round(free / MB)} МБ, порог ${Math.round(minFree / MB)} МБ — запись отклонена`, projectId });
      throw new StorageFullException(STORAGE_FULL);
    }
    if (quota > 0 && (await this.projectUsage(projectId)) + incoming > quota) {
      this.log.warn({ msg: `storage: проект исчерпал квоту ${Math.round(quota / MB)} МБ`, projectId });
      throw new StorageFullException(PROJECT_QUOTA);
    }
  }

  /** Корень с разделителем: `../storage-secrets/x` начинается с `.../storage`, но не с `.../storage/`. */
  private path(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep)) throw new Error('storage: ключ вне корня');
    return path;
  }
}
