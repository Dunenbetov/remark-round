import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Заголовок страницы. Ровно один h1 на страницу:
 * size 'lg' — фраза роли (Журнал, Очередь) или имя раздела (Документы, Импорт), 32/700;
 * size 'md' — имя раздела на страницах-«листах» (Новое замечание, Нет доступа), 22/600.
 * eyebrow — роль · проект · раунд над h1 на разделах; subtitle — строка-объяснение 15 ink-2.
 * Слоты: [actions] справа, [hint] под заголовком.
 */
@Component({
  selector: 'rr-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ph', '[class.ph--md]': "size() === 'md'" },
  template: `
    <div class="ph__row">
      <div class="ph__text">
        @if (eyebrow()) {
          <div class="eyebrow ph__eyebrow">{{ eyebrow() }}</div>
        }
        <h1 class="ph__title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="ph__sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="ph__actions"><ng-content select="[actions]" /></div>
    </div>
    <ng-content select="[hint]" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      margin: 0 0 var(--sp-6);
    }
    .ph__row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--sp-4);
    }
    .ph__text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .ph__eyebrow {
      margin-bottom: -2px;
    }
    .ph__title {
      margin: 0;
      font-size: var(--rr-fs-32);
      line-height: var(--rr-lh-32);
      font-weight: var(--fw-bold);
      letter-spacing: -0.02em;
    }
    :host(.ph--md) .ph__title {
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .ph__sub {
      margin: 0;
      color: var(--rr-ink-3);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      max-width: 72ch;
    }
    .ph__actions {
      display: flex;
      gap: var(--sp-2);
      flex: none;
      padding-bottom: 2px;
    }
    .ph__actions:empty {
      display: none;
    }
    @media (min-width: 901px) and (max-width: 1279px) {
      .ph__title {
        font-size: var(--fs-28);
        line-height: var(--lh-28);
      }
    }
    @media (max-width: 900px) {
      :host {
        margin-bottom: var(--sp-4);
      }
      .ph__row {
        flex-direction: column;
        align-items: stretch;
      }
      .ph__title {
        font-size: var(--fs-22);
        line-height: var(--lh-22);
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
  readonly size = input<'lg' | 'md'>('lg');
}
