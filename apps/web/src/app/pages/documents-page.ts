import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENTS, DOC_STATUS_LABEL, DOC_STATUS_TONE, EMPTY, ROLE_TITLE } from '../core/copy';
import type { DocumentKind } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';
import { StatusPill } from '../ui/status-pill';

const POLL_MS = 2000;

/** Пакет документов проекта: Тип · Дата · Страниц · Статус. Без ТЗ замечания не разбираем. */
@Component({
  selector: 'rr-documents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, EmptyState, Skeleton, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="roleTitle()" [subtitle]="store.projectName() || null">
          <button actions type="button" class="btn btn--primary" [class.btn--busy]="uploading()" [disabled]="uploading()" (click)="file.click()">{{ copy.upload }}</button>
        </rr-page-header>
        <input #file type="file" class="visually-hidden" accept=".pdf,.docx,.md,.txt" (change)="upload($event)" />

        <section class="col">
          <h2 class="col-title">{{ copy.title }}</h2>
          @if (store.error(); as err) {
            <rr-error-banner [message]="err" [busy]="store.loading()" (retry)="reload()" />
          }
          @if (store.documents().length) {
            <div class="paper tbl-wrap">
              <table class="tbl docs">
                <caption class="visually-hidden">{{ copy.title }}</caption>
                <colgroup>
                  <col />
                  <col class="docs__c-date" />
                  <col class="docs__c-pages" />
                  <col class="docs__c-status" />
                </colgroup>
                <thead>
                  <tr>
                    @for (c of copy.columns; track c) {
                      <th scope="col">{{ c }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (d of store.documents(); track d.id) {
                    <tr class="tbl__row docs__row" [attr.data-status]="d.status">
                      <td class="docs__type">
                        <span class="docs__label">{{ d.label }}</span>
                        <span class="meta docs__file">{{ d.fileName }}</span>
                      </td>
                      <td class="meta num">{{ d.date }}</td>
                      <td class="meta num">{{ d.pages !== null ? copy.pages(d.pages) : '—' }}</td>
                      <td><rr-status-pill [label]="statusLabel[d.status]" [toneOverride]="statusTone[d.status]" [pulse]="d.status === 'parsed' || d.status === 'uploaded'" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (store.loading() && !store.error()) {
            <rr-skeleton kind="table" [rows]="3" />
          } @else if (!store.error()) {
            <rr-empty-state [title]="noSpec">
              <button cta type="button" class="btn btn--primary" (click)="file.click()">{{ copy.upload }}</button>
            </rr-empty-state>
          }
        </section>
      </main>
    </div>
  `,
  styles: `
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      max-width: 800px;
    }
    .col-title {
      margin: 0;
    }
    .docs__c-date {
      width: 120px;
    }
    .docs__c-pages {
      width: 110px;
    }
    .docs__c-status {
      width: 190px;
    }
    .docs__row {
      height: 60px;
    }
    .docs__type {
      max-width: 0;
    }
    .docs__label {
      display: block;
      font-weight: var(--fw-medium);
    }
    .docs__file {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 720px) {
      .docs__c-date,
      .docs__c-pages,
      .docs :is(td, th):nth-child(2),
      .docs :is(td, th):nth-child(3) {
        display: none;
      }
      .docs__c-status {
        width: 150px;
      }
    }
  `,
})
export class DocumentsPage {
  readonly projectId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly copy = DOCUMENTS;
  protected readonly noSpec = EMPTY.noSpec;
  protected readonly statusLabel = DOC_STATUS_LABEL;
  protected readonly statusTone = DOC_STATUS_TONE;
  protected readonly uploading = signal(false);
  protected readonly roleTitle = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return role ? ROLE_TITLE[role] : '';
  });
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      untracked(() => void this.store.loadDocuments(projectId).then(() => this.pollWhileIndexing()));
    });
    this.destroyRef.onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected reload(): void {
    void this.store.loadDocuments(this.projectId()).then(() => this.pollWhileIndexing());
  }

  protected async upload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const kind: DocumentKind = this.store.hasSpec() ? 'addendum' : 'spec';
    this.uploading.set(true);
    try {
      await this.store.uploadDocument(this.projectId(), file, kind);
    } finally {
      this.uploading.set(false);
    }
    this.pollWhileIndexing();
  }

  /** Статус «Читаем документ…» обновляем опросом, пока индексация в фоне. */
  private pollWhileIndexing(): void {
    if (this.timer) clearTimeout(this.timer);
    const pending = this.store.documents().some((d) => d.status === 'uploaded' || d.status === 'parsed');
    if (!pending) return;
    this.timer = setTimeout(() => void this.store.loadDocuments(this.projectId()).then(() => this.pollWhileIndexing()), POLL_MS);
  }
}
