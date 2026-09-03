import { ChangeDetectionStrategy, Component, effect, input, output, signal, untracked } from '@angular/core';
import { PHASE_EXTRA } from '../core/copy';

export type PhaseTone = 'wait' | 'work' | 'muted';

/**
 * Фазовая строка в подвале карточки: точка, короткий текст, при ошибке — «Запустить снова».
 * Текст меняется через fade 180 мс. Не тост и не лог.
 */
@Component({
  selector: 'rr-phase-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'phase', role: 'status', 'aria-live': 'polite' },
  template: `
    <span class="dot" [class.dot--pulse]="pulse()" [class.dot--work]="tone() === 'work'" [class.dot--muted]="tone() === 'muted'"></span>
    <span class="phase__text fade" [style.opacity]="visible() ? 1 : 0">{{ shown() }}</span>
    @if (retryable()) {
      <button type="button" class="btn btn--text" (click)="retry.emit()">{{ retryLabel }}</button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 36px;
      max-width: 100%;
    }
    .phase__text {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
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
