import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EMPTY } from '../core/copy';
import { GlassHeader } from '../ui/glass-header';

/** Чужой проект: экран без данных и надпись «Нет доступа». Без объяснений. */
@Component({
  selector: 'rr-no-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassHeader],
  template: `
    <div class="page">
      <rr-glass-header [brandOnly]="true" />
      <main class="page__body no-access">{{ text }}</main>
    </div>
  `,
  styles: `
    .no-access {
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 28px;
      font-weight: 600;
      color: var(--rr-ink-soft);
      min-height: calc(100vh - 112px);
    }
  `,
})
export class NoAccessPage {
  protected readonly text = EMPTY.noAccess;
}
