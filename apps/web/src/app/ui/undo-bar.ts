import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { COMMON, DECISION } from '../core/copy';
import { PendingAction, PendingActionService, UNDO_MS } from '../core/pending-action.service';

const UNDO_SECONDS = Math.round(UNDO_MS / 1000);
/** Длительность ухода полосы — выход 140ms ease-in (принципы движения). */
const LEAVE_MS = 140;

/**
 * Полоса «Решение: … · Отменить» внизу экрана для действий вне карточки (очередь разработчика).
 * Медная полоска-таймер и цифра 5…1 (закон меди п. г). Уход плавный: держим копию последнего pending
 * в `shown`, пока идёт анимация `.is-leaving`. Живая область объявляет любое отложенное решение.
 */
@Component({
  selector: 'rr-undo-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="visually-hidden" aria-live="polite">
      @if (actions.pending(); as p) {
        {{ p.record ?? decision.record }} {{ p.label }}
      }
    </div>
    @if (shown(); as p) {
      <div class="undo glass glass--pill" [class.is-leaving]="leaving()">
        <span class="undo__text">{{ p.record ?? decision.record }} {{ p.label }}</span>
        <button type="button" class="btn btn--text undo__btn" [disabled]="actions.committing() || leaving()" (click)="actions.cancel()">{{ common.undo }}</button>
        <span class="undo__sec num" aria-hidden="true">{{ seconds() }}</span>
        <span class="undo__line" aria-hidden="true"><span class="undo__fill"></span></span>
      </div>
    }
  `,
  styles: `
    .undo {
      position: fixed;
      left: 50%;
      bottom: var(--sp-6);
      transform: translateX(-50%);
      z-index: var(--z-undo);
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      height: 52px;
      padding: 0 var(--sp-5);
      max-width: calc(100vw - 32px);
      overflow: hidden;
      animation: rr-undo-in var(--dur) var(--rr-ease-out) both;
    }
    /* уход — тоже ключевыми кадрами: fill-mode входа иначе перекрыл бы transition */
    .undo.is-leaving {
      animation: rr-undo-out 140ms var(--rr-ease-in) both;
      pointer-events: none;
    }
    @keyframes rr-undo-out {
      from {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      to {
        opacity: 0;
        transform: translate(-50%, 8px);
      }
    }
    @keyframes rr-undo-in {
      from {
        opacity: 0;
        transform: translate(-50%, 8px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }
    .undo__text {
      font-weight: var(--fw-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .undo__btn {
      font-size: var(--fs-14);
      flex: none;
    }
    /* цифра отсчёта — медь, 18/600, рядом с «Отменить» */
    .undo__sec {
      flex: none;
      min-width: 1ch;
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      font-weight: var(--fw-semibold);
      color: var(--rr-accent-2-text);
      text-align: center;
    }
    .undo__line {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: var(--rr-line);
    }
    .undo__fill {
      display: block;
      height: 100%;
      background: var(--rr-accent-2);
      transform-origin: left;
      animation: rr-undo var(--undo-ms) linear forwards;
    }
    @media (max-width: 900px) {
      .undo {
        bottom: calc(var(--rr-tabbar-h) + env(safe-area-inset-bottom) + var(--sp-3));
      }
    }
  `,
})
export class UndoBar {
  protected readonly actions = inject(PendingActionService);
  protected readonly decision = DECISION;
  protected readonly common = COMMON;

  /** Копия последнего внешнего pending: живёт дольше него на время ухода. */
  protected readonly shown = signal<PendingAction | null>(null);
  protected readonly leaving = signal(false);
  protected readonly seconds = signal(UNDO_SECONDS);

  private tick: ReturnType<typeof setInterval> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const p = this.actions.pending();
      untracked(() => {
        if (p && !p.inline) this.enter(p);
        else this.leave();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTick();
      this.clearLeave();
    });
  }

  /** Новое (или другое) решение: показать сразу, отсчёт с начала. */
  private enter(p: PendingAction): void {
    this.clearLeave();
    this.leaving.set(false);
    if (this.shown()?.id !== p.id) {
      this.shown.set(p);
      this.seconds.set(UNDO_SECONDS);
      this.stopTick();
      this.tick = setInterval(() => this.seconds.update((s) => Math.max(1, s - 1)), 1000);
    }
  }

  /** pending исчез: полоса уходит 140ms, потом снимаем с экрана. */
  private leave(): void {
    this.stopTick();
    if (!this.shown() || this.leaving()) return;
    this.leaving.set(true);
    this.leaveTimer = setTimeout(() => {
      this.shown.set(null);
      this.leaving.set(false);
      this.leaveTimer = null;
    }, LEAVE_MS);
  }

  private stopTick(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private clearLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }
}
