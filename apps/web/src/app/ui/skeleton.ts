import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { COMMON } from '../core/copy';

/** Скелетон загрузки: спокойный пульс прозрачности, без градиентной волны (VISUAL.md). */
@Component({
  selector: 'rr-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label', class: 'sk' },
  template: `
    @switch (kind()) {
      @case ('table') {
        <div class="paper sk__table">
          <div class="sk__head"><span class="sk__bar" style="width: 24px"></span><span class="sk__bar" style="width: 120px"></span><span class="sk__bar" style="width: 60px"></span></div>
          @for (i of list(); track i) {
            <div class="sk__row">
              <span class="sk__bar" style="width: 24px"></span>
              <span class="sk__bar" [style.width.%]="40 + ((i * 17) % 35)"></span>
              <span class="sk__bar sk__bar--thumb"></span>
              <span class="sk__bar" [style.width.%]="30 + ((i * 11) % 40)"></span>
              <span class="sk__bar sk__bar--pill"></span>
            </div>
          }
        </div>
      }
      @case ('cards') {
        @for (i of list(); track i) {
          <div class="paper sk__card">
            <span class="sk__bar" style="width: 24px"></span>
            <span class="sk__col"><span class="sk__bar" [style.width.%]="40 + ((i * 17) % 35)"></span><span class="sk__bar sk__bar--thin" style="width: 45%"></span></span>
            <span class="sk__bar sk__bar--thumb sk__bar--thumb-lg"></span>
            <span class="sk__bar sk__bar--btn"></span>
          </div>
        }
      }
      @default {
        <div class="sk__block"></div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .sk__table {
      overflow: hidden;
    }
    .sk__head,
    .sk__row {
      display: grid;
      grid-template-columns: 72px 1fr 112px 320px 200px;
      gap: var(--sp-4);
      align-items: center;
      padding: 0 var(--sp-5);
      border-bottom: 1px solid var(--rr-line);
    }
    .sk__head {
      height: 44px;
      grid-template-columns: 72px 1fr 200px;
    }
    .sk__row {
      height: 56px;
    }
    .sk__row:last-child {
      border-bottom: 0;
    }
    .sk__card {
      display: grid;
      grid-template-columns: 72px 1fr 120px 260px;
      gap: var(--sp-4);
      align-items: center;
      padding: var(--sp-5) var(--sp-6);
    }
    .sk__col {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sk__bar,
    .sk__block {
      display: block;
      height: 12px;
      border-radius: var(--rr-r-sm);
      background: var(--rr-surface-2);
      animation: rr-sk 1.4s ease-in-out infinite;
    }
    .sk__bar--thin {
      height: 8px;
    }
    .sk__bar--thumb {
      width: 72px;
      height: 45px;
    }
    .sk__bar--thumb-lg {
      width: 120px;
      height: 75px;
    }
    .sk__bar--pill {
      width: 140px;
      height: 24px;
      border-radius: var(--rr-r-pill);
    }
    .sk__bar--btn {
      width: 220px;
      height: 40px;
      border-radius: var(--rr-r-md);
      justify-self: end;
    }
    .sk__block {
      height: 120px;
    }
    @keyframes rr-sk {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.45;
      }
    }
    @media (max-width: 720px) {
      .sk__row {
        grid-template-columns: 40px 1fr 100px;
      }
      .sk__row > :nth-child(3),
      .sk__row > :nth-child(4) {
        display: none;
      }
      .sk__card {
        grid-template-columns: 40px 1fr;
      }
      .sk__card > :nth-child(3),
      .sk__card > :nth-child(4) {
        display: none;
      }
    }
  `,
})
export class Skeleton {
  readonly kind = input<'table' | 'cards' | 'block'>('table');
  readonly rows = input(5);
  protected readonly label = COMMON.loading;
  protected readonly list = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
