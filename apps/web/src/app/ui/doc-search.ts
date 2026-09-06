import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { DOCUMENTS, ERROR } from '../core/copy';
import type { Citation as CitationModel, SearchHit } from '../core/models';
import { Citation } from './citation';
import { Icon } from './icons';

const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;
const TOP_K = 5;

/**
 * «Проверить, что найдётся»: поле поиска по документам проекта, результаты — как цитаты на карточке.
 * Enter — сразу, иначе debounce 400 мс от трёх символов. Score и страница на экран не выводятся:
 * человек видит только текст фрагмента и откуда он. Без ТЗ поле выключено.
 */
@Component({
  selector: 'rr-doc-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Citation, Icon],
  host: { class: 'paper ds' },
  template: `
    <div class="eyebrow">{{ copy.searchTitle }}</div>
    <div class="ds__field" [class.ds__field--off]="!enabled()">
      <span class="ds__icon" aria-hidden="true"><rr-icon name="search" [size]="18" /></span>
      <input
        class="input ds__input"
        type="search"
        autocomplete="off"
        spellcheck="false"
        [placeholder]="copy.searchPlaceholder"
        [attr.aria-label]="copy.searchTitle"
        [disabled]="!enabled()"
        [value]="q()"
        (input)="onInput($event)"
        (keydown.enter)="onEnter($event)"
      />
      @if (busy()) {
        <span class="ds__spin" aria-hidden="true"></span>
      }
    </div>

    @if (!enabled()) {
      <p class="meta ds__note">{{ copy.searchDisabled }}</p>
    } @else if (error()) {
      <p class="meta ds__note" role="status">{{ errorText }}</p>
    } @else if (citations().length) {
      <ul class="ds__list" role="list" aria-live="polite">
        @for (c of citations(); track c.id; let i = $index) {
          <li class="ds__item rise" [style.--i]="i">
            <rr-citation [citation]="c" />
          </li>
        }
      </ul>
    } @else if (searched() && !busy()) {
      <p class="meta ds__note" role="status">{{ copy.searchEmpty }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      padding: var(--sp-4);
      min-width: 0;
    }
    .ds__field {
      position: relative;
    }
    .ds__icon {
      position: absolute;
      left: var(--sp-3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--rr-ink-2);
      pointer-events: none;
    }
    .ds__field--off .ds__icon {
      color: var(--rr-ink-3);
    }
    .ds__input {
      padding-left: 40px;
      padding-right: 40px;
    }
    .ds__input:disabled {
      background: var(--rr-surface-2);
      color: var(--rr-ink-3);
      cursor: default;
    }
    .ds__input::-webkit-search-cancel-button {
      -webkit-appearance: none;
      appearance: none;
    }
    .ds__spin {
      position: absolute;
      right: var(--sp-3);
      top: 50%;
      width: 16px;
      height: 16px;
      margin-top: -8px;
      border-radius: 50%;
      border: 2px solid var(--rr-ink-2);
      border-right-color: transparent;
      animation: rr-spin 0.8s linear infinite;
    }
    .ds__note {
      margin: 0;
    }
    .ds__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .ds__item {
      min-width: 0;
    }
  `,
})
export class DocSearch {
  readonly projectId = input.required<string>();
  /** false — нет ТЗ: поле выключено, вместо результатов подпись. */
  readonly enabled = input(true);

  private readonly api = inject(ApiService);
  protected readonly copy = DOCUMENTS;
  protected readonly errorText = ERROR.request;

  protected readonly q = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal(false);
  /** Был ли хоть один завершённый запрос по текущему тексту — иначе «ничего не нашли» показывать рано. */
  protected readonly searched = signal(false);
  private readonly hits = signal<SearchHit[]>([]);

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Номер последнего запроса: ответ устаревшего запроса отбрасываем. */
  private seq = 0;

  protected readonly citations = computed<CitationModel[]>(() => this.hits().map(toCitation));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  protected onInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.q.set(value);
    this.clearTimer();
    if (value.trim().length < MIN_CHARS) {
      // стало коротко — сбрасываем старые результаты, но без «ничего не нашли»
      this.seq++;
      this.hits.set([]);
      this.searched.set(false);
      this.error.set(false);
      this.busy.set(false);
      return;
    }
    this.timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
  }

  protected onEnter(e: Event): void {
    e.preventDefault();
    this.clearTimer();
    if (this.q().trim().length < MIN_CHARS) return;
    void this.run();
  }

  private async run(): Promise<void> {
    if (!this.enabled()) return;
    const query = this.q().trim();
    const id = ++this.seq;
    this.busy.set(true);
    this.error.set(false);
    try {
      const res = await this.api.search(this.projectId(), query, TOP_K);
      if (id !== this.seq) return;
      this.hits.set(res.hits);
      this.searched.set(true);
    } catch {
      if (id !== this.seq) return;
      this.hits.set([]);
      this.error.set(true);
    } finally {
      if (id === this.seq) this.busy.set(false);
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Хит поиска → цитата: «Протокол (§2.1):» + текст фрагмента. Score и страница намеренно не переносятся. */
function toCitation(hit: SearchHit): CitationModel {
  const kind = DOCUMENTS.kinds[hit.documentKind];
  return {
    id: hit.chunkId,
    chunkId: hit.chunkId,
    source: hit.documentKind === 'protocol' ? 'protocol' : 'spec',
    heading: `${kind}${hit.section ? ' (' + hit.section + ')' : ''}:`,
    section: hit.section,
    text: hit.content,
  };
}
