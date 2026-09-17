import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ImportJob, ImportRow } from '../core/models';
import { ApiService } from '../core/api.service';
import { IMPORT, NEW_REMARK, ROLE_TITLE, ROUND, STATUS_LABEL, STATUS_TONE } from '../core/copy';
import { saveBlob } from '../core/download';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { links } from '../core/links';
import { AppBar } from '../ui/app-bar';
import { DropZone } from '../ui/drop-zone';
import { ErrorBanner } from '../ui/error-banner';
import { GroupHeader } from '../ui/group-header';
import { Icon } from '../ui/icons';
import { PageHeader } from '../ui/page-header';
import { StatusPill } from '../ui/status-pill';

/** Пока сервер разбирает распарсенные строки, список перечитывается раз в две секунды (до WS фазы 6). */
const POLL_MS = 2000;

/**
 * Импорт журнала (бизнес): только наш шаблон. Файл уходит в POST /imports, строки без описания
 * становятся замечаниями «Допишите строку журнала» — человек дописывает их здесь, парсер ничего не выдумывает.
 *
 * До загрузки — сетка из трёх равных колонок: дропзона 1, «Что в шаблоне» 2; «Как это работает» — ряд шагов под ними.
 * После загрузки дропзона сжимается в полосу, результат ложится на всю ширину двумя группами:
 * «Допишите» (поля ввода) и «Разобраны» (ссылки на карточки). Липкий подвал — «Сохранить строки».
 */
@Component({
  selector: 'rr-import-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, DropZone, ErrorBanner, GroupHeader, Icon, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header size="lg" [eyebrow]="eyebrow()" [title]="copy.title" [subtitle]="copy.subtitle(roundNo())" />

        @if (job(); as j) {
          <!-- После загрузки: полоса вместо зоны + результат на всю ширину -->
          <div class="after fade-in">
            <rr-drop-zone
              size="band"
              icon="upload"
              accept=".xlsx,.csv"
              [title]="j.fileName + ' · ' + summary()"
              [busy]="uploading()"
              [disabled]="roundClosed()"
              [buttonLabel]="copy.uploadOther"
              (file)="upload($event)"
            />
            @if (store.error(); as err) {
              <rr-error-banner [message]="err" [retryable]="false" />
            }

            <section class="paper result">
              <h2 class="result__title">{{ summary() }}</h2>

              @if (fixRows().length) {
                <rr-group-header [title]="copy.groups.fix" [count]="fixRows().length" tone="wait" [sticky]="false" />
                <div class="rows" role="list">
                  @for (row of fixRows(); track row.rowNumber; let i = $index) {
                    <div class="row row--fix rise" role="listitem" [style.--i]="i" [attr.data-status]="row.status">
                      <span class="row__n n-serif">{{ row.externalId || row.rowNumber }}</span>
                      <div class="row__body">
                        <input
                          class="input input--danger row__input"
                          [placeholder]="copy.rowPlaceholder"
                          [attr.aria-label]="copy.rowPlaceholder"
                          [value]="draftFor(row.rowNumber)"
                          [disabled]="saving()"
                          (input)="setDraft(row.rowNumber, $event)"
                          (keydown.enter)="focusNextEmpty($event)"
                        />
                        @if (row.reason) {
                          <span class="meta">{{ copy.rowReason(row.rowNumber, row.reason) }}</span>
                        }
                      </div>
                      <rr-status-pill class="row__pill" [label]="pillLabel(row)" [toneOverride]="pillTone(row)" [dot]="true" />
                    </div>
                  }
                </div>
              }

              @if (parsedRows().length) {
                <rr-group-header [title]="copy.groups.parsed" [count]="parsedRows().length" tone="ok" [sticky]="false" />
                <div class="rows" role="list">
                  @for (row of parsedRows(); track row.rowNumber; let i = $index) {
                    <div class="row rise" role="listitem" [style.--i]="i" [attr.data-status]="row.status">
                      <span class="row__n n-serif">{{ row.externalId || row.rowNumber }}</span>
                      <div class="row__body">
                        <span class="row__text">{{ row.text }}</span>
                        <span class="row__meta">
                          @if (row.remarkNumber) {
                            <a class="link" [routerLink]="cardLink(row)">{{ copy.rowLink(row.rowNumber, row.remarkNumber) }}</a>
                          }
                          @if (row.screenshotRef && !row.hasScreenshot) {
                            <span class="meta">{{ copy.linkNotFetched }}</span>
                          }
                        </span>
                      </div>
                      <rr-status-pill class="row__pill" [label]="pillLabel(row)" [toneOverride]="pillTone(row)" [dot]="true" [pulse]="row.remarkStatus === 'triaging'" />
                    </div>
                  }
                </div>
              }

              @if (badCount() > 0) {
                <div class="foot glass">
                  <button type="button" class="btn btn--primary" [class.btn--busy]="saving()" [disabled]="saving() || !hasDrafts()" (click)="save()">{{ copy.save }}</button>
                </div>
              } @else {
                <div class="done">
                  <span class="done__text"><span class="dot dot--ok" aria-hidden="true"></span>{{ copy.allParsed(total()) }}</span>
                  <a class="btn btn--primary" [routerLink]="journalLink()">{{ copy.toJournal }}</a>
                </div>
              }
            </section>
          </div>
        } @else {
          <!-- До загрузки: сетка из трёх равных колонок — зона 1 / шаблон 2; шаги ряд ниже, по одному под каждой колонкой -->
          <div class="grid">
            <div class="col col--drop">
              <rr-drop-zone
                class="drop"
                size="tall"
                icon="upload"
                accept=".xlsx,.csv"
                [title]="copy.drop"
                [hint]="roundClosed() ? closedNote() : copy.dropHint"
                [busy]="uploading()"
                [disabled]="roundClosed()"
                [buttonLabel]="copy.upload"
                (file)="upload($event)"
              />
              @if (store.error(); as err) {
                <rr-error-banner [message]="err" [retryable]="false" />
              }
            </div>

            <section class="paper tpl">
              <div class="eyebrow tpl__eyebrow">{{ copy.templateTitle }}</div>
              <div class="tbl-wrap">
                <table class="tbl tpl__tbl">
                  <caption class="visually-hidden">{{ copy.templateTitle }}</caption>
                  <thead>
                    <tr>
                      @for (c of copy.templateColumns; track c) {
                        <th scope="col">{{ c }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of copy.templateExample; track $index) {
                      <tr>
                        @for (cell of line; track $index) {
                          @if (cell) {
                            <td>{{ cell }}</td>
                          } @else {
                            <td class="tpl__empty">—</td>
                          }
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="tpl__foot">
                <span class="meta">{{ copy.templateEmptyNote }}</span>
                <span class="tpl__links">
                  <button type="button" class="btn btn--text" [disabled]="templateBusy()" (click)="downloadTemplate('xlsx')"><rr-icon name="upload" [size]="14" />{{ copy.template }} · xlsx</button>
                  <button type="button" class="btn btn--text" [disabled]="templateBusy()" (click)="downloadTemplate('csv')">csv</button>
                </span>
              </div>
            </section>

            <section class="how" [attr.aria-label]="copy.howTitle">
              <div class="eyebrow">{{ copy.howTitle }}</div>
              <ol class="steps">
                @for (s of copy.steps(roundNo()); track $index; let i = $index) {
                  <li class="sunken steps__item rise" [style.--i]="i">
                    <span class="steps__n num" aria-hidden="true">{{ i + 1 }}</span>
                    <span>{{ s }}</span>
                  </li>
                }
              </ol>
            </section>
          </div>
        }
      </main>
    </div>
  `,
  styles: `
    /* ---------- до загрузки ---------- */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--sp-6);
      align-items: stretch;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      min-width: 0;
    }
    /* дропзона выше стандартной tall (220) — на этой странице она главный объект; ряд делит высоту с шаблоном,
       поэтому не выше, чем нужно шаблону с запасом (иначе в «Что в шаблоне» пустота над подвалом) */
    .drop {
      flex: 1 0 auto;
      min-height: 248px;
    }
    .tpl {
      grid-column: span 2;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      padding: var(--sp-5);
    }
    .tpl__eyebrow {
      margin-bottom: -4px;
    }
    /* компактная таблица шаблона: th 36, td 40, 13px */
    .tpl__tbl th {
      height: 36px;
      padding: 0 var(--sp-3);
    }
    .tpl__tbl td {
      height: 40px;
      padding: 0 var(--sp-3);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      white-space: nowrap;
    }
    .tpl__tbl :is(th, td):first-child {
      padding-left: var(--sp-2);
    }
    .tpl__empty {
      color: var(--rr-ink-3);
    }
    .tpl__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-4);
      flex-wrap: wrap;
      margin-top: auto;
    }
    .tpl__links {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-3);
    }
    .tpl__links .btn--text {
      gap: 6px;
    }
    /* шаги — ряд из трёх тайлов ровно под колонками верхнего ряда (тот же repeat(3) и тот же зазор) */
    .how {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--sp-6);
    }
    .steps__item {
      display: flex;
      align-items: flex-start;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-5);
      color: var(--rr-ink-2);
    }
    .steps__n {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: var(--rr-r-pill);
      background: var(--rr-accent-soft);
      color: var(--rr-accent-text);
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      font-weight: var(--fw-semibold);
      margin-top: 1px;
    }

    /* ---------- после загрузки ---------- */
    .after {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    /* без overflow:hidden — иначе липкий подвал прилипает к бумаге, а не к окну */
    .result {
      position: relative;
    }
    .result__title {
      margin: 0;
      padding: var(--sp-5) var(--sp-5) var(--sp-4);
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .rows {
      display: flex;
      flex-direction: column;
    }
    .row {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--sp-4);
      min-height: 56px;
      padding: var(--sp-2) var(--sp-5);
      border-bottom: 1px solid var(--rr-line);
      transition: background-color var(--dur-fast) var(--ease);
    }
    .row:hover {
      background: var(--rr-surface-2);
    }
    .row__n {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row__body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .row__input {
      height: 36px;
    }
    .row__text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row__meta {
      display: flex;
      gap: var(--sp-3);
      flex-wrap: wrap;
      min-width: 0;
    }
    .row__pill {
      flex: none;
    }
    .foot {
      position: sticky;
      bottom: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      padding: var(--sp-3) var(--sp-5);
      border-radius: 0 0 var(--rr-r-lg) var(--rr-r-lg);
      border-top: 1px solid var(--rr-line);
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      box-shadow: 0 -8px 24px -16px var(--rr-scrim);
    }
    .done {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-4);
      flex-wrap: wrap;
      padding: var(--sp-4) var(--sp-5);
    }
    .done__text {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      color: var(--rr-ok-ink);
      font-weight: var(--fw-semibold);
    }

    /* ---------- узкий экран ---------- */
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-4);
      }
      .tpl {
        grid-column: auto;
      }
      .steps {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-3);
      }
      .drop {
        min-height: 240px;
      }
      .row {
        grid-template-columns: 56px minmax(0, 1fr);
        row-gap: var(--sp-2);
      }
      .row__pill {
        grid-column: 2;
      }
      .row__text {
        white-space: normal;
      }
      .foot {
        bottom: calc(var(--rr-tabbar-h) + env(safe-area-inset-bottom));
      }
    }
  `,
})
export class ImportPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  /** Шаблон журнала качается с API (один источник с сервером, 3.2): кнопка ждёт blob. */
  protected readonly templateBusy = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly copy = IMPORT;
  protected readonly job = signal<ImportJob | null>(null);
  protected readonly uploading = signal(false);
  protected readonly saving = signal(false);
  protected readonly drafts = signal<Record<number, string>>({});

  private poll: ReturnType<typeof setInterval> | null = null;

  /** Номер раунда: из стора, пока не подгрузился — из маршрута. */
  protected readonly roundNo = computed(() => this.store.roundNumber() ?? Number(this.round()));
  /** «ВЫ ПРИНИМАЕТЕ РАБОТУ · КЛИЕНТСКИЙ КАБИНЕТ · РАУНД 2». */
  protected readonly eyebrow = computed(() => {
    const role = this.session.roleIn(this.projectId());
    return [role ? ROLE_TITLE[role] : null, this.store.projectName(), ROUND.label(this.roundNo())].filter(Boolean).join(' · ');
  });

  protected readonly total = computed(() => this.job()?.rows.length ?? 0);
  /** Строки, которые всё ещё ждут человека (после «Сохранить строки» они уходят в разбор). */
  protected readonly fixRows = computed<ImportRow[]>(() => this.job()?.rows.filter((r) => r.remarkStatus === 'needs_human_parse') ?? []);
  protected readonly parsedRows = computed<ImportRow[]>(() => this.job()?.rows.filter((r) => r.remarkStatus !== 'needs_human_parse') ?? []);
  protected readonly badCount = computed(() => this.fixRows().length);
  /** «Разобрали 10 из 12. Две строки нужно дописать.» — когда дописывать нечего, короче: «Разобрали 12 из 12». */
  protected readonly summary = computed(() => {
    const total = this.total();
    const bad = this.badCount();
    return bad > 0 ? IMPORT.summary(total - bad, total, bad) : IMPORT.allParsed(total);
  });
  protected readonly hasDrafts = computed(() => Object.values(this.drafts()).some((t) => t.trim()));
  /** В закрытый раунд журнал не импортируют (сервер ответит 409): зона неактивна, вместо подсказки — почему. */
  protected readonly roundClosed = computed(() => this.store.round()?.status === 'closed');
  protected readonly closedNote = computed(() => NEW_REMARK.roundClosed(this.store.roundNumber() ?? 0));

  constructor() {
    if (!this.store.round()) {
      // раундов нет — в журнал, там «Новый раунд»
      queueMicrotask(() =>
        void this.store.enterRound(this.projectId(), this.round()).then((r) => {
          if (!r) void this.router.navigate(links.project(this.session.slugOf(this.projectId())));
        }),
      );
    }
    this.destroyRef.onDestroy(() => this.pollWhileTriaging(false));
  }

  protected async downloadTemplate(kind: 'xlsx' | 'csv'): Promise<void> {
    if (this.templateBusy()) return;
    this.templateBusy.set(true);
    try {
      saveBlob(await this.api.importTemplate(this.projectId(), kind), `journal-template.${kind}`);
    } catch {
      // шаблон не критичен: ошибку покажет общий баннер при следующем действии
    } finally {
      this.templateBusy.set(false);
    }
  }

  protected async upload(file: File): Promise<void> {
    if (this.uploading()) return;
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

  /** Enter в поле строки — фокус на следующее пустое поле (по кругу); пустых нет — остаёмся. */
  protected focusNextEmpty(e: Event): void {
    e.preventDefault();
    const current = e.target as HTMLInputElement;
    const root = current.closest('.result');
    if (!root) return;
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('.row__input'));
    const from = inputs.indexOf(current);
    for (let step = 1; step <= inputs.length; step++) {
      const next = inputs[(from + step) % inputs.length]!;
      if (next !== current && !next.value.trim()) {
        next.focus();
        return;
      }
    }
  }

  protected pillLabel(row: ImportRow): string {
    return row.remarkStatus ? STATUS_LABEL[row.remarkStatus] : IMPORT.received;
  }

  protected pillTone(row: ImportRow): (typeof STATUS_TONE)[keyof typeof STATUS_TONE] {
    return row.remarkStatus ? STATUS_TONE[row.remarkStatus] : 'muted';
  }

  protected cardLink(row: ImportRow): string[] {
    return links.remark(this.session.slugOf(this.projectId()), this.store.roundNumber() ?? this.round(), row.remarkNumber ?? 0);
  }

  protected journalLink(): string[] {
    return links.journal(this.session.slugOf(this.projectId()), this.store.roundNumber() ?? this.round());
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
