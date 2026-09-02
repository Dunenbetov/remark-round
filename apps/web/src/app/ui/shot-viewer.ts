import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import type { ShotVariant } from '../core/models';
import { CARD } from '../core/copy';
import { Shot } from './shot';

export interface ViewerFrame {
  label: string;
  variant: ShotVariant;
}

const ZOOM_STEPS = [75, 100, 125, 150];

/**
 * Полноэкранный просмотр кадра — единственное тёмное место в продукте.
 * Снизу стеклянный тулбар: сегмент было | стало | дифф, зум, «Закрыть».
 */
@Component({
  selector: 'rr-shot-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Shot],
  host: {
    class: 'viewer',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'caption()',
    '(document:keydown.escape)': 'closed.emit()',
  },
  template: `
    <div class="viewer__backdrop" (click)="closed.emit()"></div>
    <div class="viewer__caption">{{ caption() }}</div>
    <div class="viewer__frame" [style.width.px]="760 * (zoom() / 100)">
      <rr-shot [variant]="current().variant" />
    </div>
    <div class="viewer__toolbar glass">
      @if (frames().length > 1) {
        <div class="seg" role="tablist">
          @for (f of frames(); track f.variant) {
            <button type="button" class="seg__btn" role="tab" [attr.aria-selected]="f.variant === current().variant" [class.seg__btn--on]="f.variant === current().variant" (click)="select(f)">
              {{ f.label }}
            </button>
          }
        </div>
      }
      <div class="zoom num">
        <button type="button" class="zoom__btn" aria-label="Уменьшить" (click)="step(-1)">−</button>
        <span class="zoom__value">{{ zoom() }}%</span>
        <button type="button" class="zoom__btn" aria-label="Увеличить" (click)="step(1)">+</button>
      </div>
      <button type="button" class="btn btn--secondary viewer__close" (click)="closed.emit()">{{ closeLabel }}</button>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 24px 24px 100px;
    }
    .viewer__backdrop {
      position: absolute;
      inset: 0;
      background: rgba(31, 27, 22, 0.82);
    }
    .viewer__caption {
      position: relative;
      font-size: 13px;
      line-height: 18px;
      color: rgba(255, 253, 248, 0.8);
    }
    .viewer__frame {
      position: relative;
      max-width: 100%;
      max-height: calc(100vh - 200px);
      overflow: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      border-radius: 8px;
      transition: width 150ms ease;
    }
    .viewer__toolbar {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      height: 52px;
      padding: 0 8px;
      display: flex;
      align-items: center;
      gap: 16px;
      max-width: calc(100vw - 32px);
    }
    .seg {
      display: flex;
      gap: 2px;
      padding: 4px;
      border-radius: 12px;
      background: rgba(31, 27, 22, 0.05);
    }
    .seg__btn {
      height: 32px;
      padding: 0 14px;
      border-radius: 9px;
      border: 0;
      background: transparent;
      font-size: 14px;
      color: var(--rr-ink);
      cursor: pointer;
    }
    .seg__btn--on {
      background: var(--rr-surface);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(31, 27, 22, 0.12);
    }
    .zoom {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .zoom__btn {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      border: 0;
      background: transparent;
      font-size: 18px;
      color: var(--rr-ink);
      cursor: pointer;
    }
    .zoom__btn:hover {
      background: rgba(31, 27, 22, 0.06);
    }
    .zoom__value {
      width: 56px;
      text-align: center;
      font-size: 14px;
      font-weight: 500;
    }
    .viewer__close {
      min-height: 36px;
      padding: 0 14px;
    }
  `,
})
export class ShotViewer {
  readonly title = input.required<string>();
  readonly frames = input.required<ViewerFrame[]>();
  readonly initial = input<ShotVariant>('grey');
  readonly closed = output<void>();

  protected readonly closeLabel = CARD.viewerClose;
  protected readonly zoom = signal(100);
  private readonly selected = signal<ViewerFrame | null>(null);

  protected readonly current = computed<ViewerFrame>(() => {
    const frames = this.frames();
    return this.selected() ?? frames.find((f) => f.variant === this.initial()) ?? frames[0]!;
  });
  protected readonly caption = computed(() => `${this.title()} · ${this.current().label.toLowerCase()}`);

  constructor() {
    effect(() => {
      this.initial();
      untracked(() => this.selected.set(null));
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
}
