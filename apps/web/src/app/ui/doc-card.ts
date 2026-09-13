import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { COMMON, DOCUMENTS, DOC_STATUS_LABEL, DOC_STATUS_TONE } from '../core/copy';
import type { ProjectDocument } from '../core/models';
import { Icon, type IconName } from './icons';
import { StatusPill } from './status-pill';

/** Расширения, которые показываем как «текст», остальное — «документ». */
const TEXT_EXT = new Set(['md', 'txt', 'markdown']);

/**
 * Карточка документа проекта: eyebrow типа, имя файла, «дата · N фрагментов», пилюля статуса.
 * Число фрагментов — то, что реально попадёт в поиск; страниц нет (у сервера их нет).
 * Пульс на uploaded/parsed — документ ещё читаем; failed — под пилюлей подсказка загрузить снова.
 * С `versionLabel` справа внизу — «Новая версия»: выбор файла того же типа.
 */
@Component({
  selector: 'rr-doc-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, StatusPill],
  host: {
    class: 'paper paper--lift rise dc',
    '[style.--i]': 'index()',
    '[attr.data-status]': 'doc().status',
    '[attr.data-kind]': 'doc().kind',
  },
  template: `
    <div class="dc__top">
      <span class="dc__icon" aria-hidden="true"><rr-icon [name]="icon()" [size]="18" /></span>
      <span class="eyebrow dc__kind">{{ kindLabel() }}</span>
    </div>
    <div class="dc__name" [title]="doc().fileName">{{ doc().fileName }}</div>
    <div class="meta num dc__meta">{{ metaLine() }}</div>
    <div class="dc__foot">
      <div class="dc__state">
        <rr-status-pill [label]="statusLabel[doc().status]" [toneOverride]="statusTone[doc().status]" [dot]="true" [pulse]="pulse()" />
        @if (doc().status === 'failed') {
          <span class="meta dc__retry">{{ retryUpload }}</span>
        }
      </div>
      @if (versionLabel(); as label) {
        <label class="btn btn--text btn--sm dc__version" [class.dc__version--busy]="busy()">
          <input type="file" class="visually-hidden" [accept]="accept()" [disabled]="busy()" (change)="onPick($event)" />
          <rr-icon name="upload" [size]="16" />
          {{ busy() ? uploading : label }}
        </label>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      min-height: 184px;
      padding: var(--sp-5);
      min-width: 0;
    }
    .dc__top {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      margin-bottom: var(--sp-1);
    }
    .dc__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--rr-r-sm);
      border: 1px solid var(--rr-line);
      background: var(--rr-surface-2);
      color: var(--rr-ink-2);
      flex: none;
    }
    .dc__kind {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dc__name {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dc__foot {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--sp-3);
      margin-top: auto;
      padding-top: var(--sp-2);
    }
    .dc__state {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--sp-2);
      min-width: 0;
    }
    /* «Новая версия» — label над скрытым input[type=file], как в rr-drop-zone: клик открывает выбор файла */
    .dc__version {
      flex: none;
      gap: var(--sp-1);
      cursor: pointer;
    }
    .dc__version:has(:focus-visible) {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .dc__version--busy {
      cursor: progress;
      color: var(--rr-ink-2);
    }
    :host([data-status='failed']) .dc__icon {
      color: var(--rr-danger);
    }
  `,
})
export class DocCard {
  readonly doc = input.required<ProjectDocument>();
  /** Индекс в сетке — задержка лестницы появления (.rise). */
  readonly index = input(0);
  /** Подпись кнопки загрузки новой версии этого типа; без неё кнопки нет. */
  readonly versionLabel = input<string | null>(null);
  readonly accept = input('');
  readonly busy = input(false);
  /** Файл новой версии; тип документа знает страница (слот полки). */
  readonly file = output<File>();

  protected readonly statusLabel = DOC_STATUS_LABEL;
  protected readonly statusTone = DOC_STATUS_TONE;
  protected readonly retryUpload = DOCUMENTS.retryUpload;
  protected readonly uploading = COMMON.loading;

  protected onPick(e: Event): void {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f) this.file.emit(f);
    el.value = '';
  }

  protected readonly kindLabel = computed(() => DOCUMENTS.kinds[this.doc().kind]);
  protected readonly pulse = computed(() => this.doc().status === 'uploaded' || this.doc().status === 'parsed');

  /** md/txt — «лист с текстом», pdf/docx и всё остальное — «документ». */
  protected readonly icon = computed<IconName>(() => {
    const name = this.doc().fileName.toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    return TEXT_EXT.has(ext) ? 'file-text' : 'document';
  });

  /** «14.01 · 142 фрагмента»; пока фрагментов нет и документ не проиндексирован — только дата. */
  protected readonly metaLine = computed(() => {
    const d = this.doc();
    const chunks = d.chunks ?? 0;
    return chunks > 0 || d.status === 'indexed' ? `${d.date} · ${DOCUMENTS.chunks(chunks)}` : d.date;
  });
}
