import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';

/** `<projectId>/<uuid>.<ext>` — единственная форма ключа, которую выдаёт save(). */
const KEY = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.[a-z0-9]{1,5}$/;

/**
 * Файлы пакета документов и скринов на диске. Ключ — путь относительно STORAGE_DIR,
 * первый сегмент всегда projectId: файлы одного проекта не лежат рядом с чужими.
 */
@Injectable()
export class StorageService {
  readonly root = resolve(process.env['STORAGE_DIR'] ?? join(process.cwd(), 'storage'));

  async save(projectId: string, originalName: string, data: Buffer): Promise<string> {
    const ext = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const key = `${projectId}/${randomUUID()}${ext}`;
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.path(storageKey));
  }

  /** Ключ из тела запроса (screenshotKey) принимается, только если он этого проекта и той же формы, что даёт save(). */
  belongsTo(projectId: string, storageKey: string): boolean {
    return KEY.test(storageKey) && storageKey.startsWith(`${projectId}/`);
  }

  /** Корень с разделителем: `../storage-secrets/x` начинается с `.../storage`, но не с `.../storage/`. */
  private path(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep)) throw new Error('storage: ключ вне корня');
    return path;
  }
}
