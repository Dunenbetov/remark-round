import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DOCUMENTS, DOC_STATUS_LABEL, DOC_STATUS_TONE, EMPTY } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { GlassHeader } from '../ui/glass-header';
import { StatusPill } from '../ui/status-pill';

/** Пакет документов проекта: Тип · Дата · Страниц · Статус. Без ТЗ замечания не разбираем. */
@Component({
  selector: 'rr-documents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassHeader, StatusPill],
  template: `
    <div class="page">
      <rr-glass-header />
      <main class="page__body page__body--loose">
        <section class="col">
          <div class="head">
            <h2 class="col-title">{{ copy.title }}</h2>
            <button type="button" class="btn btn--primary" (click)="store.addDocument()">{{ copy.upload }}</button>
          </div>
          @if (store.hasSpec()) {
            <div class="paper table">
              <div class="row row--head col-title">
                @for (c of copy.columns; track c) {
                  <span>{{ c }}</span>
                }
              </div>
              @for (d of store.documents(); track d.id) {
                <div class="row row--body" [attr.data-status]="d.status">
                  <span class="row__type">
                    <span class="row__label">{{ d.label }}</span>
                    <span class="meta">{{ d.fileName }}</span>
                  </span>
                  <span class="meta num">{{ d.date }}</span>
                  <span class="meta num">{{ copy.pages(d.pages) }}</span>
                  <span><rr-status-pill [label]="statusLabel[d.status]" [toneOverride]="statusTone[d.status]" [pulse]="d.status === 'parsed'" /></span>
                </div>
              }
            </div>
          } @else {
            <div class="paper empty-state">
              <div class="empty-state__text">{{ noSpec }}</div>
              <button type="button" class="btn btn--primary" (click)="store.addDocument()">{{ copy.upload }}</button>
            </div>
          }
        </section>
      </main>
    </div>
  `,
  styles: `
    .col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 760px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .col-title {
      margin: 0;
    }
    .table {
      overflow: hidden;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 120px 100px 180px;
      gap: 16px;
      align-items: center;
      padding: 0 20px;
      border-bottom: 1px solid var(--rr-line);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row--head {
      height: 44px;
    }
    .row--body {
      height: 60px;
      cursor: pointer;
    }
    .row--body:hover {
      background: var(--rr-surface-2);
    }
    .row__type {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .row__label {
      font-weight: 500;
    }
    .row__type .meta {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-state {
      min-height: 225px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
      padding: 24px;
    }
    .empty-state__text {
      font-size: 15px;
      line-height: 22px;
      font-weight: 500;
      max-width: 420px;
    }
    @media (max-width: 720px) {
      .row {
        grid-template-columns: 1fr 100px;
      }
      .row > :nth-child(2),
      .row > :nth-child(3) {
        display: none;
      }
    }
  `,
})
export class DocumentsPage {
  readonly projectId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  protected readonly copy = DOCUMENTS;
  protected readonly noSpec = EMPTY.noSpec;
  protected readonly statusLabel = DOC_STATUS_LABEL;
  protected readonly statusTone = DOC_STATUS_TONE;
}
