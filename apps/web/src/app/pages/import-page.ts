import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { ImportRow } from '../core/models';
import { EMPTY, IMPORT, STATUS_LABEL } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { IMPORT_FILE_NAME, IMPORT_ROWS } from '../mock/seed';
import { GlassHeader } from '../ui/glass-header';
import { StatusPill } from '../ui/status-pill';

/**
 * Импорт журнала (бизнес): только наш шаблон. Нераспознанные строки дописывает человек.
 * Парсер CSV/XLSX — фаза 4; пока список строк — мок, а «Сохранить строки» создаёт замечания через API.
 */
@Component({
  selector: 'rr-import-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassHeader, StatusPill],
  template: `
    <div class="page">
      <rr-glass-header [presence]="false" />
      <main class="page__body page__body--loose">
        <div class="grid">
          <section class="col">
            <h2 class="col-title">{{ copy.title }}</h2>
            <div class="drop" [class.drop--over]="over()" (dragover)="onDragOver($event)" (dragleave)="over.set(false)" (drop)="onDrop($event)">
              <div class="drop__title">{{ copy.drop }}</div>
              <div class="meta">{{ copy.dropHint }}</div>
            </div>
            <div class="actions">
              <a class="btn btn--secondary" href="template.csv" download="journal-template.csv">{{ copy.template }}</a>
              <button type="button" class="btn btn--primary" (click)="upload()">{{ copy.upload }}</button>
            </div>
          </section>
          @if (uploaded()) {
            <section class="col">
              <h2 class="col-title">{{ copy.after(fileName) }}</h2>
              <div class="paper list">
                <div class="list__head">
                  <div class="list__summary">{{ summary() }}</div>
                  @if (badCount() > 0) {
                    <div class="meta">{{ unparsed }}</div>
                  }
                </div>
                @for (row of rows(); track row.rowNumber) {
                  <div class="row" [attr.data-status]="row.status">
                    <span class="num row__n">{{ row.rowNumber }}</span>
                    @if (row.status === 'needs_human_parse') {
                      <input class="input input--danger" [placeholder]="copy.rowPlaceholder" [value]="draftFor(row.rowNumber)" (input)="setDraft(row.rowNumber, $event)" />
                    } @else {
                      <span class="row__text">
                        <span>{{ row.text }}</span>
                        @if (row.remarkNumber) {
                          <span class="meta">{{ copy.rowLink(row.rowNumber, row.remarkNumber) }}</span>
                        }
                      </span>
                    }
                    <span>
                      <rr-status-pill [label]="pillLabel(row)" [toneOverride]="row.status === 'parsed' ? 'ok' : 'danger'" />
                    </span>
                  </div>
                }
                <div class="list__foot">
                  <button type="button" class="btn btn--primary" [disabled]="store.loading()" (click)="save()">{{ copy.save }}</button>
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
      gap: 28px;
      align-items: start;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .col-title {
      margin: 0;
    }
    .drop {
      height: 220px;
      border: 1px dashed var(--rr-line);
      border-radius: 12px;
      background: var(--rr-surface-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
      padding: 24px;
    }
    .drop--over {
      border-color: var(--rr-accent);
      background: var(--rr-chip-on-bg);
    }
    .drop__title {
      font-weight: 500;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .list {
      overflow: hidden;
    }
    .list__head {
      padding: 16px 20px;
      border-bottom: 1px solid var(--rr-line);
    }
    .list__summary {
      font-size: 15px;
      line-height: 22px;
      font-weight: 600;
    }
    .row {
      display: grid;
      grid-template-columns: 48px 1fr 240px;
      gap: 16px;
      align-items: center;
      min-height: 48px;
      padding: 6px 20px;
      border-bottom: 1px solid var(--rr-line);
    }
    .row__n {
      color: var(--rr-ink-soft);
    }
    .row__text {
      display: flex;
      flex-direction: column;
    }
    .row .input {
      height: 36px;
    }
    .list__foot {
      padding: 16px 20px;
      display: flex;
      justify-content: flex-end;
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .row {
        grid-template-columns: 40px 1fr;
      }
      .row > :last-child {
        grid-column: 2;
      }
    }
  `,
})
export class ImportPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);

  protected readonly copy = IMPORT;
  protected readonly unparsed = EMPTY.importUnparsed;
  protected readonly fileName = IMPORT_FILE_NAME;
  protected readonly uploaded = signal(false);
  protected readonly over = signal(false);
  protected readonly drafts = signal<Record<number, string>>({});
  protected readonly rows = signal<ImportRow[]>(structuredClone(IMPORT_ROWS));

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
    for (const row of this.rows()) {
      const text = drafts[row.rowNumber]?.trim();
      if (row.status !== 'needs_human_parse' || !text) {
        next.push(row);
        continue;
      }
      const remark = await this.store.addRemark(this.projectId(), { title: text, pageOrScreen: '', file: null });
      next.push(remark ? { ...row, text, status: 'parsed', remarkNumber: remark.number } : row);
    }
    this.rows.set(next);
    this.drafts.set({});
  }
}
