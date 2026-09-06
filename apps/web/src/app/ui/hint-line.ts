import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HINT } from '../core/copy';
import { UiStateService } from '../core/ui-state.service';
import { Icon } from './icons';

/**
 * Одна серая строка «что здесь происходит» на первом заходе. Закрывается навсегда (localStorage rr.hint.{key}).
 * Не тур и не онбординг из восьми шагов.
 */
@Component({
  selector: 'rr-hint-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'hint', '[hidden]': '!visible()' },
  template: `
    @if (visible()) {
      <div class="hint__in rise" role="note">
        <rr-icon class="hint__icon" name="info" [size]="16" />
        <span class="hint__text">{{ text() }}</span>
        <button type="button" class="btn btn--text hint__close" (click)="dismiss()">{{ closeLabel }}</button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .hint__in {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 36px;
      padding: 6px 12px 6px 10px;
      border-radius: var(--rr-r-md);
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
      color: var(--rr-ink-2);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      width: fit-content;
      max-width: 100%;
    }
    .hint__icon {
      color: var(--rr-ink-3);
    }
    .hint__close {
      font-weight: var(--fw-medium);
      margin-left: var(--sp-1);
    }
  `,
})
export class HintLine {
  /** Ключ подсказки: `journal.pm`, `card.business`… */
  readonly key = input.required<string>();
  readonly text = input.required<string>();

  private readonly ui = inject(UiStateService);
  private readonly dismissed = signal(false);
  protected readonly closeLabel = HINT.close;
  protected readonly visible = computed(() => !this.dismissed() && !this.ui.hintSeen(this.key()));

  protected dismiss(): void {
    this.dismissed.set(true);
    this.ui.dismissHint(this.key());
  }
}
