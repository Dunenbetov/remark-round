import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

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
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root)) throw new Error('storage: ключ вне корня');
    return readFile(path);
  }
}
