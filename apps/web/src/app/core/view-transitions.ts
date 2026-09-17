import { signal } from '@angular/core';
import type { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';

export type VtKind = 'nav' | 'theme';
export type NavDirection = 'forward' | 'back';
export interface VtOrigin {
  x: number;
  y: number;
}

/**
 * Общий флаг View Transitions: две одновременно невозможны, поэтому пока идёт любая — active() === true,
 * а тема/маркеры переключаются без своей анимации. На <html> на время перехода висят data-vt='nav'|'theme',
 * для nav — data-nav='forward'|'back'. CSS — в styles/motion.css; геометрию круга темы ставит ThemeService
 * через WAAPI (custom-properties до псевдоэлементов VT доходят не во всех браузерах).
 */
export const vtActive = signal(false);

/** Поколение перехода: cleanup от «перебитой» браузером VT не должен снять атрибуты новой. */
let generation = 0;

/** Есть ли API и не просил ли человек меньше движения. */
export function canViewTransition(): boolean {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Запуск своей View Transition (сейчас — тема). Без API, при reduced-motion или пока идёт другая —
 * просто update() без анимации. `onReady` получает переход сразу после старта — туда вешают анимацию
 * на псевдоэлементы. Промис завершается вместе с transition.finished (и в случае ошибки).
 */
export function runViewTransition(kind: VtKind, update: () => void, onReady?: (transition: ViewTransition) => void): Promise<void> {
  if (!canViewTransition() || vtActive()) {
    update();
    return Promise.resolve();
  }
  const gen = begin(kind);
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => update());
  } catch {
    update();
    end(gen);
    return Promise.resolve();
  }
  onReady?.(transition);
  return transition.finished.catch(() => undefined).then(() => end(gen));
}

/**
 * Для withViewTransitions({ onViewTransitionCreated }): помечает переход роутера как nav
 * с направлением по глубине URL (длиннее — forward, короче — back, равная — forward).
 */
export function onViewTransitionCreated(info: ViewTransitionInfo): void {
  const direction: NavDirection = depth(info.to) < depth(info.from) ? 'back' : 'forward';
  const gen = begin('nav', direction);
  void info.transition.finished.catch(() => undefined).then(() => end(gen));
}

/** Глубина URL по цепочке снапшотов: сумма сегментов от корня до листа. */
function depth(root: ActivatedRouteSnapshot): number {
  let n = 0;
  for (let r: ActivatedRouteSnapshot | null = root; r; r = r.firstChild) n += r.url.length;
  return n;
}

function begin(kind: VtKind, direction?: NavDirection): number {
  const gen = ++generation;
  const root = document.documentElement;
  root.dataset['vt'] = kind;
  if (kind === 'nav') root.dataset['nav'] = direction ?? 'forward';
  else delete root.dataset['nav'];
  vtActive.set(true);
  return gen;
}

function end(gen: number): void {
  if (gen !== generation) return;
  const root = document.documentElement;
  delete root.dataset['vt'];
  delete root.dataset['nav'];
  vtActive.set(false);
}
