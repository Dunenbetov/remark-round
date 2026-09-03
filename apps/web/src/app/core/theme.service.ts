import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'rr.theme';

/**
 * Тема: «как в системе» / светлая / тёмная. Ставит data-theme на <html>; в режиме auto — по prefers-color-scheme,
 * так что в tokens.css один тёмный блок. Инлайн-скрипт в index.html делает то же до загрузки стилей (без вспышки).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readMode());
  private readonly media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(this.media?.matches ?? false);

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const mode = this.mode();
      const dark = mode === 'dark' || (mode === 'auto' && this.systemDark());
      const root = document.documentElement;
      if (dark) root.dataset['theme'] = 'dark';
      else delete root.dataset['theme'];
      root.style.colorScheme = dark ? 'dark' : 'light';
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      if (mode === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* приватный режим */
    }
  }
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
