import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Citation as CitationModel } from '../core/models';
import { CARD } from '../core/copy';

/** Цитата из документа: полоса слева, заголовок «В ТЗ (§2.1):», текст «…», ссылка «Открыть документ». */
@Component({
  selector: 'rr-citation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'cite fade', '[class.cite--soft]': 'citation().soft', '[style.opacity]': 'visible() ? 1 : 0' },
  template: `
    <div class="cite__head">{{ citation().heading }}</div>
    <div class="cite__text">{{ citation().text }}</div>
    @if (citation().source === 'spec' && documentsLink()) {
      <a class="link" [routerLink]="documentsLink()">{{ copy.openDocument }}</a>
    }
  `,
})
export class Citation {
  readonly citation = input.required<CitationModel>();
  readonly documentsLink = input<unknown[] | null>(null);
  readonly visible = input(true);
  protected readonly copy = CARD;
}
