import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface SegmentItem {
  id: string;
  label: string;
  /** Счётчик медью (закон меди, п. в): показывается только при > 0. */
  count?: number;
  /** Есть ссылка → сегмент рендерится как <a routerLink>, иначе — кнопка. */
  link?: unknown[];
}

/**
 * Сегментированный переключатель: капсула на утопленном фоне, активный сегмент — «бумага» с тенью,
 * подложка скользит между сегментами. Шапка (разделы), тип документа, табы кадров.
 */
@Component({
  selector: 'rr-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: {
    class: 'seg',
    role: 'group',
    '[attr.aria-label]': 'label() || null',
    '[style.--seg-x.px]': 'x()',
    '[style.--seg-w.px]': 'w()',
    '[class.seg--measured]': 'w() > 0',
  },
  template: `
    @for (it of items(); track it.id) {
      @if (it.link) {
        <a
          class="seg__item"
          [class.seg__item--on]="it.id === selected()"
          [attr.aria-current]="it.id === selected() ? 'page' : null"
          [attr.data-id]="it.id"
          [routerLink]="it.link"
          (click)="pick.emit(it.id)"
        >
          <span class="seg__label">{{ it.label }}</span>
          @if (it.count) {
            <span class="seg__count num">{{ it.count }}</span>
          }
        </a>
      } @else {
        <button
          type="button"
          class="seg__item"
          [class.seg__item--on]="it.id === selected()"
          [attr.aria-pressed]="it.id === selected()"
          [attr.data-id]="it.id"
          (click)="pick.emit(it.id)"
        >
          <span class="seg__label">{{ it.label }}</span>
          @if (it.count) {
            <span class="seg__count num">{{ it.count }}</span>
          }
        </button>
      }
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 36px;
      padding: 3px;
      border-radius: var(--rr-r-md);
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      isolation: isolate;
    }
    /* скользящая подложка под активным сегментом */
    :host::before {
      content: '';
      position: absolute;
      top: 3px;
      bottom: 3px;
      left: 0;
      width: var(--seg-w, 0px);
      transform: translateX(var(--seg-x, 0px));
      border-radius: calc(var(--rr-r-md) - 3px);
      background: var(--rr-surface);
      box-shadow: var(--rr-shadow-1);
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }
    :host(.seg--measured)::before {
      opacity: 1;
      transition: transform 220ms var(--rr-ease-in-out), width 220ms var(--rr-ease-in-out);
    }
    .seg__item {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 12px;
      border: 0;
      border-radius: calc(var(--rr-r-md) - 3px);
      background: transparent;
      color: var(--rr-ink-2);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      font-weight: var(--fw-medium);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition: color var(--dur-fast) var(--ease);
    }
    .seg__item:hover {
      color: var(--rr-ink);
    }
    .seg__item--on {
      color: var(--rr-ink);
      font-weight: var(--fw-semibold);
    }
    .seg__item:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 1px;
    }
    .seg__count {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      font-weight: var(--fw-semibold);
      color: var(--rr-accent-2-text);
    }
  `,
})
export class Segmented {
  readonly items = input.required<SegmentItem[]>();
  readonly selected = input<string | null>(null);
  readonly label = input<string>('');
  readonly pick = output<string>();

  protected readonly x = signal(0);
  protected readonly w = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private ro: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      this.items();
      this.selected();
      afterNextRender(() => this.measure(), { injector: this.injector });
    });
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.host.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => this.ro?.disconnect());
  }

  private measure(): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('.seg__item--on');
    if (!el) {
      this.w.set(0);
      return;
    }
    this.x.set(el.offsetLeft);
    this.w.set(el.offsetWidth);
  }
}
