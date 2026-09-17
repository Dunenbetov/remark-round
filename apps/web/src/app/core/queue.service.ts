import { Injectable, computed, signal } from '@angular/core';

export interface QueueSnapshot {
  /** id замечаний в порядке показа списка. */
  ids: string[];
  /** Подпись очереди: «Ждут вас», «В работе», «Все». */
  label: string;
  /** Куда ведёт «← Назад»: routerLink-массив. */
  backLink: (string | number)[];
}

export interface QueuePosition {
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

const KEY = 'rr.queue';

/**
 * Очередь карточек: снимок id из списка (журнал в текущем фильтре, «Начать разбор», очередь разработчика).
 * Решённые карточки из снимка не выпадают — «2 из 4» не прыгает. Живёт в памяти и sessionStorage
 * (перезагрузка не теряет рельс); прямой вход по URL без снимка — страница строит фолбэк сама.
 */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly snap = signal<QueueSnapshot | null>(read());
  readonly snapshot = this.snap.asReadonly();
  readonly has = computed(() => (this.snap()?.ids.length ?? 0) > 0);

  set(ids: string[], label: string, backLink: (string | number)[]): void {
    const next: QueueSnapshot = { ids: [...ids], label, backLink };
    this.snap.set(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* приватный режим */
    }
  }

  clear(): void {
    this.snap.set(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* приватный режим */
    }
  }

  /** Позиция карточки в снимке; null, если её там нет. */
  position(id: string, ids: string[] = this.snap()?.ids ?? []): QueuePosition | null {
    const i = ids.indexOf(id);
    if (i < 0) return null;
    return { index: i + 1, total: ids.length, prevId: ids[i - 1] ?? null, nextId: ids[i + 1] ?? null };
  }
}

function read(): QueueSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as QueueSnapshot;
    return Array.isArray(v.ids) && typeof v.label === 'string' && Array.isArray(v.backLink) ? v : null;
  } catch {
    return null;
  }
}
