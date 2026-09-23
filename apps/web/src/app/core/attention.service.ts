import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NOTIFY } from './copy';
import { notifyHeadline } from './history-label';
import type { NotificationView } from './models';

/** Настройки на устройстве (не на аккаунте): звук включён, системные уведомления — только по желанию. */
const SOUND_KEY = 'rr.notify.sound';
const DESKTOP_KEY = 'rr.notify.desktop';
/** Общие для всех вкладок: когда звучал сигнал, когда было системное уведомление, какие события уже обработаны. */
const LAST_CHIME_KEY = 'rr.notify.lastChime';
const LAST_DESKTOP_KEY = 'rr.notify.lastDesktop';
const HANDLED_KEY = 'rr.notify.handled';

/** Не чаще раза в 20 с на все вкладки: импорт на 40 строк даёт один сигнал. */
const THROTTLE_MS = 20_000;
/** Живая область говорит не чаще раза в 10 с. */
const LIVE_MS = 10_000;
/** Фоновая вкладка ждёт, не заберёт ли событие вкладка в фокусе. */
const BACKGROUND_WAIT_MS = 300;
/** Вкладка, где звук ещё не разбужен кликом, ждёт дольше: событие заберёт та, что может прозвучать. */
const SILENT_EXTRA_WAIT_MS = 400;
/** Столько держим Web Lock события: остальные вкладки успевают увидеть, что оно занято. */
const HOLD_MS = 1500;
/** Сколько помним обработанные события. */
const HANDLED_TTL_MS = 120_000;

/** Два мягких синуса: ля второй октавы и квинта выше. */
const NOTES = [
  { hz: 880, at: 0 },
  { hz: 1318.5, at: 0.11 },
];
const PEAK_GAIN = 0.05;
const ATTACK_S = 0.009;
const DECAY_S = 0.4;

/** Геометрия бренд-знака (ui/brand-mark.ts, viewBox 24) на круге 32: сдвиг на 4. */
const FAVICON_RING = 'M24.98 16.63A9 9 0 1 1 21.29 8.72';
const FAVICON_INDIGO = '#1d2d80';

type Permission = NotificationPermission | 'unsupported';

/**
 * Внимание человека, когда RemarkRound не перед глазами (ADR 016): тихий сигнал, системное уведомление, число на иконке сайта,
 * живая область для экранного диктора. Звук и системное уведомление — только для «ждёт вас» и только если ни одна вкладка
 * RemarkRound не в фокусе: вкладка в фокусе забирает событие Web Lock'ом сразу, фоновые — через 300 мс, действует одна.
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  readonly sound = signal(readFlag(SOUND_KEY, true));
  private readonly desktopWanted = signal(readFlag(DESKTOP_KEY, false));
  readonly permission = signal<Permission>(currentPermission());
  /** Системные уведомления действительно включены: человек хочет и браузер разрешил. */
  readonly desktop = computed(() => this.desktopWanted() && this.permission() === 'granted');
  readonly desktopSupported = computed(() => this.permission() !== 'unsupported');
  /** Текст живой области в app.ts. */
  readonly live = signal('');

  private audio: AudioContext | null = null;
  private lastLive = 0;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private baseIcon: string | null = null;
  private badged = false;

  constructor() {
    // Политика автозапуска (MDN): звук разрешён только после жеста — контекст создаём на первом клике или клавише
    const wake = () => this.wakeAudio();
    document.addEventListener('pointerdown', wake, true);
    document.addEventListener('keydown', wake, true);
    // Разрешение могли поменять в настройках сайта, пока вкладка была в фоне
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.permission.set(currentPermission());
    };
    document.addEventListener('visibilitychange', onVisible);
    // Переключили звук или системные уведомления в другой вкладке — эта слушается той же настройки
    const onStorage = (e: StorageEvent) => {
      if (e.key === SOUND_KEY) this.sound.set(readFlag(SOUND_KEY, true));
      if (e.key === DESKTOP_KEY) this.desktopWanted.set(readFlag(DESKTOP_KEY, false));
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', wake, true);
      document.removeEventListener('keydown', wake, true);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      void this.audio?.close().catch(() => undefined);
    });
  }

  setSound(on: boolean): void {
    this.sound.set(on);
    writeFlag(SOUND_KEY, on);
    if (on) this.wakeAudio();
  }

  /** Разрешение браузера спрашиваем только отсюда — по клику на переключатель. */
  async setDesktop(on: boolean): Promise<void> {
    if (!on || typeof Notification === 'undefined') {
      this.desktopWanted.set(false);
      writeFlag(DESKTOP_KEY, false);
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = Notification.permission;
      }
    }
    this.permission.set(permission);
    const granted = permission === 'granted';
    this.desktopWanted.set(granted);
    writeFlag(DESKTOP_KEY, granted);
  }

  /**
   * Новые непрочитанные уведомления (уже без открытой карточки). Сигнал и системное уведомление — по самому свежему «ждёт вас»;
   * `open` — клик по системному уведомлению.
   */
  notify(items: NotificationView[], open: (n: NotificationView) => void): void {
    const actions = items.filter((n) => n.kind === 'action' && !n.readAt);
    const first = actions[0];
    if (!first) return;
    this.announce(first);
    if (!this.sound() && !this.desktop()) return;
    void this.claim(first.id, !!this.audio, () => {
      if (this.sound() && this.audio && throttled(LAST_CHIME_KEY)) this.chime();
      if (this.desktop() && throttled(LAST_DESKTOP_KEY)) this.showDesktop(first, open);
    });
  }

  /** Событие уже увидели здесь (открытая карточка в видимой вкладке): фоновые вкладки не звучат по нему. */
  seenHere(items: NotificationView[]): void {
    for (const n of items) markHandled(n.id);
  }

  /** Число непрочитанных на иконке сайта: точка бренд-знака становится крупной. 0 — исходная иконка. */
  setBadge(count: number): void {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    const on = count > 0;
    if (on === this.badged) return;
    this.baseIcon ??= link.getAttribute('href');
    this.badged = on;
    if (on) {
      link.type = 'image/svg+xml';
      link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(true))}`;
    } else if (this.baseIcon) {
      link.href = this.baseIcon;
    }
  }

  /** Экранному диктору — только «ждёт вас», пока вкладка видна, не чаще раза в 10 с. */
  private announce(n: NotificationView): void {
    if (document.visibilityState !== 'visible' || Date.now() - this.lastLive < LIVE_MS) return;
    this.lastLive = Date.now();
    // Сброс и новый текст в следующем кадре: одинаковая фраза подряд тоже прозвучит
    this.live.set('');
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => this.live.set(NOTIFY.live(notifyHeadline(n.event), n.remark.number)), 50);
  }

  /**
   * Одна вкладка на событие. В фокусе — забрать событие и промолчать; в фоне — подождать 300 мс, взять Web Lock без очереди,
   * пропустить уже обработанное, иначе действовать и подержать замок 1,5 с. Без Web Locks — только скрытая вкладка.
   */
  private async claim(id: string, audible: boolean, act: () => void): Promise<void> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const name = `rr.notify.${id}`;
    if (!locks) {
      if (document.hidden) act();
      return;
    }
    try {
      if (looking()) {
        await locks.request(name, { ifAvailable: true }, async (lock) => {
          markHandled(id);
          if (lock) await delay(HOLD_MS);
        });
        return;
      }
      // Здесь нечем прозвучать и системные выключены — не забираем событие у вкладки, где звук разбужен
      if (!audible && !this.desktop()) return;
      await delay(audible ? BACKGROUND_WAIT_MS : BACKGROUND_WAIT_MS + SILENT_EXTRA_WAIT_MS);
      if (isHandled(id) || looking()) return;
      await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (!lock || isHandled(id)) return;
        markHandled(id);
        act();
        await delay(HOLD_MS);
      });
    } catch {
      // Замки недоступны (старый браузер, запрет) — не шумим
    }
  }

  private wakeAudio(): void {
    if (!this.sound()) return;
    const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (!Ctx) return;
    try {
      this.audio ??= new Ctx();
      if (this.audio.state === 'suspended') void this.audio.resume().catch(() => undefined);
    } catch {
      this.audio = null;
    }
  }

  /** Две ноты с атакой 9 мс и спадом 0,4 с, пик 0.05 — слышно, но не будильник. До первого жеста контекста нет — тишина. */
  private chime(): void {
    const ctx = this.audio;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.02;
    for (const note of NOTES) {
      const at = start + note.at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.hz;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + DECAY_S);
      osc.connect(gain).connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(at);
      osc.stop(at + DECAY_S + 0.02);
    }
  }

  /** Без сути замечания: системное уведомление видно на экране блокировки. tag = id — повтор события заменяет, а не множит. */
  private showDesktop(n: NotificationView, open: (n: NotificationView) => void): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const note = new Notification(notifyHeadline(n.event), {
        body: NOTIFY.desktopBody(n.remark.number, n.remark.roundNumber, n.project.name),
        tag: n.id,
        icon: '/favicon.svg',
      });
      note.onclick = () => {
        window.focus();
        note.close();
        open(n);
      };
    } catch {
      // Android Chrome разрешает системные уведомления только через service worker — там остаётся колокольчик
    }
  }
}

/** Иконка сайта: индиго-круг, белое кольцо и белая точка бренд-знака (на индиго маркер белый); с непрочитанными точка крупнее, с индиго-контуром. */
export function faviconSvg(badge: boolean): string {
  const dot = badge
    ? `<circle cx="24.5" cy="9.5" r="6.5" fill="#ffffff" stroke="${FAVICON_INDIGO}" stroke-width="1.75"/>`
    : `<circle cx="24.16" cy="12.2" r="2.6" fill="#ffffff"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
    `<circle cx="16" cy="16" r="16" fill="${FAVICON_INDIGO}"/>` +
    `<path d="${FAVICON_RING}" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>` +
    dot +
    `</svg>`
  );
}

/** Человек смотрит на эту вкладку: она видна и окно в фокусе (скрытая вкладка в некоторых окружениях отвечает hasFocus() = true). */
function looking(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function currentPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** true — можно действовать (и время записано для остальных вкладок); false — действовали меньше 20 с назад. */
function throttled(key: string): boolean {
  const now = Date.now();
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (now - last < THROTTLE_MS) return false;
    localStorage.setItem(key, String(now));
  } catch {
    /* приватный режим: без общего счётчика — действуем */
  }
  return true;
}

function readHandled(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HANDLED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function isHandled(id: string): boolean {
  return id in readHandled();
}

function markHandled(id: string): void {
  const now = Date.now();
  const map = readHandled();
  map[id] = now;
  for (const [key, at] of Object.entries(map)) if (now - at > HANDLED_TTL_MS) delete map[key];
  try {
    localStorage.setItem(HANDLED_KEY, JSON.stringify(map));
  } catch {
    /* приватный режим */
  }
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* приватный режим: настройка живёт до перезагрузки */
  }
}
