import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { NAV } from '../core/copy';
import { ThemeService } from '../core/theme.service';

/**
 * Тумблер день/ночь 60×30 по референсу автора: слева солнце на голубом небе с облаками, справа луна
 * с кратерами на ночном небе со звёздами; три кольца свечения едут вместе с ручкой. Всё — CSS и два inline-SVG,
 * палитра `--rr-tt-*` (намеренное исключение из закона меди, см. tokens.css). role="switch" + aria-checked.
 * Клик отдаёт ThemeService.toggle центр ручки — оттуда идёт круговой wipe View Transition.
 */
@Component({
  selector: 'rr-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="tt" role="switch" [attr.aria-checked]="isDark()" [class.tt--dark]="isDark()" [attr.aria-label]="label()" [title]="label()" (click)="onClick()">
      <span class="tt__track" aria-hidden="true">
        <span class="tt__sky"></span>
        <span class="tt__night"></span>
        <span class="tt__stars"></span>
        <svg class="tt__sparkle tt__sparkle--1" viewBox="0 0 8 8"><path d="M4 0 4.9 3.1 8 4 4.9 4.9 4 8 3.1 4.9 0 4 3.1 3.1Z" /></svg>
        <svg class="tt__sparkle tt__sparkle--2" viewBox="0 0 8 8"><path d="M4 0 4.9 3.1 8 4 4.9 4.9 4 8 3.1 4.9 0 4 3.1 3.1Z" /></svg>
        <span class="tt__cloud tt__cloud--back"></span>
        <span class="tt__cloud tt__cloud--front"></span>
        <span class="tt__rings"><i></i><i></i><i></i></span>
        <span class="tt__knob" #knob>
          <span class="tt__moon"><i></i><i></i><i></i></span>
        </span>
      </span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .tt {
      position: relative;
      width: 60px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      cursor: pointer;
      flex: none;
    }
    .tt:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 3px;
    }
    .tt__track {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      overflow: hidden;
      box-shadow:
        inset 0 1px 3px rgba(0, 0, 0, 0.35),
        0 0 0 1px color-mix(in srgb, var(--rr-ink) 12%, transparent);
    }
    .tt__track > * {
      position: absolute;
    }

    /* небо и ночь — два слоя, crossfade */
    .tt__sky,
    .tt__night {
      inset: 0;
      transition: opacity 480ms var(--ease);
    }
    .tt__sky {
      background: linear-gradient(180deg, var(--rr-tt-sky-1), var(--rr-tt-sky-2));
    }
    .tt__night {
      background: linear-gradient(180deg, var(--rr-tt-night-1), var(--rr-tt-night-2));
      opacity: 0;
    }
    .tt--dark .tt__night {
      opacity: 1;
    }

    /* звёзды: точки списком теней + две искры; в светлой уведены вверх и прозрачны */
    .tt__stars {
      left: 0;
      top: 0;
      width: 2px;
      height: 2px;
      border-radius: 50%;
      color: var(--rr-tt-star);
      background: currentColor;
      box-shadow:
        7px 7px 0 0,
        13px 19px 0 -0.5px,
        19px 5px 0 0,
        25px 14px 0 -0.5px,
        30px 8px 0 0,
        22px 23px 0 -0.5px,
        9px 24px 0 0,
        35px 20px 0 -0.5px;
      opacity: 0;
      transform: translateY(-6px);
      transition:
        opacity 240ms var(--ease),
        transform 480ms var(--rr-ease-out);
    }
    .tt--dark .tt__stars {
      opacity: 1;
      transform: none;
      transition-delay: 120ms;
    }
    .tt__sparkle {
      fill: var(--rr-tt-star);
      opacity: 0;
      transform: scale(0);
      transition:
        transform 360ms var(--rr-ease-spring),
        opacity 200ms var(--ease);
    }
    .tt__sparkle--1 {
      left: 10px;
      top: 6px;
      width: 8px;
      height: 8px;
    }
    .tt__sparkle--2 {
      left: 26px;
      top: 17px;
      width: 5px;
      height: 5px;
    }
    .tt--dark .tt__sparkle {
      opacity: 1;
      transform: scale(1);
    }
    .tt--dark .tt__sparkle--1 {
      transition-delay: 180ms;
    }
    .tt--dark .tt__sparkle--2 {
      transition-delay: 260ms;
    }

    /* облака: гряда кругов справа внизу; в тёмной уезжают вниз */
    .tt__cloud {
      right: 8px;
      bottom: -6px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--rr-tt-cloud);
      box-shadow:
        -9px 4px 0 0,
        -18px 7px 0 -2px,
        -26px 9px 0 -3px,
        7px 5px 0 2px,
        16px 8px 0 1px;
      color: var(--rr-tt-cloud);
      transition:
        transform 480ms var(--rr-ease-spring),
        opacity 300ms var(--ease);
    }
    .tt__cloud--back {
      right: 4px;
      bottom: -1px;
      opacity: 0.55;
    }
    .tt--dark .tt__cloud {
      transform: translateY(20px);
      opacity: 0;
    }

    /* кольца свечения едут вместе с ручкой */
    .tt__rings,
    .tt__knob {
      left: 3px;
      top: 3px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      transition: transform 480ms var(--rr-ease-spring);
    }
    .tt__rings > i {
      position: absolute;
      border-radius: 50%;
      background: var(--rr-tt-ring);
      transition: background-color 480ms var(--ease);
    }
    .tt__rings > i:nth-child(1) {
      inset: -6px;
    }
    .tt__rings > i:nth-child(2) {
      inset: -12px;
    }
    .tt__rings > i:nth-child(3) {
      inset: -18px;
    }
    .tt--dark .tt__rings > i {
      background: var(--rr-tt-ring-night);
    }

    /* ручка: солнце ↔ луна (слой луны с кратерами проявляется поверх) */
    .tt__knob {
      background: radial-gradient(circle at 35% 35%, var(--rr-tt-sun-hi), var(--rr-tt-sun) 45%, var(--rr-tt-sun-edge));
      box-shadow:
        inset -2px -2px 4px rgba(0, 0, 0, 0.18),
        0 1px 3px rgba(0, 0, 0, 0.35);
    }
    .tt__moon {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #ffffff, var(--rr-tt-moon) 55%, var(--rr-tt-moon-edge));
      opacity: 0;
      transition: opacity 320ms var(--ease);
    }
    .tt__moon > i {
      position: absolute;
      border-radius: 50%;
      background: var(--rr-tt-crater);
      box-shadow: inset 0.5px 0.5px 1px rgba(0, 0, 0, 0.25);
    }
    .tt__moon > i:nth-child(1) {
      left: 5px;
      top: 4px;
      width: 6px;
      height: 6px;
    }
    .tt__moon > i:nth-child(2) {
      left: 13px;
      top: 10px;
      width: 4px;
      height: 4px;
    }
    .tt__moon > i:nth-child(3) {
      left: 7px;
      top: 14px;
      width: 3px;
      height: 3px;
    }
    .tt--dark .tt__rings,
    .tt--dark .tt__knob {
      transform: translateX(30px);
    }
    .tt--dark .tt__moon {
      opacity: 1;
    }
    /* hover — ручка чуть подаётся в сторону хода */
    .tt:hover .tt__rings,
    .tt:hover .tt__knob {
      transform: translateX(2px);
    }
    .tt--dark:hover .tt__rings,
    .tt--dark:hover .tt__knob {
      transform: translateX(28px);
    }
    .tt:active .tt__knob {
      transform: translateX(2px) scale(0.96);
    }
    .tt--dark:active .tt__knob {
      transform: translateX(28px) scale(0.96);
    }

    @media (max-width: 900px) {
      /* в мобильной шапке тесно: тот же тумблер, 48×24 */
      .tt {
        zoom: 0.8;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tt__track * {
        transition-duration: 0s;
        transition-delay: 0s;
      }
    }
  `,
})
export class ThemeToggle {
  private readonly theme = inject(ThemeService);
  private readonly knob = viewChild.required<ElementRef<HTMLElement>>('knob');

  protected readonly isDark = this.theme.isDark;
  protected readonly label = computed(() => (this.isDark() ? NAV.themeToLight : NAV.themeToDark));

  /** Круговой wipe идёт из центра ручки — той точки, на которую смотрит человек. */
  protected onClick(): void {
    const r = this.knob().nativeElement.getBoundingClientRect();
    this.theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
}
