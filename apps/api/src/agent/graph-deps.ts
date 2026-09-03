import type { DiffService } from '../diff/diff.service';
import type { Frame, TriageLlm } from '../llm/triage-llm';
import type { RagService } from '../rag/rag.service';
import type { RemarksService } from '../remarks/remarks.service';
import type { StorageService } from '../storage/storage.service';
import type { RunEvents } from './run-events';

/** Ноды графа зовут Nest-сервисы (docs/ARCHITECTURE.md «AgentModule»): ни одного `prisma.*` внутри. */
export interface GraphDeps {
  remarks: RemarksService;
  rag: RagService;
  diff: DiffService;
  storage: StorageService;
  llm: TriageLlm;
  events: RunEvents;
}

/** Кадр из хранилища для vision: только PNG/JPG, остальное модели не показываем. */
export async function loadFrame(storage: StorageService, key: string): Promise<Frame | null> {
  let data: Buffer;
  try {
    data = await storage.read(key);
  } catch {
    return null;
  }
  if (data.length > 8 && data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return { data, mime: 'image/png' };
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { data, mime: 'image/jpeg' };
  return null;
}
