import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icons';
import { QUEUE, STATUS_TONE, type PillTone } from '../core/copy';
import type { RemarkStatus } from '../core/models';

export interface RailItem {
  id: string;
  number: number;
  title: string;
  status: RemarkStatus;
  link: (string | number)[];
  /** Решение уже принято — галочка вместо точки статуса. */
  done: boolean;
}

/**
 * Рельс очереди слева от карточки: «Ждут вас · 4», список замечаний, внизу «1 из 4» и точки прогресса.
 * Активный элемент — «бумага» с медной полосой слева (закон меди); полоса переезжает view-transition.
 * Пока идёт 5-секундный отсчёт (locked) — переходы запрещены.
 */
@Component({
  selector: 'rr-queue-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <nav class="rail" [attr.aria-label]="label()">
      <div class="eyebrow rail__label">{{ label() }} · {{ items().length }}</div>
      <ol class="rail__list">
        @for (it of items(); track it.id; let i = $index) {
          <li>
            <a
              class="rail__item rise"
              [style.--i]="i"
              [routerLink]="it.link"
              [class.rail__item--on]="it.id === activeId()"
              [class.rail__item--done]="it.done"
              [attr.aria-current]="it.id === activeId() ? 'page' : null"
              [attr.aria-disabled]="locked() ? 'true' : null"
              [attr.tabindex]="locked() ? -1 : null"
              (click)="onClick($event, it)"
            >
              <span
                class="rail__bar"
                aria-hidden="true"
                [style.viewTransitionName]="it.id === activeId() ? 'rail-marker' : null"
              ></span>
              <span class="n-serif rail__n">{{ it.number }}</span>
              <span class="rail__title">{{ it.title }}</span>
              @if (it.done) {
                <rr-icon name="check" [size]="16" class="rail__check" />
              } @else {
                <span class="dot" [class]="'dot dot--' + tone(it.status)" [class.dot--pulse]="it.status === 'triaging'"></span>
              }
            </a>
          </li>
        }
      </ol>
      <div class="rail__foot">
        <span class="meta num">{{ QUEUE.of(index(), items().length) }}</span>
        <span class="rail__dots" aria-hidden="true">
          @for (it of items(); track it.id) {
            <span class="rail__dot" [class.rail__dot--fill]="it.done || it.id === activeId()"></span>
          }
        </span>
      </div>
    </nav>
  `,
  styles: `
    :host {
      display: block;
      width: var(--rr-rail-w);
      position: sticky;
      top: calc(var(--rr-bar-h) + var(--sp-4));
      align-self: start;
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-lg);
      padding: var(--sp-3);
    }
    @media (max-width: 1279px) {
      :host {
        display: none;
      }
    }
    .rail__label {
      color: var(--rr-ink-2);
      padding: var(--sp-1) var(--sp-2) var(--sp-3);
    }
    .rail__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: calc(100vh - var(--rr-bar-h) - 160px);
      overflow: auto;
    }
    .rail__item {
      position: relative;
      display: grid;
      grid-template-columns: 28px 1fr 16px;
      align-items: center;
      gap: var(--sp-2);
      min-height: 60px;
      padding: 0 var(--sp-3) 0 var(--sp-4);
      border-radius: var(--rr-r-md);
      color: var(--rr-ink);
      text-decoration: none;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .rail__item:hover {
      background: var(--rr-surface);
    }
    .rail__item:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: -2px;
    }
    .rail__item--on {
      background: var(--rr-surface);
      box-shadow: var(--rr-shadow-1);
    }
    .rail__item--on .rail__title {
      font-weight: var(--fw-semibold);
    }
    /* полоса слева: медь только у активного (закон меди) */
    .rail__bar {
      position: absolute;
      left: 0;
      top: 12px;
      bottom: 12px;
      width: 3px;
      border-radius: 0 2px 2px 0;
      background: transparent;
    }
    .rail__item--on .rail__bar {
      background: var(--rr-accent-2);
    }
    .rail__n {
      color: var(--rr-ink-2);
    }
    .rail__title {
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rail__item--done .rail__title {
      color: var(--rr-ink-2);
    }
    .rail__check {
      color: var(--rr-ok-dot);
    }
    .rail__item .dot {
      justify-self: center;
    }
    [aria-disabled='true'] {
      pointer-events: none;
      opacity: 0.7;
    }
    .rail__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-3) var(--sp-2) 0;
    }
    .rail__dots {
      display: flex;
      gap: 4px;
    }
    .rail__dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--rr-line-strong);
    }
    .rail__dot--fill {
      background: var(--rr-accent-2);
    }
  `,
})
export class QueueRail {
  readonly label = input.required<string>();
  readonly items = input.required<RailItem[]>();
  readonly activeId = input<string | null>(null);
  /** Идёт отсчёт отмены — переходы по рельсу запрещены. */
  readonly locked = input(false);
  /** id элемента — эмитится при клике ДО навигации (страница запишет ui.lastRemarkId). */
  readonly pick = output<string>();

  protected readonly QUEUE = QUEUE;

  /** Позиция активного среди элементов (1-based; 0 — если активного нет). */
  protected readonly index = computed(() => this.items().findIndex((it) => it.id === this.activeId()) + 1);

  protected tone(status: RemarkStatus): PillTone {
    return STATUS_TONE[status];
  }

  protected onClick(e: MouseEvent, it: RailItem): void {
    if (this.locked()) {
      e.preventDefault();
      return;
    }
    this.pick.emit(it.id);
  }
}
