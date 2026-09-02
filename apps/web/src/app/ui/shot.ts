import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ShotVariant } from '../core/models';

/**
 * Мок-скриншот формы «Профиль компании» (Shot.dc.html из дизайна).
 * Рисуется CSS, масштабируется от ширины контейнера (cqw), поэтому кнопка и маска
 * совпадают на миниатюре 64px, в карточке и в полноэкранном просмотре.
 * grey — серая «Сохранить» (было), blue — синяя (стало), diff — красная маска только над кнопкой.
 */
@Component({
  selector: 'rr-shot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'shot',
    '[class.shot--blue]': "variant() === 'blue'",
    '[class.shot--diff]': "variant() === 'diff'",
    role: 'img',
    '[attr.aria-label]': 'alt()',
  },
  template: `
    <div class="shot__body" aria-hidden="true">
      <div class="shot__title">Профиль компании</div>
      <div class="shot__field"><div class="shot__label">Название</div><div class="shot__input">ТОО «Алтын Дала»</div></div>
      <div class="shot__field"><div class="shot__label">БИН</div><div class="shot__input">120940003215</div></div>
      <div class="shot__field"><div class="shot__label">Телефон</div><div class="shot__input">+7 727 300 12 40</div></div>
      <div class="shot__footer"><div class="shot__btn">Сохранить</div></div>
    </div>
    @if (variant() === 'diff') {
      <div class="shot__dim" aria-hidden="true"></div>
      <div class="shot__mask" aria-hidden="true"></div>
    }
    @if (zoom()) {
      <span class="shot__zoom" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10 10l4 4" />
        </svg>
      </span>
    }
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
      width: 100%;
      aspect-ratio: 4 / 3;
      background: #f4f3f1;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      border: 1px solid var(--rr-line);
      line-height: 1.3;
      color: #26262a;
    }
    .shot__body {
      position: absolute;
      inset: 0;
      padding: 6cqw;
      display: flex;
      flex-direction: column;
      gap: 2.5cqw;
    }
    .shot__title {
      font-size: 5cqw;
      font-weight: 600;
      line-height: 1.2;
      margin-bottom: 1cqw;
    }
    .shot__field {
      display: flex;
      flex-direction: column;
      gap: 1cqw;
    }
    .shot__label {
      font-size: 2.8cqw;
      color: #6b6b72;
    }
    .shot__input {
      height: 8cqw;
      border: 1px solid #d7d7dc;
      border-radius: 1.2cqw;
      background: #fff;
      display: flex;
      align-items: center;
      padding: 0 2.5cqw;
      font-size: 3.2cqw;
    }
    .shot__footer {
      margin-top: auto;
      display: flex;
      justify-content: flex-end;
    }
    .shot__btn {
      height: 9cqw;
      width: 26cqw;
      border-radius: 1.5cqw;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3.4cqw;
      font-weight: 600;
      color: #fff;
      background: #c4c1bb;
    }
    :host(.shot--blue) .shot__btn {
      background: #2b63d9;
    }
    .shot__dim {
      position: absolute;
      inset: 0;
      background: rgba(243, 238, 230, 0.74);
    }
    .shot__mask {
      position: absolute;
      right: 6cqw;
      bottom: 6cqw;
      height: 9cqw;
      width: 26cqw;
      border-radius: 1.5cqw;
      background: rgba(143, 58, 48, 0.32);
      border: 2px solid var(--rr-danger);
    }
    .shot__zoom {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: rgba(255, 253, 248, 0.92);
      border: 1px solid rgba(31, 27, 22, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rr-ink);
    }
  `,
})
export class Shot {
  readonly variant = input<ShotVariant>('grey');
  readonly zoom = input(false);
  readonly alt = input('Скрин экрана «Профиль компании»');
}
