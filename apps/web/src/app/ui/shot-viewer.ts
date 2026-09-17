import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { ShotVariant } from '../core/models';
import { CARD, VIEWER } from '../core/copy';
import { Shot } from './shot';

export interface ViewerFrame {
  label: string;
  variant: ShotVariant;
  src?: string | null;
}

const ZOOM_STEPS = [75, 100, 125, 150];

/**
 * Полноэкранный просмотр кадра — единственное тёмное место в продукте.
 * Диалог: фокус входит на «Закрыть», ходит по кругу, Esc закрывает и возвращает фокус, фон не скроллится.
 */
@Component({
  selector: 'rr-shot-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Shot],
  host: {
    class: 'viewer',
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
    '[attr.aria-labelledby]': 'captionId',
    '(document:keydown.escape)': 'closed.emit()',
    '(keydown)': 'trap($event)',
  },
  template: `
    <div class="viewer__backdrop" (click)="closed.emit()"></div>
    <div class="viewer__caption" [id]="captionId">{{ caption() }}</div>
    <div class="viewer__frame" [style.width.px]="760 * (zoom() / 100)">
      <rr-shot [variant]="current().variant" [src]="current().src" />
    </div>
    <div class="viewer__toolbar glass">
      @if (frames().length > 1) {
        <div class="seg" role="tablist">
          @for (f of frames(); track f.label) {
            <button type="button" class="seg__btn" role="tab" [attr.aria-selected]="f === current()" [class.seg__btn--on]="f === current()" (click)="select(f)">
              {{ f.label }}
            </button>
          }
        </div>
      }
      <div class="zoom num">
        <button type="button" class="zoom__btn" [attr.aria-label]="copy.zoomOut" [disabled]="zoom() === minZoom" (click)="step(-1)">−</button>
        <span class="zoom__value" aria-live="polite">{{ zoom() }}%</span>
        <button type="button" class="zoom__btn" [attr.aria-label]="copy.zoomIn" [disabled]="zoom() === maxZoom" (click)="step(1)">+</button>
      </div>
      <button type="button" class="btn btn--secondary viewer__close" (click)="closed.emit()">{{ closeLabel }}</button>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sp-4);
      padding: var(--sp-6) var(--sp-6) 100px;
      outline: none;
    }
    :host :focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
    }
    .viewer__backdrop {
      position: absolute;
      inset: 0;
      background: var(--rr-scrim);
    }
    .viewer__caption {
      position: relative;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: rgba(255, 253, 248, 0.85);
    }
    .viewer__frame {
      position: relative;
      max-width: 100%;
      max-height: calc(100vh - 200px);
      overflow: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      border-radius: var(--rr-r-md);
      transition: width var(--dur) var(--ease);
    }
    .viewer__toolbar {
      position: absolute;
      bottom: var(--sp-6);
      left: 50%;
      transform: translateX(-50%);
      height: 56px;
      padding: 0 var(--sp-2);
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      max-width: calc(100vw - 32px);
      border-radius: var(--rr-r-pill);
    }
    .seg {
      display: flex;
      gap: 2px;
      padding: 4px;
      border-radius: var(--rr-r-pill);
      background: color-mix(in srgb, var(--rr-ink) 6%, transparent);
    }
    .seg__btn {
      height: 36px;
      padding: 0 14px;
      border-radius: var(--rr-r-pill);
      border: 0;
      background: transparent;
      font-size: var(--fs-14);
      color: var(--rr-ink);
      cursor: pointer;
    }
    .seg__btn--on {
      background: var(--rr-surface);
      font-weight: var(--fw-semibold);
      box-shadow: var(--rr-shadow-1);
    }
    .zoom {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .zoom__btn {
      width: 40px;
      height: 40px;
      border-radius: var(--rr-r-pill);
      border: 0;
      background: transparent;
      font-size: 20px;
      color: var(--rr-ink);
      cursor: pointer;
    }
    .zoom__btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--rr-ink) 6%, transparent);
    }
    .zoom__btn:disabled {
      color: var(--rr-ink-3);
      cursor: default;
    }
    .zoom__value {
      width: 56px;
      text-align: center;
      font-size: var(--fs-14);
      font-weight: var(--fw-medium);
    }
    .viewer__close {
      min-height: 40px;
      padding: 0 16px;
    }
    @media (max-width: 720px) {
      :host {
        padding: var(--sp-4) var(--sp-3) 100px;
      }
      .viewer__toolbar {
        gap: var(--sp-2);
      }
      .seg__btn {
        padding: 0 10px;
      }
    }
  `,
})
export class ShotViewer {
  readonly title = input.required<string>();
  readonly frames = input.required<ViewerFrame[]>();
  readonly initial = input<number>(0);
  readonly closed = output<void>();

  protected readonly copy = VIEWER;
  protected readonly closeLabel = CARD.viewerClose;
  protected readonly zoom = signal(100);
  protected readonly minZoom = ZOOM_STEPS[0]!;
  protected readonly maxZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  protected readonly captionId = `rr-viewer-${Math.random().toString(36).slice(2, 8)}`;
  private readonly selected = signal<ViewerFrame | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  protected readonly current = computed<ViewerFrame>(() => {
    const frames = this.frames();
    return this.selected() ?? frames[this.initial()] ?? frames[0]!;
  });
  protected readonly caption = computed(() => `${this.title()} · ${this.current().label.toLowerCase()}`);

  constructor() {
    effect(() => {
      this.initial();
      untracked(() => this.selected.set(null));
    });
    afterNextRender(() => {
      document.documentElement.style.overflow = 'hidden';
      (this.host.nativeElement.querySelector<HTMLElement>('.viewer__close') ?? this.host.nativeElement).focus();
    });
    inject(DestroyRef).onDestroy(() => {
      document.documentElement.style.overflow = '';
      this.opener?.focus?.();
    });
  }

  protected select(frame: ViewerFrame): void {
    this.selected.set(frame);
  }

  protected step(dir: 1 | -1): void {
    const i = ZOOM_STEPS.indexOf(this.zoom());
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]!;
    this.zoom.set(next);
  }

  /** Фокус ходит по кругу внутри диалога. */
  protected trap(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const els = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.host.nativeElement)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
