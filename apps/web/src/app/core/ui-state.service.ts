import { Injectable, inject, signal } from '@angular/core';
import type { JournalChip } from './copy';
import { SessionService } from './session.service';

const FILTER_KEY = 'rr.ui.filter';
const GROUPS_KEY = 'rr.ui.collapsed';
const HINT_PREFIX = 'rr.hint.';

/**
 * UI-состояние, которое не должно теряться при переходах: фильтр журнала и свёрнутые группы (на сессию),
 * последняя открытая строка (для перетекания номера), закрытые подсказки (навсегда). Логики данных здесь нет.
 * Подсказки — на пользователя (rr.hint.<userId>.<key>): второй человек на той же машине увидит тур сам.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  private readonly session = inject(SessionService);
  readonly journalFilter = signal<JournalChip | null>(readSession(FILTER_KEY) as JournalChip | null);
  readonly collapsedGroups = signal<ReadonlySet<string>>(new Set(readSession(GROUPS_KEY)?.split(',').filter(Boolean) ?? []));
  /** Строка, по которой ушли на карточку: только у неё view-transition-name номера. */
  readonly lastRemarkId = signal<string | null>(null);
  private readonly hintsSeen = signal<ReadonlySet<string>>(new Set());

  setJournalFilter(chip: JournalChip): void {
    this.journalFilter.set(chip);
    writeSession(FILTER_KEY, chip);
  }

  toggleGroup(id: string): void {
    const next = new Set(this.collapsedGroups());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedGroups.set(next);
    writeSession(GROUPS_KEY, [...next].join(','));
  }

  isGroupCollapsed(id: string): boolean {
    return this.collapsedGroups().has(id);
  }

  hintSeen(key: string): boolean {
    if (this.hintsSeen().has(key)) return true;
    try {
      return localStorage.getItem(HINT_PREFIX + this.scoped(key)) === '1';
    } catch {
      return false;
    }
  }

  dismissHint(key: string): void {
    this.hintsSeen.update((s) => new Set(s).add(key));
    try {
      localStorage.setItem(HINT_PREFIX + this.scoped(key), '1');
    } catch {
      /* приватный режим */
    }
  }

  private scoped(key: string): string {
    return `${this.session.user()?.id ?? 'anon'}.${key}`;
  }
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* приватный режим */
  }
}
