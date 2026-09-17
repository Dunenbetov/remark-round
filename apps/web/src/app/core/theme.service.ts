import { Injectable, computed, effect, signal } from '@angular/core';
import { VtOrigin, canViewTransition, runViewTransition, vtActive } from './view-transitions';

type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'rr.theme';
/** Фолбэки, если токены --rr-dur-theme / --rr-ease-in-out не прочитались. */
const WIPE_MS = 600;
const WIPE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const WIPE_STYLE_ID = 'rr-vt-theme';

/**
 * Тема: «как в системе» / светлая / тёмная. Ставит data-theme на <html>; в режиме auto — по prefers-color-scheme,
 * так что в tokens.css один тёмный блок. Инлайн-скрипт в index.html делает то же до загрузки стилей (без вспышки).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readMode());
  private readonly media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(this.media?.matches ?? false);
  /** Фактическая тема с учётом auto. */
  readonly isDark = computed(() => {
    const mode = this.mode();
    return mode === 'dark' || (mode === 'auto' && this.systemDark());
  });

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => this.apply(this.isDark()));
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

  /**
   * Светлая ↔ тёмная (из auto — фиксирует явное значение). С origin — круговой wipe через View Transition
   * от точки клика; без API / при reduced-motion / пока идёт другая VT — простой перекрас (фолбэк в styles.css).
   */
  toggle(origin?: VtOrigin): void {
    const next: ThemeMode = this.isDark() ? 'light' : 'dark';
    // В zoneless effect сработает микрозадачей — позже снимка «new», поэтому атрибут ставим сразу.
    const update = () => {
      this.set(next);
      this.apply(next === 'dark');
    };
    if (!canViewTransition() || vtActive()) update();
    else void runViewTransition('theme', update, (t) => wipe(t, origin));
  }

  /** Синхронно применяет тему к <html>; зовётся и из effect, и из колбэка View Transition. */
  private apply(dark: boolean): void {
    const root = document.documentElement;
    if (dark) root.dataset['theme'] = 'dark';
    else delete root.dataset['theme'];
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
}

/**
 * Круговое раскрытие новой темы от точки клика: старый кадр лежит целиком, новый вырезается растущим кругом
 * до дальнего угла экрана. Геометрия — литералами через WAAPI прямо на ::view-transition-new(root):
 * custom-properties до псевдоэлементов VT доходят не во всех браузерах (иначе круг стартует «сверху посередине»).
 * Нет поддержки pseudoElement в animate() — та же анимация через одноразовый <style>.
 */
function wipe(transition: ViewTransition, origin?: VtOrigin): void {
  const x = Math.round(origin?.x ?? window.innerWidth / 2);
  const y = Math.round(origin?.y ?? 0);
  const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));
  const from = `circle(0px at ${x}px ${y}px)`;
  const to = `circle(${r}px at ${x}px ${y}px)`;
  const css = getComputedStyle(document.documentElement);
  const duration = parseFloat(css.getPropertyValue('--rr-dur-theme')) || WIPE_MS;
  const easing = css.getPropertyValue('--rr-ease-in-out').trim() || WIPE_EASING;
  transition.ready.then(
    () => {
      try {
        document.documentElement.animate({ clipPath: [from, to] }, { duration, easing, pseudoElement: '::view-transition-new(root)' });
      } catch {
        wipeViaStylesheet(from, to, duration, easing);
      }
    },
    () => undefined,
  );
}

function wipeViaStylesheet(from: string, to: string, duration: number, easing: string): void {
  let style = document.getElementById(WIPE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = WIPE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent =
    `@keyframes rr-theme-wipe { from { clip-path: ${from}; } to { clip-path: ${to}; } }\n` +
    `html[data-vt='theme']::view-transition-new(root) { animation: rr-theme-wipe ${duration}ms ${easing} both; }`;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
