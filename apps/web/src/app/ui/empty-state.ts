import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Пустое состояние: одна фраза дословно из COPY.md, при необходимости подсказка и одна кнопка. */
@Component({
  selector: 'rr-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'paper empty-state' },
  template: `
    <p class="empty-state__title">{{ title() }}</p>
    @if (hint()) {
      <p class="meta empty-state__hint">{{ hint() }}</p>
    }
    <ng-content select="[cta]" />
  `,
  styles: `
    :host {
      min-height: 200px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-4);
      text-align: center;
      padding: var(--sp-8) var(--sp-6);
    }
    .empty-state__title {
      margin: 0;
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-medium);
      max-width: 460px;
    }
    .empty-state__hint {
      margin: calc(-1 * var(--sp-2)) 0 0;
      max-width: 460px;
    }
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input<string | null>(null);
}
