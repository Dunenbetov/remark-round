import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { COMMON, DECISION } from '../core/copy';
import { PendingActionService } from '../core/pending-action.service';

/**
 * Полоса «Решение: … · Отменить» внизу экрана для действий вне карточки (очередь разработчика).
 * Живая область объявляет любое отложенное решение, в том числе показанное на самой карточке.
 */
@Component({
  selector: 'rr-undo-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="visually-hidden" aria-live="polite">
      @if (actions.pending(); as p) {
        {{ decision.record }} {{ p.label }}
      }
    </div>
    @if (actions.pending(); as p) {
      @if (!p.inline) {
        <div class="undo glass glass--pill">
          <span class="undo__text">{{ decision.record }} {{ p.label }}</span>
          <button type="button" class="btn btn--text undo__btn" [disabled]="actions.committing()" (click)="actions.cancel()">{{ common.undo }}</button>
          <span class="undo__line" aria-hidden="true"><span class="undo__fill"></span></span>
        </div>
      }
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
      height: 48px;
      padding: 0 var(--sp-5);
      max-width: calc(100vw - 32px);
      overflow: hidden;
      animation: rr-undo-in var(--dur) var(--ease);
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
      background: var(--rr-accent);
      transform-origin: left;
      animation: rr-undo var(--undo-ms) linear forwards;
    }
    @keyframes rr-undo {
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
    }
    @media (max-width: 720px) {
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
}
