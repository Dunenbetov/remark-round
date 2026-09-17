import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PillTone } from '../core/copy';

/**
 * Штамп решения в шапке карточки: контурная надпись капсом, чуть повёрнута.
 * Цвет — только -ink статуса, без фактуры и зерна. Появляется с rr-stamp (спринг).
 */
@Component({
  selector: 'rr-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'stamp',
    '[attr.data-tone]': 'tone()',
    '[class.stamp--animate]': 'animate()',
  },
  template: `{{ label() }}`,
  styles: `
    :host {
      display: inline-block;
      border: 1.5px solid currentColor;
      border-radius: var(--rr-r-sm);
      padding: 3px 10px;
      font-size: var(--fs-13);
      line-height: 16px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      transform: rotate(-2deg);
      opacity: 0.92;
      white-space: nowrap;
    }
    :host([data-tone='ok']) {
      color: var(--rr-ok-ink);
    }
    :host([data-tone='work']) {
      color: var(--rr-work-ink);
    }
    :host([data-tone='wait']) {
      color: var(--rr-wait-ink);
    }
    :host([data-tone='muted']) {
      color: var(--rr-muted-ink);
    }
    :host([data-tone='danger']) {
      color: var(--rr-danger-ink);
    }
    :host(.stamp--animate) {
      animation: rr-stamp var(--rr-dur-stamp) var(--rr-ease-spring) both;
    }
  `,
})
export class Stamp {
  readonly label = input.required<string>();
  readonly tone = input<PillTone>('ok');
  readonly animate = input(true);
}
