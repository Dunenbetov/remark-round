import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { COMMON } from '../core/copy';

export type SkeletonKind = 'table' | 'cards' | 'block' | 'tiles' | 'rows72' | 'rail' | 'card' | 'doc-cards' | 'cards104';

/**
 * Скелетон загрузки: спокойный пульс прозрачности, без градиентной волны (VISUAL.md).
 * Формы повторяют плотность живых экранов: тайлы 88, строки журнала 72, рельс 60,
 * карточка с тремя колонками, карточки документов 160, карточки очереди 104.
 * `rows` — число строк/карточек там, где оно имеет смысл.
 */
@Component({
  selector: 'rr-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label', class: 'sk', '[attr.data-kind]': 'kind()' },
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
      @case ('tiles') {
        <div class="sk__tiles">
          @for (i of five; track i) {
            <div class="paper sk__tile">
              <span class="sk__bar sk__bar--thin" style="width: 64px"></span>
              <span class="sk__bar sk__bar--big" [style.width.px]="28 + ((i * 9) % 20)"></span>
            </div>
          }
        </div>
      }
      @case ('rows72') {
        <div class="paper sk__table">
          <div class="sk__head72"><span class="sk__bar" style="width: 24px"></span><span class="sk__bar" style="width: 80px"></span><span class="sk__bar" style="width: 60px"></span><span class="sk__bar" style="width: 72px"></span></div>
          @for (i of list(); track i) {
            <div class="sk__row72">
              <span class="sk__bar sk__bar--n"></span>
              <span class="sk__col"><span class="sk__bar" [style.width.%]="40 + ((i * 17) % 31)"></span><span class="sk__bar sk__bar--thin" [style.width.%]="25 + ((i * 13) % 30)"></span></span>
              <span class="sk__bar" [style.width.%]="55 + ((i * 11) % 40)"></span>
              <span class="sk__bar sk__bar--pill"></span>
            </div>
          }
        </div>
      }
      @case ('rail') {
        <div class="sunken sk__rail">
          @for (i of four; track i) {
            <div class="sk__rail-item">
              <span class="sk__bar sk__bar--n"></span>
              <span class="sk__col"><span class="sk__bar" [style.width.%]="50 + ((i * 17) % 40)"></span><span class="sk__bar sk__bar--thin" style="width: 40%"></span></span>
            </div>
          }
        </div>
      }
      @case ('card') {
        <div class="paper sk__big">
          <div class="sk__big-head">
            <span class="sk__bar sk__bar--display"></span>
            <span class="sk__col sk__col--grow"><span class="sk__bar sk__bar--title" style="width: 60%"></span><span class="sk__bar sk__bar--thin" style="width: 35%"></span></span>
            <span class="sk__bar sk__bar--pill"></span>
          </div>
          <div class="sk__big-cols">
            <span class="sk__bar sk__bar--shot"></span>
            <span class="sk__col sk__col--lines">
              <span class="sk__bar" style="width: 90%"></span>
              <span class="sk__bar" style="width: 100%"></span>
              <span class="sk__bar" style="width: 75%"></span>
              <span class="sk__bar" style="width: 60%"></span>
            </span>
            <span class="sk__col sk__col--btns">
              <span class="sk__bar sk__bar--btn44"></span>
              <span class="sk__bar sk__bar--btn44"></span>
              <span class="sk__bar sk__bar--btn44"></span>
            </span>
          </div>
        </div>
      }
      @case ('doc-cards') {
        <div class="sk__docs">
          @for (i of two; track i) {
            <div class="paper sk__doc">
              <span class="sk__bar sk__bar--thin" style="width: 72px"></span>
              <span class="sk__bar sk__bar--title" [style.width.%]="55 + ((i * 17) % 30)"></span>
              <span class="sk__bar" style="width: 40%"></span>
              <span class="sk__bar sk__bar--pill sk__doc-pill"></span>
            </div>
          }
        </div>
      }
      @case ('cards104') {
        @for (i of list(); track i) {
          <div class="paper sk__card104">
            <span class="sk__bar sk__bar--n"></span>
            <span class="sk__col"><span class="sk__bar" [style.width.%]="40 + ((i * 17) % 35)"></span><span class="sk__bar sk__bar--thin" style="width: 45%"></span><span class="sk__bar sk__bar--thin" style="width: 60%"></span></span>
            <span class="sk__bar sk__bar--thumb sk__bar--thumb-160"></span>
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
    .sk__row:last-child,
    .sk__row72:last-child {
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
      min-width: 0;
    }
    .sk__col--grow {
      flex: 1;
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
    .sk__bar--title {
      height: 16px;
    }
    .sk__bar--n {
      width: 28px;
      height: 18px;
    }
    .sk__bar--big {
      height: 36px;
    }
    .sk__bar--display {
      width: 64px;
      height: 44px;
    }
    .sk__bar--thumb {
      width: 72px;
      height: 45px;
    }
    .sk__bar--thumb-lg {
      width: 120px;
      height: 75px;
    }
    .sk__bar--thumb-160 {
      width: 160px;
      height: 100px;
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
    .sk__bar--btn44 {
      width: 100%;
      height: 44px;
      border-radius: var(--rr-r-md);
    }
    .sk__bar--shot {
      width: 100%;
      aspect-ratio: 16 / 10;
      height: auto;
      border-radius: var(--rr-r-md);
    }
    .sk__block {
      height: 120px;
    }

    /* ---------- tiles: пять плашек 88px ---------- */
    .sk__tiles {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: var(--sp-3);
    }
    .sk__tile {
      min-height: 88px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 10px;
      padding: var(--sp-4) var(--sp-5);
    }

    /* ---------- rows72: строки журнала ---------- */
    .sk__head72,
    .sk__row72 {
      display: grid;
      grid-template-columns: 28px 1fr 200px 140px;
      gap: var(--sp-5);
      align-items: center;
      padding: 0 var(--sp-5);
      border-bottom: 1px solid var(--rr-line);
    }
    .sk__head72 {
      height: 44px;
    }
    .sk__row72 {
      height: 72px;
    }

    /* ---------- rail: колонка 240 с плашками 60 ---------- */
    .sk__rail {
      width: 240px;
      max-width: 100%;
      padding: var(--sp-2);
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .sk__rail-item {
      height: 60px;
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: var(--sp-3);
      align-items: center;
      padding: 0 var(--sp-3);
    }

    /* ---------- card: шапка + три колонки ---------- */
    .sk__big {
      padding: var(--sp-7);
      display: flex;
      flex-direction: column;
      gap: var(--sp-6);
    }
    .sk__big-head {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
    }
    .sk__big-cols {
      display: grid;
      grid-template-columns: 1.1fr 1fr 0.9fr;
      gap: var(--sp-6);
      align-items: start;
    }
    .sk__col--lines {
      gap: 12px;
      padding-top: var(--sp-1);
    }
    .sk__col--btns {
      gap: var(--sp-2);
    }

    /* ---------- doc-cards: две карточки 160 ---------- */
    .sk__docs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sp-4);
    }
    .sk__doc {
      position: relative;
      min-height: 160px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: var(--sp-5);
    }
    .sk__doc-pill {
      margin-top: auto;
      width: 120px;
    }

    /* ---------- cards104: карточки очереди ---------- */
    .sk__card104 {
      min-height: 104px;
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) 160px 240px;
      gap: var(--sp-4);
      align-items: center;
      padding: var(--sp-4) var(--sp-5);
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

    @media (max-width: 1279px) {
      .sk__tiles {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 900px) {
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
      .sk__tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .sk__head72,
      .sk__row72 {
        grid-template-columns: 28px 1fr;
      }
      .sk__head72 > :nth-child(n + 3),
      .sk__row72 > :nth-child(n + 3) {
        display: none;
      }
      .sk__big {
        padding: var(--sp-5);
      }
      .sk__big-cols {
        grid-template-columns: 1fr;
      }
      .sk__docs {
        grid-template-columns: 1fr;
      }
      .sk__card104 {
        grid-template-columns: 56px 1fr;
      }
      .sk__card104 > .sk__bar--thumb-160 {
        display: none;
      }
      .sk__card104 > .sk__bar--btn {
        grid-column: 2;
        width: 100%;
        justify-self: stretch;
      }
    }
  `,
})
export class Skeleton {
  readonly kind = input<SkeletonKind>('table');
  readonly rows = input(5);
  protected readonly label = COMMON.loading;
  protected readonly list = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
  protected readonly two = [0, 1];
  protected readonly four = [0, 1, 2, 3];
  protected readonly five = [0, 1, 2, 3, 4];
}
