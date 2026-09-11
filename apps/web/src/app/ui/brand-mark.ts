import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BrandMarkSize = 16 | 24 | 40 | 64;
export type BrandMarkTone = 'default' | 'danger';

/**
 * Бренд-знак: незамкнутое кольцо currentColor (r 9, stroke 2.25) с разрывом справа сверху (36°–94° от 12 часов),
 * в разрыве медная точка r 2.4 (tone danger — danger). Декоративный, без анимации; тот же знак в public/favicon.svg.
 */
@Component({
  selector: 'rr-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" focusable="false">
    <path d="M20.98 12.63A9 9 0 1 1 17.29 4.72" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" />
    <circle cx="20.16" cy="8.2" r="2.4" [attr.fill]="tone() === 'danger' ? 'var(--rr-danger)' : 'var(--rr-accent-2-text)'" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
      color: inherit;
    }
  `,
})
export class BrandMark {
  readonly size = input<BrandMarkSize>(24);
  readonly tone = input<BrandMarkTone>('default');
}
