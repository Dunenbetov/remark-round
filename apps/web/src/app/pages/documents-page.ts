import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { DOCUMENTS, ROLE_TITLE } from '../core/copy';
import { saveBlob } from '../core/download';
import { errorMessage } from '../core/errors';
import type { DocumentKind, ProjectDocument } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { DocCard } from '../ui/doc-card';
import { DocSearch } from '../ui/doc-search';
import { DropZone } from '../ui/drop-zone';
import { EmptyState } from '../ui/empty-state';
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
 * Загружает только руководитель приёмки (и admin); заказчик и разработчик читают и скачивают (20.09): у них вместо
 * дропзоны — «ТЗ ещё не загружено», на карточке нет «Новой версии».
 */
@Component({
  selector: 'rr-documents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, Skeleton, DropZone, DocCard, DocSearch, EmptyState],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header size="lg" [eyebrow]="eyebrow()" [title]="copy.title" [subtitle]="copy.subtitle" />

        @if (store.error() ?? downloadError(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        <div class="grid">
          @if (showSkeleton()) {
            <rr-skeleton class="grid__all" kind="doc-cards" />
          } @else {
            @for (s of slots(); track s.kind; let i = $index) {
              @if (s.doc; as d) {
                <rr-doc-card
                  [doc]="d"
                  [index]="i"
                  [versionLabel]="canUpload() ? copy.newVersion : null"
                  [accept]="accept"
                  [busy]="uploadingKind() === s.kind"
                  [downloadLabel]="copy.download"
                  [downloading]="downloading() === d.id"
                  (file)="upload($event, s.kind)"
                  (download)="download(d)"
                />
              } @else if (!canUpload()) {
                <rr-empty-state class="slot rise" [style.--i]="i" [title]="copy.emptySlot[s.kind].title" [hint]="copy.emptySlot[s.kind].hint" />
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
                <rr-doc-card [doc]="d" [index]="i + 3" [downloadLabel]="copy.download" [downloading]="downloading() === d.id" (download)="download(d)" />
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
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly copy = DOCUMENTS;
  protected readonly accept = ACCEPT;

  /** Какой слот сейчас загружает файл: спиннер только у него. */
  protected readonly uploadingKind = signal<UploadKind | null>(null);
  /** Какой документ сейчас скачиваем (файл идёт с Bearer через blob), и ошибка последней попытки. */
  protected readonly downloading = signal<string | null>(null);
  protected readonly downloadError = signal<string | null>(null);

  private readonly role = computed(() => this.session.roleIn(this.projectId()));
  /** Загружать и заменять документы может руководитель приёмки; сервер отвечает 403 остальным (docs/API.md). */
  protected readonly canUpload = computed(() => this.role() === 'pm' || this.role() === 'admin');

  protected readonly eyebrow = computed(() => {
    const role = this.role();
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

  /** Скачать как загрузили: имя файла — то же, что на карточке (сервер шлёт его и в Content-Disposition). */
  protected async download(d: ProjectDocument): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(d.id);
    this.downloadError.set(null);
    try {
      saveBlob(await this.api.documentFile(this.projectId(), d.id), d.fileName);
    } catch (err) {
      this.downloadError.set(errorMessage(err));
    } finally {
      this.downloading.set(null);
    }
  }

  /** Статус «Читаем документ…» обновляем опросом, пока индексация в фоне. */
  private pollWhileIndexing(): void {
    if (this.timer) clearTimeout(this.timer);
    const pending = this.store.documents().some((d) => d.status === 'uploaded' || d.status === 'parsed');
    if (!pending) return;
    this.timer = setTimeout(() => void this.store.loadDocuments(this.projectId()).then(() => this.pollWhileIndexing()), POLL_MS);
  }
}
