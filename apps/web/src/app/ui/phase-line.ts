import { ChangeDetectionStrategy, Component, effect, input, output, signal, untracked } from '@angular/core';
import { PHASE_EXTRA } from '../core/copy';

export type PhaseTone = 'wait' | 'work' | 'muted';

/**
 * Фазовая строка: стекло, липкая к низу окна. Текст меняется через fade 180 мс.
 * Ошибка — та же строка с текстовой кнопкой «Запустить снова», не тост.
 */
@Component({
  selector: 'rr-phase-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'phase-wrap' },
  template: `
    <div class="glass glass--pill phase" role="status" aria-live="polite">
      <span class="dot" [class.dot--pulse]="pulse()" [class.dot--work]="tone() === 'work'" [class.dot--muted]="tone() === 'muted'"></span>
      <span class="phase__text fade" [style.opacity]="visible() ? 1 : 0">{{ shown() }}</span>
      @if (retryable()) {
        <button type="button" class="btn btn--text" (click)="retry.emit()">{{ retryLabel }}</button>
      }
    </div>
  `,
  styles: `
    :host {
      position: sticky;
      bottom: 0;
      z-index: 4;
      display: flex;
      justify-content: center;
      padding: 16px 0 20px;
      margin-top: auto;
      pointer-events: none;
    }
    .phase {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      height: 36px;
      padding: 0 16px 0 14px;
      width: max-content;
      max-width: calc(100vw - 32px);
    }
    .phase__text {
      font-size: 13px;
      line-height: 18px;
      color: var(--rr-ink-soft);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class PhaseLine {
  readonly text = input.required<string>();
  readonly tone = input<PhaseTone>('wait');
  readonly pulse = input(true);
  readonly retryable = input(false);
  readonly retry = output<void>();

  protected readonly retryLabel = PHASE_EXTRA.retry;
  protected readonly shown = signal('');
  protected readonly visible = signal(true);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const next = this.text();
      untracked(() => {
        if (this.shown() === '') {
          this.shown.set(next);
          return;
        }
        if (this.shown() === next) return;
        if (this.timer) clearTimeout(this.timer);
        this.visible.set(false);
        this.timer = setTimeout(() => {
          this.shown.set(next);
          this.visible.set(true);
        }, 180);
      });
    });
  }
}
