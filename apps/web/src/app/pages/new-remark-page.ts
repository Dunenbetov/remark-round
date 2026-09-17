import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, NEW_REMARK, ROUND } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { links } from '../core/links';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { DropZone } from '../ui/drop-zone';
import { ErrorBanner } from '../ui/error-banner';
import { Icon } from '../ui/icons';
import { PageHeader } from '../ui/page-header';

/**
 * Новое замечание (бизнес): две равные колонки одной высоты. Слева лист-форма «Что не так · Где · Как должно быть»,
 * справа дропзона для скрина (перетащить, нажать, Ctrl+V) или превью, под ней тихая карточка «Что будет дальше».
 * Ctrl/Cmd+Enter в любом поле — сохранить.
 * Закрытый раунд — поля выключены и подсказка danger-тоном; таб-бар шапки выключен.
 */
@Component({
  selector: 'rr-new-remark-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, DropZone, ErrorBanner, Icon],
  template: `
    <div class="page">
      <rr-app-bar [tabs]="false" />
      <main id="main" class="page__body page__body--loose">
        <a class="link nr-back" [routerLink]="journalLink()">
          <rr-icon name="arrow-left" [size]="16" />
          {{ copy.back }}
        </a>
        <rr-page-header size="md" [title]="copy.title" [subtitle]="copy.subtitle" [eyebrow]="eyebrow()" />

        <div class="nr-grid">
          <form class="paper nr-form rise" [style.--i]="0" (submit)="save($event)" (keydown)="onKey($event)" novalidate>
            <label class="field">
              <span class="field__label">{{ copy.what }} <span class="nr-req" [attr.aria-label]="copy.required">*</span></span>
              <textarea
                class="textarea"
                rows="4"
                name="what"
                [placeholder]="copy.whatPlaceholder"
                [value]="what()"
                [disabled]="closed()"
                (input)="what.set(value($event))"
                [attr.aria-invalid]="showError() ? 'true' : null"
              ></textarea>
            </label>
            <label class="field">
              <span class="field__label">{{ copy.where }}</span>
              <input class="input" name="where" [placeholder]="copy.wherePlaceholder" [value]="where()" [disabled]="closed()" (input)="where.set(value($event))" />
            </label>
            <label class="field">
              <span class="field__label">{{ copy.expected }}</span>
              <textarea class="textarea" rows="2" name="expected" [placeholder]="copy.expectedPlaceholder" [value]="expected()" [disabled]="closed()" (input)="expected.set(value($event))"></textarea>
            </label>

            @if (closed()) {
              <p class="meta nr-closed" role="status">{{ copy.roundClosed(store.roundNumber() ?? 0) }}</p>
            }
            @if (store.error(); as err) {
              <rr-error-banner [message]="err" [retryable]="false" />
            }

            <div class="nr-actions">
              <a class="btn btn--secondary" [routerLink]="journalLink()">{{ copy.cancel }}</a>
              <button type="submit" class="btn btn--primary btn--lg" [class.btn--busy]="store.loading()" [disabled]="store.loading() || closed()">{{ copy.save }}</button>
            </div>
          </form>

          <aside class="nr-side">
            <input #file type="file" class="visually-hidden" accept="image/*" (change)="pick($event)" />
            @if (preview(); as url) {
              <div class="paper nr-shot rise" [style.--i]="1">
                <img class="nr-shot__img" [src]="url" alt="" />
                <div class="nr-shot__row">
                  <span class="meta nr-shot__meta">{{ fileMeta() }}</span>
                  <div class="nr-shot__btns">
                    <button type="button" class="btn btn--secondary btn--sm" [disabled]="closed()" (click)="file.click()">{{ copy.replace }}</button>
                    <button type="button" class="btn btn--text" (click)="clear()">{{ copy.remove }}</button>
                  </div>
                </div>
              </div>
            } @else {
              <rr-drop-zone
                class="nr-drop rise"
                [style.--i]="1"
                size="tall"
                [title]="copy.dropTitle"
                [hint]="needShot"
                accept="image/*"
                [paste]="true"
                icon="image"
                [disabled]="closed()"
                (file)="setFile($event)"
              />
            }
            <div class="paper nr-next rise" [style.--i]="2">
              <div class="eyebrow">{{ copy.nextTitle }}</div>
              <p class="nr-next__text">{{ copy.nextText }}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  `,
  styles: `
    .nr-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: max-content;
      margin-bottom: var(--sp-4);
    }
    /* две равные колонки одной высоты: высоту задаёт форма, скрин и «Что будет дальше» заполняют правую */
    .nr-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sp-6);
      align-items: stretch;
    }
    .nr-form {
      padding: var(--sp-7);
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
      min-width: 0;
    }
    .nr-req {
      color: var(--rr-ink-2);
      font-weight: var(--fw-regular);
    }
    .nr-closed {
      margin: 0;
      color: var(--rr-danger);
      font-weight: var(--fw-medium);
    }
    .nr-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--sp-2);
      margin-top: auto;
    }
    .nr-side {
      display: flex;
      flex-direction: column;
      gap: var(--sp-6);
      min-width: 0;
    }
    .nr-drop {
      flex: 1 0 auto;
      min-height: 320px;
    }
    .nr-shot {
      flex: 1 0 auto;
      min-height: 320px;
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    /* кадр занимает всё, что осталось от высоты формы; contain: size — высокий скрин не растягивает колонку;
       object-fit: contain — скрин целиком, поля цвета бумаги */
    .nr-shot__img {
      display: block;
      flex: 1 1 0;
      min-height: 0;
      contain: size;
      width: 100%;
      object-fit: contain;
      border-radius: var(--rr-r-sm);
      border: 1px solid var(--rr-line);
      background: var(--rr-thumb-bg);
    }
    .nr-shot__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
      flex-wrap: wrap;
    }
    .nr-shot__meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nr-shot__btns {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      flex: none;
    }
    .nr-next {
      padding: var(--sp-5);
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .nr-next__text {
      margin: 0;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      color: var(--rr-ink-2);
      max-width: 60ch;
    }
    @media (max-width: 900px) {
      .nr-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-5);
      }
      .nr-drop {
        min-height: 240px;
      }
      .nr-shot {
        min-height: 0;
      }
      .nr-shot__img {
        flex: none;
        contain: none;
        aspect-ratio: 16 / 10;
      }
      .nr-form {
        padding: var(--sp-5);
      }
      .nr-actions > * {
        flex: 1;
      }
    }
  `,
})
export class NewRemarkPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly copy = NEW_REMARK;
  protected readonly needShot = EMPTY.needShot;
  protected readonly what = signal('');
  protected readonly where = signal('');
  protected readonly expected = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly touched = signal(false);
  protected readonly showError = computed(() => this.touched() && !this.what().trim());
  /** Закрытый раунд: форма выключена, сохранять некуда. */
  protected readonly closed = computed(() => this.store.round()?.status === 'closed');
  /** «Раунд 2» / «Раунд 1 · закрыт» над заголовком. */
  protected readonly eyebrow = computed(() => {
    const r = this.store.round();
    if (!r) return null;
    return r.status === 'closed' ? `${ROUND.label(r.number)} · ${ROUND.closed}` : ROUND.label(r.number);
  });
  protected readonly fileMeta = computed(() => {
    const f = this.file();
    return f ? `${f.name} · ${Math.round(f.size / 1024)} КБ` : '';
  });

  constructor() {
    if (!this.store.round()) {
      // страница открыта напрямую: подтянем раунд, чтобы было куда сохранять; раундов нет — в журнал, там «Новый раунд»
      queueMicrotask(() =>
        void this.store.enterRound(this.projectId(), this.round()).then((r) => {
          if (!r) void this.router.navigate(links.project(this.slug()));
        }),
      );
    }
    afterNextRender(() => this.focusWhat());
    // objectURL превью живёт не дольше страницы
    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Ctrl/Cmd+Enter в любом поле формы — сохранить. */
  protected onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void this.save(e);
    }
  }

  /** Выбор через скрытый input («Заменить»). */
  protected pick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (f) this.setFile(f);
  }

  /** Файл из дропзоны или input: старое превью освобождаем. */
  protected setFile(f: File): void {
    this.revoke();
    this.file.set(f);
    this.preview.set(URL.createObjectURL(f));
  }

  protected clear(): void {
    this.revoke();
    this.file.set(null);
  }

  private revoke(): void {
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.preview.set(null);
  }

  private focusWhat(): void {
    this.host.nativeElement.querySelector<HTMLTextAreaElement>('textarea[name=what]')?.focus();
  }

  private slug(): string {
    return this.session.slugOf(this.projectId());
  }

  protected journalLink(): string[] {
    return links.journal(this.slug(), this.round());
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    if (this.closed() || this.store.loading()) return;
    this.touched.set(true);
    if (!this.what().trim()) {
      this.focusWhat();
      return;
    }
    if (!this.store.round()) await this.store.enterRound(this.projectId(), this.round());
    const remark = await this.store.addRemark(this.projectId(), {
      title: this.what(),
      pageOrScreen: this.where(),
      expected: this.expected(),
      file: this.file(),
    });
    if (!remark) return;
    void this.router.navigate(links.remark(this.slug(), remark.roundNumber, remark.number));
  }
}
