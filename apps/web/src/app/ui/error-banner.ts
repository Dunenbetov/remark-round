import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { COMMON } from '../core/copy';

/** Ошибка запроса — на месте, не тостом. С кнопкой «Повторить», если действие можно повторить. */
@Component({
  selector: 'rr-error-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'err', role: 'alert' },
  template: `
    <span class="err__text">{{ message() }}</span>
    @if (retryable()) {
      <button type="button" class="btn btn--secondary err__btn" [class.btn--busy]="busy()" [disabled]="busy()" (click)="retry.emit()">{{ retryLabel }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-4);
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--rr-r-md);
      background: var(--rr-danger-bg);
      color: var(--rr-danger-ink);
      border: 1px solid color-mix(in srgb, var(--rr-danger) 25%, transparent);
    }
    .err__text {
      font-weight: var(--fw-medium);
    }
    .err__btn {
      min-height: 32px;
      padding: 0 12px;
      color: var(--rr-danger-ink);
      border-color: color-mix(in srgb, var(--rr-danger) 35%, transparent);
      flex: none;
    }
    .err__btn:hover {
      background: color-mix(in srgb, var(--rr-danger) 8%, transparent);
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
