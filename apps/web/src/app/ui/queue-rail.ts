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
 * Рельс очереди слева от карточки — индиго-объект экрана: «Ждут вас · 4», список, внизу «1 из 4» и точки.
 * Активный элемент залит аквой (закон аквы п. а); заливка переезжает view-transition.
 * Пока идёт 5-секундный отсчёт (locked) — переходы запрещены.
 */
@Component({
  selector: 'rr-queue-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <nav class="rail" [attr.aria-label]="label()">
      <div class="eyebrow rail__label"><span>{{ label() }}</span><span class="rail__count">{{ items().length }}</span></div>
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
                <span class="dot" [class.dot--pulse]="it.status === 'triaging'"></span>
              }
            </a>
          </li>
        }
      </ol>
      <div class="rail__foot">
        <span class="meta num">{{ QUEUE.of(index(), items().length) }}</span>
      </div>
    </nav>
  `,
  styles: `
    :host {
      display: block;
      width: var(--rr-rail-w);
      position: sticky;
      top: calc(var(--rr-bar-h) + var(--sp-6));
      align-self: start;
      background: linear-gradient(170deg, var(--rr-accent-2nd), var(--rr-accent) 55%, var(--rr-accent-deep));
      color: var(--rr-accent-ink);
      border-radius: var(--rr-r-xl);
      padding: var(--sp-5) var(--sp-4) var(--sp-4);
      box-shadow: var(--rr-shadow-ink), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    @media (max-width: 1279px) {
      :host {
        display: none;
      }
    }
    .rail__label {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      color: rgba(255, 255, 255, 0.65);
      padding: 0 var(--sp-2) var(--sp-4);
    }
    .rail__count {
      font-family: var(--rr-serif);
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      font-weight: var(--fw-medium);
      letter-spacing: 0;
      text-transform: none;
      color: var(--rr-accent-2);
    }
    .rail__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: calc(100vh - var(--rr-bar-h) - 180px);
      overflow: auto;
    }
    .rail__item {
      position: relative;
      display: grid;
      grid-template-columns: 30px 1fr 12px;
      align-items: center;
      gap: var(--sp-2);
      min-height: 52px;
      padding: 0 var(--sp-3) 0 var(--sp-3);
      border-radius: var(--rr-r-md);
      color: rgba(255, 255, 255, 0.86);
      text-decoration: none;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .rail__item:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--rr-accent-ink);
    }
    .rail__item:focus-visible {
      outline: 2px solid var(--rr-accent-2);
      outline-offset: -2px;
    }
    /* активный — аква с индиго-текстом (закон аквы п. а); маркер переезжает view-transition */
    .rail__item--on,
    .rail__item--on:hover {
      background: var(--rr-accent-2);
      color: var(--rr-accent);
      box-shadow: 0 10px 24px -10px rgba(149, 251, 242, 0.8);
    }
    .rail__item--on .rail__title {
      font-weight: var(--fw-semibold);
    }
    .rail__bar {
      position: absolute;
      inset: 0;
      border-radius: var(--rr-r-md);
      pointer-events: none;
    }
    .rail__n {
      color: inherit;
      opacity: 0.75;
    }
    .rail__item--on .rail__n {
      opacity: 1;
    }
    .rail__title {
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rail__item--done .rail__title {
      opacity: 0.7;
    }
    .rail__check {
      color: var(--rr-accent-2);
    }
    .rail__item--on .rail__check {
      color: var(--rr-accent);
    }
    /* точки у пунктов — только пульс «разбираем»; статус читается словами на карточке */
    .rail__item .dot {
      justify-self: center;
      background: transparent;
    }
    .rail__item .dot--pulse {
      background: rgba(255, 255, 255, 0.7);
    }
    [aria-disabled='true'] {
      pointer-events: none;
      opacity: 0.6;
    }
    .rail__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-4) var(--sp-2) 0;
      color: rgba(255, 255, 255, 0.7);
    }
    .rail__foot .meta {
      color: inherit;
    }
    .rail__dots {
      display: flex;
      gap: 5px;
    }
    .rail__dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.3);
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
