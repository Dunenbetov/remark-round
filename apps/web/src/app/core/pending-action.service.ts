import { Injectable, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Сколько секунд можно «Отменить» решение, прежде чем оно уйдёт на сервер. */
export const UNDO_MS = 5000;

export interface PendingAction {
  id: string;
  remarkId: string;
  /** Подпись решения дословно: «В работу разработчикам», «Закрыть: исправлено»… */
  label: string;
  /** true — панель решения показывает отмену сама; false — общая полоса внизу экрана. */
  inline: boolean;
  commit: () => Promise<void>;
}

/**
 * Необратимые действия (вердикт, закрытие, «Готово») откладываются на UNDO_MS.
 * Уход со страницы, закрытие вкладки или новое действие — коммит сразу. Это не оптимистичное обновление:
 * запрос просто уходит позже, откатывать нечего.
 */
@Injectable({ providedIn: 'root' })
export class PendingActionService {
  readonly pending = signal<PendingAction | null>(null);
  readonly committing = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => void this.flush());
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void this.flush());
  }

  schedule(action: Omit<PendingAction, 'id'>): void {
    void this.flush();
    this.pending.set({ ...action, id: crypto.randomUUID() });
    this.timer = setTimeout(() => void this.flush(), UNDO_MS);
  }

  cancel(): void {
    this.clearTimer();
    this.pending.set(null);
  }

  async flush(): Promise<void> {
    const action = this.pending();
    if (!action || this.committing()) return;
    this.clearTimer();
    this.committing.set(true);
    try {
      await action.commit();
    } finally {
      this.committing.set(false);
      if (this.pending()?.id === action.id) this.pending.set(null);
    }
  }

  pendingFor(remarkId: string): PendingAction | null {
    const action = this.pending();
    return action && action.remarkId === remarkId ? action : null;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
