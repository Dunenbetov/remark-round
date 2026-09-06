import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from './icons';

export type GroupTone = 'accent-2' | 'work' | 'wait' | 'ok' | 'muted' | null;

/**
 * Заголовок группы внутри списка: «ЖДУТ ВАС · 4». Липкий под шапкой, слева полоса тона
 * (медь — только у группы «ждут вас», закон меди п. а). Может сворачивать группу.
 */
@Component({
  selector: 'rr-group-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'gh',
    '[class.gh--sticky]': 'sticky()',
    '[attr.data-tone]': 'tone()',
  },
  template: `
    @if (collapsible()) {
      <button type="button" class="gh__btn" [attr.aria-expanded]="!collapsed()" (click)="toggle.emit()">
        <span class="gh__bar" aria-hidden="true"></span>
        <span class="gh__title">{{ title() }}</span>
        @if (count() !== null) {
          <span class="gh__count num">· {{ count() }}</span>
        }
        <rr-icon class="gh__chev" [class.gh__chev--collapsed]="collapsed()" name="chevron-down" [size]="16" />
      </button>
    } @else {
      <div class="gh__btn gh__btn--static">
        <span class="gh__bar" aria-hidden="true"></span>
        <span class="gh__title">{{ title() }}</span>
        @if (count() !== null) {
          <span class="gh__count num">· {{ count() }}</span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      background: var(--rr-surface);
      border-bottom: 1px solid var(--rr-line);
    }
    :host(.gh--sticky) {
      position: sticky;
      top: var(--rr-bar-h);
      z-index: 2;
    }
    .gh__btn {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      width: 100%;
      height: 48px;
      padding: 0 var(--sp-5);
      border: 0;
      background: transparent;
      color: var(--rr-ink);
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    .gh__btn--static {
      cursor: default;
    }
    .gh__btn:not(.gh__btn--static):hover {
      background: var(--rr-surface-2);
    }
    .gh__bar {
      position: absolute;
      left: 0;
      top: 12px;
      bottom: 12px;
      width: 3px;
      border-radius: 0 2px 2px 0;
      background: var(--rr-line-strong);
    }
    :host([data-tone='accent-2']) .gh__bar {
      background: var(--rr-accent-2);
    }
    :host([data-tone='work']) .gh__bar {
      background: var(--rr-work-dot);
    }
    :host([data-tone='wait']) .gh__bar {
      background: var(--rr-wait-dot);
    }
    :host([data-tone='ok']) .gh__bar {
      background: var(--rr-ok-dot);
    }
    :host([data-tone='muted']) .gh__bar {
      background: var(--rr-muted-dot);
    }
    .gh__title {
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      font-weight: var(--fw-semibold);
    }
    .gh__count {
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      color: var(--rr-ink-2);
    }
    .gh__chev {
      margin-left: auto;
      color: var(--rr-ink-3);
      transition: transform var(--dur) var(--rr-ease-out);
    }
    .gh__chev--collapsed {
      transform: rotate(-90deg);
    }
  `,
})
export class GroupHeader {
  readonly title = input.required<string>();
  readonly count = input<number | null>(null);
  readonly tone = input<GroupTone>(null);
  readonly sticky = input(true);
  readonly collapsible = input(false);
  readonly collapsed = input(false);
  readonly toggle = output<void>();
}
