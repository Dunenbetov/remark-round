import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EMPTY } from '../core/copy';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';

/** Чужой проект: экран без данных и надпись «Нет доступа». Без объяснений. */
@Component({
  selector: 'rr-no-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, EmptyState],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body no-access">
        <rr-empty-state class="no-access__box" [title]="text" />
      </main>
    </div>
  `,
  styles: `
    .no-access {
      align-items: center;
      justify-content: center;
    }
    .no-access__box {
      width: min(480px, 100%);
    }
  `,
})
export class NoAccessPage {
  protected readonly text = EMPTY.noAccess;
}
