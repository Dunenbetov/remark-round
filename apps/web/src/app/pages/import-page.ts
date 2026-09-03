import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { ImportRow } from '../core/models';
import { EMPTY, IMPORT, ROLE_TITLE, ROUND, STATUS_LABEL } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { IMPORT_FILE_NAME, IMPORT_ROWS } from '../mock/seed';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { StatusPill } from '../ui/status-pill';

/**
 * Импорт журнала (бизнес): только наш шаблон. Нераспознанные строки дописывает человек.
 * Парсер CSV/XLSX — фаза 4; пока список строк — мок, а «Сохранить строки» создаёт замечания через API.
 */
@Component({
  selector: 'rr-import-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="roleTitle()" [subtitle]="subtitle()" />
        <div class="grid">
          <section class="col">
            <h2 class="col-title">{{ copy.title }}</h2>
            <label
              class="drop"
              for="import-file"
              [class.drop--over]="over()"
              (dragenter)="onDragOver($event)"
              (dragover)="onDragOver($event)"
              (dragleave)="over.set(false)"
              (drop)="onDrop($event)"
            >
              <span class="drop__title">{{ over() ? copy.dropOver : copy.drop }}</span>
              <span class="meta">{{ copy.dropHint }}</span>
              <input id="import-file" type="file" class="visually-hidden" accept=".xlsx,.csv" (change)="onPick($event)" />
            </label>
            <div class="actions">
              <a class="btn btn--secondary" href="template.csv" download="journal-template.csv">{{ copy.template }}</a>
              <button type="button" class="btn btn--primary" (click)="upload()">{{ copy.upload }}</button>
            </div>
          </section>
          @if (uploaded()) {
            <section class="col">
              <h2 class="col-title">{{ copy.after(fileName) }}</h2>
              @if (store.error(); as err) {
                <rr-error-banner [message]="err" [retryable]="false" />
              }
              <div class="paper list">
                <div class="list__head">
                  <div class="list__summary">{{ summary() }}</div>
                  @if (badCount() > 0) {
                    <div class="meta">{{ unparsed }}</div>
                  }
                </div>
                <table class="tbl rows">
                  <caption class="visually-hidden">{{ copy.after(fileName) }}</caption>
                  <colgroup>
                    <col class="rows__c-n" />
                    <col />
                    <col class="rows__c-status" />
                  </colgroup>
                  <tbody>
                    @for (row of rows(); track row.rowNumber) {
                      <tr class="rows__row" [attr.data-status]="row.status">
                        <td class="num rows__n">{{ row.rowNumber }}</td>
                        <td>
                          @if (row.status === 'needs_human_parse') {
                            <input class="input input--danger rows__input" [placeholder]="copy.rowPlaceholder" [attr.aria-label]="copy.rowPlaceholder" [value]="draftFor(row.rowNumber)" (input)="setDraft(row.rowNumber, $event)" />
                          } @else {
                            <span class="rows__text">
                              <span>{{ row.text }}</span>
                              @if (row.remarkNumber) {
                                <span class="meta">{{ copy.rowLink(row.rowNumber, row.remarkNumber) }}</span>
                              }
                            </span>
                          }
                        </td>
                        <td><rr-status-pill [label]="pillLabel(row)" [toneOverride]="row.status === 'parsed' ? 'ok' : 'danger'" [dot]="true" /></td>
                      </tr>
                    }
                  </tbody>
                </table>
                <div class="list__foot">
                  <button type="button" class="btn btn--primary" [class.btn--busy]="saving()" [disabled]="saving()" (click)="save()">{{ copy.save }}</button>
                </div>
              </div>
            </section>
          }
        </div>
      </main>
    </div>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: var(--sp-7);
      align-items: start;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-width: 0;
    }
    .col-title {
      margin: 0;
    }
    .drop {
      height: 220px;
      border: 1px dashed var(--rr-line-strong);
      border-radius: var(--rr-r-lg);
      background: var(--rr-surface-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
      padding: var(--sp-6);
      cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .drop:hover {
      border-color: var(--rr-ink-3);
    }
    .drop--over,
    .drop:has(:focus-visible) {
      border-color: var(--rr-accent-text);
      border-style: solid;
      background: var(--rr-accent-soft);
    }
    .drop:has(:focus-visible) {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .drop__title {
      font-weight: var(--fw-medium);
    }
    .actions {
      display: flex;
      gap: var(--sp-2);
      flex-wrap: wrap;
    }
    .list {
      overflow: hidden;
    }
    .list__head {
      padding: var(--sp-4) var(--sp-5);
      border-bottom: 1px solid var(--rr-line);
    }
    .list__summary {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .rows__c-n {
      width: 56px;
    }
    .rows__c-status {
      width: 230px;
    }
    .rows__row {
      height: 52px;
    }
    .rows__row td {
      padding-top: 6px;
      padding-bottom: 6px;
    }
    .rows__n {
      color: var(--rr-ink-2);
    }
    .rows__text {
      display: flex;
      flex-direction: column;
    }
    .rows__input {
      height: 36px;
    }
    .list__foot {
      padding: var(--sp-4) var(--sp-5);
      display: flex;
      justify-content: flex-end;
      border-top: 1px solid var(--rr-line);
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .rows__c-status {
        width: 140px;
      }
    }
  `,
})
export class ImportPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);

  protected readonly copy = IMPORT;
  protected readonly unparsed = EMPTY.importUnparsed;
  protected readonly fileName = IMPORT_FILE_NAME;
  protected readonly uploaded = signal(false);
  protected readonly over = signal(false);
  protected readonly saving = signal(false);
  protected readonly drafts = signal<Record<number, string>>({});
  protected readonly rows = signal<ImportRow[]>(structuredClone(IMPORT_ROWS));

  protected readonly roleTitle = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return role ? ROLE_TITLE[role] : '';
  });
  protected readonly subtitle = computed(() => {
    const n = this.store.roundNumber();
    return [this.store.projectName(), n ? ROUND.label(n) : null].filter(Boolean).join(' · ') || null;
  });
  protected readonly badCount = computed(() => this.rows().filter((r) => r.status === 'needs_human_parse').length);
  protected readonly summary = computed(() => {
    const total = this.rows().length;
    return IMPORT.summary(total - this.badCount(), total, this.badCount());
  });

  constructor() {
    if (!this.store.round()) queueMicrotask(() => void this.store.enterRound(this.projectId(), this.round()));
  }

  protected upload(): void {
    this.uploaded.set(true);
  }

  protected onPick(e: Event): void {
    (e.target as HTMLInputElement).value = '';
    this.uploaded.set(true);
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.over.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    this.uploaded.set(true);
  }

  protected draftFor(rowNumber: number): string {
    return this.drafts()[rowNumber] ?? '';
  }

  protected setDraft(rowNumber: number, e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.drafts.update((d) => ({ ...d, [rowNumber]: value }));
  }

  protected pillLabel(row: ImportRow): string {
    return row.status === 'parsed' ? IMPORT.received : STATUS_LABEL.needs_human_parse;
  }

  /** Дописанные строки становятся замечаниями через API; остальные строки в моке уже «получены». */
  protected async save(): Promise<void> {
    const drafts = this.drafts();
    const next: ImportRow[] = [];
    this.saving.set(true);
    try {
      for (const row of this.rows()) {
        const text = drafts[row.rowNumber]?.trim();
        if (row.status !== 'needs_human_parse' || !text) {
          next.push(row);
          continue;
        }
        const remark = await this.store.addRemark(this.projectId(), { title: text, pageOrScreen: '', file: null });
        next.push(remark ? { ...row, text, status: 'parsed', remarkNumber: remark.number } : row);
      }
    } finally {
      this.saving.set(false);
    }
    this.rows.set(next);
    this.drafts.set({});
  }
}
