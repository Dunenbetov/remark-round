import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Лист по центру страницы (520px): «Нет доступа», ожидание проекта, профиль, приглашение.
 * Один h1 внутри — задаёт страница. `align="start"` — текст слева (формы), по умолчанию по центру.
 */
@Component({
  selector: 'rr-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'paper sheet rise', '[class.sheet--start]': "align() === 'start'" },
  template: `<ng-content />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-4);
      width: min(520px, 100%);
      margin-inline: auto;
      padding: var(--sp-10) var(--sp-6);
      text-align: center;
    }
    :host(.sheet--start) {
      align-items: stretch;
      text-align: left;
    }
    @media (max-width: 900px) {
      :host {
        padding: var(--sp-8) var(--sp-5);
      }
    }
  `,
})
export class Sheet {
  readonly align = input<'center' | 'start'>('center');
}
