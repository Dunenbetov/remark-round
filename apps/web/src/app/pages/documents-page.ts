import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENTS, EMPTY, ROLE_TITLE } from '../core/copy';
import type { DocumentKind } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { DocCard } from '../ui/doc-card';
import { DocSearch } from '../ui/doc-search';
import { DropZone } from '../ui/drop-zone';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Segmented, type SegmentItem } from '../ui/segmented';
import { Skeleton } from '../ui/skeleton';

const POLL_MS = 2000;
const ACCEPT = '.pdf,.docx,.md,.txt';
const MOBILE_QUERY = '(max-width: 900px)';

/** Типы, которые загружают руками; журнал приходит импортом и здесь не выбирается. */
const UPLOAD_KINDS: ReadonlyArray<Exclude<DocumentKind, 'journal_source'>> = ['spec', 'protocol', 'addendum'];

/**
 * Пакет документов проекта. Слева — карточки документов (сетка 2×N) и пустой слот под доп. соглашение,
 * справа — дропзона с выбором типа, поиск «что найдётся» и тихая карточка «Зачем документы».
 * Без ТЗ: левая колонка — одна дропзона с EMPTY.noSpec, поиск выключен.
 * Пока документ читается (uploaded/parsed), список опрашиваем раз в 2 с.
 */
@Component({
  selector: 'rr-documents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, Skeleton, DropZone, Segmented, DocCard, DocSearch],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header size="lg" [eyebrow]="eyebrow()" [title]="copy.title" [subtitle]="copy.subtitle" />

        @if (store.error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        <div class="grid" [class.grid--empty]="isEmpty()">
          <!-- документы -->
          <section class="docs" [attr.aria-label]="copy.title">
            @if (showSkeleton()) {
              <rr-skeleton kind="cards" [rows]="2" />
            } @else if (isEmpty()) {
              <rr-drop-zone size="tall" [title]="copy.dropHint" [accept]="accept" [busy]="uploading()" icon="upload" (file)="upload($event)" />
              <p class="lead docs__empty">{{ noSpec }}</p>
            } @else {
              <div class="cards">
                @for (d of store.documents(); track d.id; let i = $index) {
                  <rr-doc-card [doc]="d" [index]="i" />
                }
                @if (!hasAddendum()) {
                  <div class="slot rise" [style.--i]="store.documents().length" aria-hidden="true">
                    <span class="slot__text">{{ copy.emptySlot }}</span>
                  </div>
                }
              </div>
            }
          </section>

          <!-- загрузка: дропзона + тип -->
          @if (!isEmpty()) {
            <section class="upload" [attr.aria-label]="copy.uploadTitle">
              <rr-drop-zone [size]="narrow() ? 'band' : 'tall'" [title]="copy.dropHint" [accept]="accept" [busy]="uploading()" icon="upload" (file)="upload($event)" />
              <div class="upload__kind">
                <span class="meta upload__label">{{ copy.kindLabel }}</span>
                <rr-segmented [items]="kindItems" [selected]="kind()" [label]="copy.kindLabel" (pick)="pickKind($event)" />
              </div>
            </section>
          }

          <!-- поиск -->
          <rr-doc-search class="search" [projectId]="projectId()" [enabled]="store.hasSpec()" />

          <!-- зачем документы -->
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
      margin-bottom: var(--sp-4);
    }
    /* 8/4: документы занимают всю высоту правой колонки */
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'docs upload'
        'docs search'
        'docs why';
      gap: var(--sp-4) var(--sp-6);
      align-items: start;
    }
    .grid--empty {
      grid-template-rows: auto 1fr;
      grid-template-areas:
        'docs search'
        'docs why';
    }
    .docs {
      grid-area: docs;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .docs__empty {
      margin: 0;
      max-width: 52ch;
      color: var(--rr-ink-2);
      font-weight: var(--fw-medium);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sp-4);
    }
    /* пустой слот: пунктирная карточка под доп. соглашение */
    .slot {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 160px;
      padding: var(--sp-5);
      border: 1px dashed var(--rr-line-strong);
      border-radius: var(--rr-r-lg);
      color: var(--rr-ink-2);
      text-align: center;
    }
    .slot__text {
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      font-weight: var(--fw-medium);
    }
    .upload {
      grid-area: upload;
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-width: 0;
    }
    .upload__kind {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      flex-wrap: wrap;
    }
    .upload__label {
      flex: none;
    }
    .search {
      grid-area: search;
    }
    .why {
      grid-area: why;
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
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
      .grid,
      .grid--empty {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto;
        grid-template-areas:
          'upload'
          'docs'
          'search'
          'why';
      }
      .cards {
        grid-template-columns: minmax(0, 1fr);
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
  protected readonly accept = ACCEPT;
  protected readonly kindItems: SegmentItem[] = UPLOAD_KINDS.map((id) => ({ id, label: DOCUMENTS.kinds[id] }));

  protected readonly uploading = signal(false);
  /** Узкий экран: дропзона становится полосой, колонки — в столбик. */
  protected readonly narrow = signal(false);
  /** Явный выбор человека; пока его нет — ТЗ, если его ещё нет в проекте, иначе Протокол. */
  private readonly pickedKind = signal<DocumentKind | null>(null);
  protected readonly kind = computed<DocumentKind>(() => this.pickedKind() ?? (this.store.hasSpec() ? 'protocol' : 'spec'));

  protected readonly eyebrow = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return [role ? ROLE_TITLE[role] : '', this.store.projectName()].filter(Boolean).join(' · ') || null;
  });
  protected readonly hasAddendum = computed(() => this.store.documents().some((d) => d.kind === 'addendum'));
  protected readonly showSkeleton = computed(() => this.store.loading() && !this.store.documents().length && !this.store.error());
  protected readonly isEmpty = computed(() => !this.store.documents().length && !this.store.loading() && !this.store.error());

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      untracked(() => void this.store.loadDocuments(projectId).then(() => this.pollWhileIndexing()));
    });
    this.watchViewport();
    this.destroyRef.onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected reload(): void {
    void this.store.loadDocuments(this.projectId()).then(() => this.pollWhileIndexing());
  }

  protected pickKind(id: string): void {
    if ((UPLOAD_KINDS as ReadonlyArray<string>).includes(id)) this.pickedKind.set(id as DocumentKind);
  }

  protected async upload(file: File): Promise<void> {
    this.uploading.set(true);
    try {
      await this.store.uploadDocument(this.projectId(), file, this.kind());
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

  /** matchMedia вместо ResizeObserver: нужен только один порог — bp-mobile 900. */
  private watchViewport(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => this.narrow.set(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', apply));
  }
}
