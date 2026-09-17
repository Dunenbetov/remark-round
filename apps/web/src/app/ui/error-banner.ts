import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { COMMON } from '../core/copy';
import { Icon } from './icons';

/**
 * Ошибка запроса — на месте, не тостом. Слева иконка «внимание», справа «Повторить»,
 * если действие можно повторить. danger — только для ошибок; маркер `--rr-accent-2` здесь не используется.
 */
@Component({
  selector: 'rr-error-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'err rise', role: 'alert' },
  template: `
    <rr-icon class="err__icon" name="warning" [size]="18" />
    <span class="err__text">{{ message() }}</span>
    @if (retryable()) {
      <button type="button" class="btn btn--secondary btn--sm err__btn" [class.btn--busy]="busy()" [disabled]="busy()" (click)="retry.emit()">{{ retryLabel }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      min-height: 48px;
      padding: var(--sp-2) var(--sp-4);
      border-radius: var(--rr-r-md);
      background: var(--rr-danger-bg);
      color: var(--rr-danger-ink);
      border: 1px solid color-mix(in srgb, var(--rr-danger-dot) 30%, transparent);
    }
    .err__icon {
      flex: none;
      display: inline-flex;
    }
    .err__text {
      flex: 1;
      min-width: 0;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      font-weight: var(--fw-medium);
    }
    .err__btn {
      flex: none;
      color: var(--rr-danger-ink);
      border-color: color-mix(in srgb, var(--rr-danger-dot) 40%, transparent);
    }
    .err__btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--rr-danger) 8%, transparent);
    }
    @media (max-width: 900px) {
      :host {
        flex-wrap: wrap;
      }
      .err__btn {
        margin-left: calc(18px + var(--sp-3));
      }
    }
  `,
})
export class ErrorBanner {
  readonly message = input.required<string>();
  readonly retryable = input(true);
  readonly busy = input(false);
  readonly retry = output<void>();
  protected readonly retryLabel = COMMON.retry;
}
