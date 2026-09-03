import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Заголовок страницы: роль крупно (h1), под ней проект · раунд · счётчик; справа одно действие. */
@Component({
  selector: 'rr-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ph' },
  template: `
    <div class="ph__text">
      @if (eyebrow()) {
        <div class="meta ph__eyebrow">{{ eyebrow() }}</div>
      }
      <h1 class="ph__title">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="meta ph__sub">{{ subtitle() }}</p>
      }
    </div>
    <div class="ph__actions"><ng-content select="[actions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--sp-4);
      margin: 0 0 var(--sp-5);
    }
    .ph__text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .ph__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .ph__sub {
      margin: 0;
    }
    .ph__actions {
      display: flex;
      gap: var(--sp-2);
      flex: none;
    }
    .ph__actions:empty {
      display: none;
    }
    @media (max-width: 720px) {
      :host {
        flex-direction: column;
        align-items: stretch;
        margin-bottom: var(--sp-4);
      }
      .ph__title {
        font-size: var(--fs-18);
        line-height: var(--lh-18);
      }
      .ph__actions > * {
        flex: 1;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly eyebrow = input<string | null>(null);
}
