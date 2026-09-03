import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ImportJob, ImportRow } from '../core/models';
import { EMPTY, IMPORT, ROLE_TITLE, ROUND, STATUS_LABEL, STATUS_TONE } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { StatusPill } from '../ui/status-pill';

/** Пока сервер разбирает распарсенные строки, список перечитывается раз в две секунды (до WS фазы 6). */
const POLL_MS = 2000;

/**
 * Импорт журнала (бизнес): только наш шаблон. Файл уходит в POST /imports, строки без описания
 * становятся замечаниями «Допишите строку журнала» — человек дописывает их здесь, парсер ничего не выдумывает.
 */
@Component({
  selector: 'rr-import-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, ErrorBanner, StatusPill],
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
              [class.drop--busy]="uploading()"
              (dragenter)="onDragOver($event)"
              (dragover)="onDragOver($event)"
              (dragleave)="over.set(false)"
              (drop)="onDrop($event)"
            >
              <span class="drop__title">{{ uploading() ? copy.uploading : over() ? copy.dropOver : copy.drop }}</span>
              <span class="meta">{{ copy.dropHint }}</span>
              <input #file id="import-file" type="file" class="visually-hidden" accept=".xlsx,.csv" [disabled]="uploading()" (change)="onPick($event)" />
            </label>
            <div class="actions">
              <a class="btn btn--secondary" href="template.xlsx" download="journal-template.xlsx">{{ copy.template }}</a>
              <button type="button" class="btn btn--primary" [class.btn--busy]="uploading()" [disabled]="uploading()" (click)="file.click()">{{ copy.upload }}</button>
            </div>
            @if (store.error(); as err) {
              <rr-error-banner [message]="err" [retryable]="false" />
            }
          </section>
          @if (job(); as j) {
            <section class="col">
              <h2 class="col-title">{{ copy.after(j.fileName) }}</h2>
              <div class="paper list">
                <div class="list__head">
                  <div class="list__summary">{{ summary() }}</div>
                  @if (badCount() > 0) {
                    <div class="meta">{{ unparsed }}</div>
                  }
                </div>
                <table class="tbl rows">
                  <caption class="visually-hidden">{{ copy.after(j.fileName) }}</caption>
                  <colgroup>
                    <col class="rows__c-n" />
                    <col />
                    <col class="rows__c-status" />
                  </colgroup>
                  <tbody>
                    @for (row of j.rows; track row.rowNumber) {
                      <tr class="rows__row" [attr.data-status]="row.status">
                        <td class="num rows__n">{{ row.externalId || row.rowNumber }}</td>
                        <td>
                          @if (row.status === 'needs_human_parse' && row.remarkStatus === 'needs_human_parse') {
                            <div class="rows__fix">
                              <input
                                class="input input--danger rows__input"
                                [placeholder]="copy.rowPlaceholder"
                                [attr.aria-label]="copy.rowPlaceholder"
                                [value]="draftFor(row.rowNumber)"
                                [disabled]="saving()"
                                (input)="setDraft(row.rowNumber, $event)"
                              />
                              @if (row.reason) {
                                <span class="meta">{{ copy.rowReason(row.rowNumber, row.reason) }}</span>
                              }
                            </div>
                          } @else {
                            <span class="rows__text">
                              <span>{{ row.text }}</span>
                              @if (row.remarkNumber) {
                                <a class="meta link" [routerLink]="cardLink(row)">{{ copy.rowLink(row.rowNumber, row.remarkNumber) }}</a>
                              }
                              @if (row.screenshotRef && !row.hasScreenshot) {
                                <span class="meta">{{ copy.linkNotFetched }}</span>
                              }
                            </span>
                          }
                        </td>
                        <td>
                          <rr-status-pill [label]="pillLabel(row)" [toneOverride]="pillTone(row)" [dot]="true" [pulse]="row.remarkStatus === 'triaging'" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (badCount() > 0) {
                  <div class="list__foot">
                    <button type="button" class="btn btn--primary" [class.btn--busy]="saving()" [disabled]="saving() || !hasDrafts()" (click)="save()">{{ copy.save }}</button>
                  </div>
                }
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
    .drop--busy {
      cursor: progress;
      color: var(--rr-ink-2);
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
      width: 88px;
    }
    .rows__c-status {
      width: 230px;
    }
    .rows__row {
      min-height: 52px;
    }
    .rows__row td {
      padding-top: 6px;
      padding-bottom: 6px;
      vertical-align: middle;
    }
    .rows__n {
      color: var(--rr-ink-2);
      white-space: nowrap;
    }
    .rows__text,
    .rows__fix {
      display: flex;
      flex-direction: column;
      gap: 2px;
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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly copy = IMPORT;
  protected readonly unparsed = EMPTY.importUnparsed;
  protected readonly job = signal<ImportJob | null>(null);
  protected readonly over = signal(false);
  protected readonly uploading = signal(false);
  protected readonly saving = signal(false);
  protected readonly drafts = signal<Record<number, string>>({});

  private poll: ReturnType<typeof setInterval> | null = null;

  protected readonly roleTitle = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return role ? ROLE_TITLE[role] : '';
  });
  protected readonly subtitle = computed(() => {
    const n = this.store.roundNumber();
    return [this.store.projectName(), n ? ROUND.label(n) : null].filter(Boolean).join(' · ') || null;
  });
  /** Строки, которые всё ещё ждут человека (после «Сохранить строки» они уходят в разбор). */
  protected readonly badCount = computed(() => this.job()?.rows.filter((r) => r.remarkStatus === 'needs_human_parse').length ?? 0);
  protected readonly summary = computed(() => {
    const total = this.job()?.rows.length ?? 0;
    return IMPORT.summary(total - this.badCount(), total, this.badCount());
  });
  protected readonly hasDrafts = computed(() => Object.values(this.drafts()).some((t) => t.trim()));

  constructor() {
    if (!this.store.round()) queueMicrotask(() => void this.store.enterRound(this.projectId(), this.round()));
    this.destroyRef.onDestroy(() => this.pollWhileTriaging(false));
  }

  protected onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.upload(file);
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (!this.uploading()) this.over.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && !this.uploading()) void this.upload(file);
  }

  private async upload(file: File): Promise<void> {
    this.uploading.set(true);
    this.drafts.set({});
    try {
      if (!this.store.round()) await this.store.enterRound(this.projectId(), this.round());
      const job = await this.store.importJournal(this.projectId(), file);
      if (job) this.setJob(job);
    } finally {
      this.uploading.set(false);
    }
  }

  private setJob(job: ImportJob): void {
    this.job.set(job);
    const busy = job.rows.some((r) => r.remarkStatus === 'imported' || r.remarkStatus === 'triaging');
    this.pollWhileTriaging(busy);
  }

  /** До WS (фаза 6): пока сервер разбирает строки, перечитываем задание импорта. */
  private pollWhileTriaging(on: boolean): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (!on) return;
    this.poll = setInterval(() => {
      const job = this.job();
      if (!job) return;
      void this.store.refreshImport(this.projectId(), job.id).then((next) => next && this.setJob(next));
    }, POLL_MS);
  }

  protected draftFor(rowNumber: number): string {
    return this.drafts()[rowNumber] ?? '';
  }

  protected setDraft(rowNumber: number, e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.drafts.update((d) => ({ ...d, [rowNumber]: value }));
  }

  protected pillLabel(row: ImportRow): string {
    return row.remarkStatus ? STATUS_LABEL[row.remarkStatus] : IMPORT.received;
  }

  protected pillTone(row: ImportRow): (typeof STATUS_TONE)[keyof typeof STATUS_TONE] {
    return row.remarkStatus ? STATUS_TONE[row.remarkStatus] : 'muted';
  }

  protected cardLink(row: ImportRow): unknown[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', row.remarkId];
  }

  /** Дописанные строки уходят в разбор через fix-row; остальные ждут дальше. */
  protected async save(): Promise<void> {
    const job = this.job();
    if (!job) return;
    const drafts = this.drafts();
    this.saving.set(true);
    try {
      for (const row of job.rows) {
        const text = drafts[row.rowNumber]?.trim();
        if (row.remarkStatus !== 'needs_human_parse' || !row.remarkId || !text) continue;
        const remark = await this.store.fixRow(row.remarkId, { description: text, pageOrScreen: row.pageOrScreen ?? undefined });
        if (remark) this.drafts.update((d) => ({ ...d, [row.rowNumber]: '' }));
      }
      const next = await this.store.refreshImport(this.projectId(), job.id);
      if (next) this.setJob(next);
    } finally {
      this.saving.set(false);
    }
  }
}
