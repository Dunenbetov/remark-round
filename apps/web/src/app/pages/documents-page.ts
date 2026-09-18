import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENTS, ROLE_TITLE } from '../core/copy';
import type { DocumentKind } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { DocCard } from '../ui/doc-card';
import { DocSearch } from '../ui/doc-search';
import { DropZone } from '../ui/drop-zone';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';

const POLL_MS = 2000;
const ACCEPT = '.pdf,.docx,.doc,.md,.txt';

type UploadKind = Exclude<DocumentKind, 'journal_source'>;

/** Типы, которые загружают руками; журнал приходит импортом и места на полке не занимает. */
const UPLOAD_KINDS: ReadonlyArray<UploadKind> = ['spec', 'protocol', 'addendum'];

/**
 * Пакет документов проекта — полка по типам в сетке из трёх равных колонок.
 * Ряд 1: ТЗ · Протокол · Доп. соглашение — последняя версия каждого типа карточкой («Новая версия» внутри)
 * или дропзона именно этого типа, поэтому тип отдельно не выбирают.
 * Ряд 2 (если есть): «Ещё в пакете» — прежние версии и исходники журналов.
 * Последний ряд: поиск «что найдётся» на две колонки + «Зачем документы». Строки тянутся до одной высоты.
 * Пока документ читается (uploaded/parsed), список опрашиваем раз в 2 с.
 */
@Component({
  selector: 'rr-documents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, Skeleton, DropZone, DocCard, DocSearch],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header size="lg" [eyebrow]="eyebrow()" [title]="copy.title" [subtitle]="copy.subtitle" />

        @if (store.error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        <div class="grid">
          @if (showSkeleton()) {
            <rr-skeleton class="grid__all" kind="doc-cards" />
          } @else {
            @for (s of slots(); track s.kind; let i = $index) {
              @if (s.doc; as d) {
                <rr-doc-card [doc]="d" [index]="i" [versionLabel]="copy.newVersion" [accept]="accept" [busy]="uploadingKind() === s.kind" (file)="upload($event, s.kind)" />
              } @else {
                <rr-drop-zone
                  class="slot rise"
                  [style.--i]="i"
                  size="tall"
                  icon="upload"
                  [title]="copy.slot[s.kind].title"
                  [hint]="copy.slot[s.kind].hint"
                  [accept]="accept"
                  [busy]="uploadingKind() === s.kind"
                  (file)="upload($event, s.kind)"
                />
              }
            }

            @if (extras().length) {
              <h2 class="grid__all more">{{ copy.moreTitle }}</h2>
              @for (d of extras(); track d.id; let i = $index) {
                <rr-doc-card [doc]="d" [index]="i + 3" />
              }
            }
          }

          <rr-doc-search class="search" [projectId]="projectId()" [enabled]="store.hasSpec()" />

          <aside class="paper why" [attr.aria-label]="copy.whyTitle">
            <div class="eyebrow">{{ copy.whyTitle }}</div>
            <ul class="why__list">
              @for (line of copy.why; track line) {
                <li>{{ line }}</li>
              }
            </ul>
          </aside>
        </div>
      </main>
    </div>
  `,
  styles: `
    .banner {
      display: block;
      margin-bottom: var(--sp-4);
    }
    /* одна сетка на страницу: три равные колонки, ряды одной высоты */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--sp-6);
      align-items: stretch;
    }
    .grid__all {
      grid-column: 1 / -1;
    }
    .slot {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .more {
      margin: var(--sp-2) 0 calc(var(--sp-2) * -1);
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
      color: var(--rr-ink-2);
    }
    .search {
      grid-column: span 2;
      min-width: 0;
    }
    .why {
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-width: 0;
    }
    .why__list {
      margin: 0;
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      color: var(--rr-ink-2);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .why__list li::marker {
      color: var(--rr-ink-3);
    }
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-4);
      }
      .search {
        grid-column: auto;
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
  protected readonly accept = ACCEPT;

  /** Какой слот сейчас загружает файл: спиннер только у него. */
  protected readonly uploadingKind = signal<UploadKind | null>(null);

  protected readonly eyebrow = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return [role ? ROLE_TITLE[role] : '', this.store.projectName()].filter(Boolean).join(' · ') || null;
  });
  /** Полка: последняя версия каждого типа (API отдаёт документы по createdAt asc) или пустое место. */
  protected readonly slots = computed(() => {
    const docs = this.store.documents();
    return UPLOAD_KINDS.map((kind) => ({ kind, doc: docs.filter((d) => d.kind === kind).at(-1) ?? null }));
  });
  /** Всё, что не стоит на полке: прежние версии и исходники журналов. */
  protected readonly extras = computed(() => {
    const shown = new Set(this.slots().map((s) => s.doc?.id));
    return this.store.documents().filter((d) => !shown.has(d.id));
  });
  protected readonly showSkeleton = computed(() => this.store.loading() && !this.store.documents().length && !this.store.error());

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

  protected async upload(file: File, kind: UploadKind): Promise<void> {
    if (this.uploadingKind()) return;
    this.uploadingKind.set(kind);
    try {
      await this.store.uploadDocument(this.projectId(), file, kind);
    } finally {
      this.uploadingKind.set(null);
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
