import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icons';
import { QUEUE } from '../core/copy';

/**
 * Строка над карточкой: «← Журнал · Ждут вас · 1 из 4 … [← Пред.] [След. →]».
 * Кнопки «Пред./След.» показываются только в очереди (total задан); во время отсчёта (locked) выключены.
 * На узких экранах у кнопок остаются только иконки.
 */
@Component({
  selector: 'rr-card-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="nav">
      <a class="nav__back" [routerLink]="backLink()">
        <rr-icon name="arrow-left" [size]="16" />
        {{ backLabel() }}
      </a>
      @if (queueLabel() && total()) {
        <span class="nav__sep" aria-hidden="true">·</span>
        <span class="nav__queue">{{ queueLabel() }}</span>
        <span class="nav__sep" aria-hidden="true">·</span>
        <span class="nav__pos num">{{ QUEUE.of(index() ?? 0, total()!) }}</span>
      }
      <span class="nav__spacer"></span>
      @if (total()) {
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          [disabled]="locked() || !hasPrev()"
          [title]="QUEUE.prev + ' (←)'"
          (click)="go.emit('prev')"
        >
          <rr-icon name="chevron-left" [size]="16" />
          <span class="nav__btn-text">{{ QUEUE.prev }}</span>
        </button>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          [disabled]="locked() || !hasNext()"
          [title]="QUEUE.next + ' (→)'"
          (click)="go.emit('next')"
        >
          <span class="nav__btn-text">{{ QUEUE.next }}</span>
          <rr-icon name="chevron-right" [size]="16" />
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--sp-3);
    }
    .nav {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: 36px;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .nav__back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--rr-accent-text);
      text-decoration: none;
      font-weight: var(--fw-medium);
    }
    .nav__back:hover {
      text-decoration: underline;
    }
    .nav__sep {
      color: var(--rr-ink-3);
    }
    .nav__queue {
      color: var(--rr-ink-2);
    }
    .nav__pos {
      color: var(--rr-ink);
    }
    .nav__spacer {
      flex: 1;
    }
    /* последняя кнопка вычитает свой паддинг: «Следующее ›» стоит на правом крае бумаги */
    .nav .btn:last-child {
      margin-right: -14px;
    }
    /* узко: кнопки только иконками */
    @media (max-width: 900px) {
      .nav .btn .nav__btn-text {
        display: none;
      }
    }
  `,
})
export class CardNav {
  readonly backLink = input.required<(string | number)[]>();
  readonly backLabel = input.required<string>();
  readonly queueLabel = input<string | null>(null);
  readonly index = input<number | null>(null);
  readonly total = input<number | null>(null);
  readonly hasPrev = input(false);
  readonly hasNext = input(false);
  /** Идёт отсчёт отмены — переходы запрещены. */
  readonly locked = input(false);
  readonly go = output<'prev' | 'next'>();

  protected readonly QUEUE = QUEUE;
}
