import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, NEW_REMARK } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';

/** Добавить замечание (бизнес): «Что не так», «Где», «Как должно быть», «Прикрепить скрин», «Сохранить». */
@Component({
  selector: 'rr-new-remark-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, ErrorBanner],
  template: `
    <div class="page">
      <rr-app-bar [tabs]="false" />
      <main id="main" class="page__body page__body--loose">
        <form class="paper form" (submit)="save($event)" novalidate>
          <h1 class="form__title">{{ copy.title }}</h1>
          <label class="field">
            <span class="field__label">{{ copy.what }}</span>
            <textarea
              class="textarea"
              rows="4"
              name="what"
              [placeholder]="copy.whatPlaceholder"
              [value]="what()"
              (input)="what.set(value($event))"
              [attr.aria-invalid]="showError() ? 'true' : null"
            ></textarea>
          </label>
          <label class="field">
            <span class="field__label">{{ copy.where }}</span>
            <input class="input" name="where" [placeholder]="copy.wherePlaceholder" [value]="where()" (input)="where.set(value($event))" />
          </label>
          <label class="field">
            <span class="field__label">{{ copy.expected }}</span>
            <textarea class="textarea" rows="2" name="expected" [placeholder]="copy.expectedPlaceholder" [value]="expected()" (input)="expected.set(value($event))"></textarea>
          </label>
          <div class="field">
            <span class="field__label">{{ copy.attach }}</span>
            <span class="meta">{{ needShot }}</span>
            <input #file type="file" class="visually-hidden" accept="image/*" (change)="pick($event)" />
            @if (preview(); as url) {
              <div class="shot-row">
                <div class="shot-preview"><img class="shot-img" [src]="url" alt="" /></div>
                <div class="shot-meta">
                  <span class="meta">{{ fileMeta() }}</span>
                  <button type="button" class="btn btn--secondary shot-replace" (click)="file.click()">{{ copy.replace }}</button>
                </div>
              </div>
            } @else {
              <button type="button" class="btn btn--secondary shot-attach" (click)="file.click()">{{ copy.attach }}</button>
            }
          </div>
          @if (store.error(); as err) {
            <rr-error-banner [message]="err" [retryable]="false" />
          }
          <div class="form__actions">
            <a class="btn btn--secondary" [routerLink]="journalLink()">{{ copy.cancel }}</a>
            <button type="submit" class="btn btn--primary" [class.btn--busy]="store.loading()" [disabled]="store.loading()">{{ copy.save }}</button>
          </div>
        </form>
      </main>
    </div>
  `,
  styles: `
    .form {
      width: 640px;
      max-width: 100%;
      margin: 0 auto;
      padding: var(--sp-7);
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
    }
    .form__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
    }
    .field {
      gap: var(--sp-2);
    }
    .shot-row {
      display: flex;
      gap: var(--sp-4);
      align-items: flex-start;
    }
    .shot-preview {
      width: 200px;
      flex: none;
      aspect-ratio: 4 / 3;
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-sm);
      background: var(--rr-thumb-bg);
      overflow: hidden;
    }
    .shot-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .shot-meta {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .shot-replace,
    .shot-attach {
      min-height: 36px;
      padding: 0 14px;
      width: max-content;
    }
    .form__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--sp-2);
    }
    @media (max-width: 720px) {
      .form {
        padding: var(--sp-4);
      }
      .form__actions > * {
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
  protected readonly fileMeta = computed(() => {
    const f = this.file();
    return f ? `${f.name} · ${Math.round(f.size / 1024)} КБ` : '';
  });

  constructor() {
    if (!this.store.round()) {
      // страница открыта напрямую: подтянем раунд, чтобы было куда сохранять
      queueMicrotask(() => void this.store.enterRound(this.projectId(), this.round()));
    }
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLTextAreaElement>('textarea[name=what]')?.focus());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected pick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.file.set(f);
    this.preview.set(URL.createObjectURL(f));
  }

  protected journalLink(): unknown[] {
    return ['/p', this.projectId(), 'r', this.round()];
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.touched.set(true);
    if (!this.what().trim()) {
      this.host.nativeElement.querySelector<HTMLTextAreaElement>('textarea[name=what]')?.focus();
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
    void this.router.navigate(['/p', this.projectId(), 'r', remark.roundNumber, 'remarks', remark.id], { queryParams: { run: 1 } });
  }
}
