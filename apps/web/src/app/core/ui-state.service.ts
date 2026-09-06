import { Injectable, signal } from '@angular/core';
import type { JournalChip } from './copy';

const FILTER_KEY = 'rr.ui.filter';
const GROUPS_KEY = 'rr.ui.collapsed';
const HINT_PREFIX = 'rr.hint.';
const BAND_PREFIX = 'rr.ui.band.';

/**
 * UI-состояние, которое не должно теряться при переходах: фильтр журнала и свёрнутые группы (на сессию),
 * последняя открытая строка (для перетекания номера), закрытые подсказки (навсегда). Логики данных здесь нет.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly journalFilter = signal<JournalChip | null>(readSession(FILTER_KEY) as JournalChip | null);
  readonly collapsedGroups = signal<ReadonlySet<string>>(new Set(readSession(GROUPS_KEY)?.split(',').filter(Boolean) ?? []));
  /** Строка, по которой ушли на карточку: только у неё view-transition-name номера. */
  readonly lastRemarkId = signal<string | null>(null);
  private readonly hintsSeen = signal<ReadonlySet<string>>(new Set());
  /** Свёрнутые полосы (схема «Как идёт замечание» в журнале) — навсегда, пока человек не развернёт. */
  private readonly bands = signal<ReadonlyMap<string, boolean>>(new Map());

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
      return localStorage.getItem(HINT_PREFIX + key) === '1';
    } catch {
      return false;
    }
  }

  dismissHint(key: string): void {
    this.hintsSeen.update((s) => new Set(s).add(key));
    try {
      localStorage.setItem(HINT_PREFIX + key, '1');
    } catch {
      /* приватный режим */
    }
  }

  bandCollapsed(key: string): boolean {
    const known = this.bands().get(key);
    if (known !== undefined) return known;
    try {
      return localStorage.getItem(BAND_PREFIX + key) === '1';
    } catch {
      return false;
    }
  }

  toggleBand(key: string): void {
    const next = !this.bandCollapsed(key);
    this.bands.update((m) => new Map(m).set(key, next));
    try {
      if (next) localStorage.setItem(BAND_PREFIX + key, '1');
      else localStorage.removeItem(BAND_PREFIX + key);
    } catch {
      /* приватный режим */
    }
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
