import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { Remark, Screenshot } from '../core/models';
import { APP_NAME, CARD, EMPTY, HINT, JOURNAL, JournalChip, NAV, PHASE_EXTRA, PROCESS, QUEUE, ROLE_TITLE, ROUND, STATUS_LABEL, TITLE, VERDICT_LABEL } from '../core/copy';
import { filterRemarks } from '../core/journal-filter';
import { OnboardingService } from '../core/onboarding.service';
import { QueueService } from '../core/queue.service';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { UiStateService } from '../core/ui-state.service';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { GroupHeader } from '../ui/group-header';
import { HintLine } from '../ui/hint-line';
import { Icon } from '../ui/icons';
import { PageHeader } from '../ui/page-header';
import { ProcessStrip } from '../ui/process-strip';
import { RoundTiles, Tile } from '../ui/round-tiles';
import { Shot } from '../ui/shot';
import { Skeleton } from '../ui/skeleton';
import { StatusPill } from '../ui/status-pill';

export { filterRemarks };

interface Group {
  id: 'mine' | 'rest';
  title: string;
  tone: 'accent-2' | 'muted';
  rows: Remark[];
}

const TILE_LABEL: Partial<Record<JournalChip, string>> = {
  'Ждут меня': JOURNAL.tiles.mine,
  'В работе': JOURNAL.tiles.work,
  'На ретесте': JOURNAL.tiles.retest,
  Закрыто: JOURNAL.tiles.closed,
  Все: JOURNAL.tiles.all,
};

/**
 * Журнал раунда: тайлы-фильтры (сводка раунда) и таблица № · Суть · Итог · Статус.
 * В фильтре «Все» строки лежат двумя группами: «Ждут вас» (медная полоса) и «Остальные». Не канбан.
 * Клик по строке или «Начать разбор» записывает снимок очереди — карточка покажет рельс «i из N».
 */
@Component({
  selector: 'rr-journal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, HintLine, RoundTiles, GroupHeader, ErrorBanner, EmptyState, Skeleton, Shot, StatusPill, Icon, ProcessStrip],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="roleTitle()" [subtitle]="explain()">
          @if (role(); as r) {
            <rr-hint-line hint [key]="'journal.' + r" [text]="hintText()" />
          }
        </rr-page-header>

        <!-- схема пути замечания: крутится, пока не свернули; «По шагам» открывает тур -->
        @if (tourRole(); as tr) {
          <section class="how paper" [class.how--collapsed]="ui.bandCollapsed('process')" [attr.aria-label]="process.title">
            <div class="how__head">
              <span class="eyebrow how__title">{{ process.title }}</span>
              <button type="button" class="btn btn--text how__btn" (click)="openTour($event)">{{ process.stepByStep }}</button>
              <button type="button" class="btn btn--text how__btn how__toggle" [attr.aria-expanded]="!ui.bandCollapsed('process')" (click)="ui.toggleBand('process')">
                {{ ui.bandCollapsed('process') ? process.expand : process.collapse }}
              </button>
            </div>
            @if (!ui.bandCollapsed('process')) {
              <rr-process-strip class="how__strip" mode="loop" [role]="tr" />
            }
          </section>
        }

        @if (store.error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        @if (store.loading() && !store.remarks().length && !store.error()) {
          <rr-skeleton kind="table" [rows]="6" />
        } @else if (!store.round() && !store.loading() && !store.error()) {
          <!-- новый проект: раундов ещё нет (ADR 005) -->
          <rr-empty-state [title]="journal.noRounds" [hint]="canOpenRound() ? journal.noRoundsHint : journal.noRoundsOther">
            @if (canOpenRound()) {
              <button cta type="button" class="btn btn--primary" [class.btn--busy]="creatingRound()" [disabled]="creatingRound()" (click)="newRound()">{{ nav.newRound }}</button>
            }
          </rr-empty-state>
        } @else if (store.total() === 0 && !store.loading()) {
          <rr-empty-state [title]="role() === 'business' ? empty.noRemarks : journal.waitingPm">
            @if (role() === 'business') {
              <a cta class="btn btn--primary" [routerLink]="newLink()">{{ nav.addRemark }}</a>
            }
          </rr-empty-state>
        } @else {
          <div class="filters">
            <rr-round-tiles [tiles]="tiles()" [active]="filter()" (pick)="onTile($event)" (start)="startReview()" />
            @if (wishCount() > 0) {
              <div class="chips" role="group" [attr.aria-label]="filterLabel">
                <button type="button" class="chip chip--quiet" [class.chip--on]="filter() === 'Новые желания'" [attr.aria-pressed]="filter() === 'Новые желания'" (click)="onTile('Новые желания')">
                  {{ chipLabel('Новые желания') }}<span class="chip__n num">{{ wishCount() }}</span>
                </button>
              </div>
            }
          </div>

          @if (fixCount() > 0 && filter() !== 'Дописать из журнала') {
            <div class="fix-banner rise" role="status">
              <rr-icon name="warning" [size]="16" />
              <span>{{ journal.fixBanner(fixCount()) }}</span>
              <button type="button" class="btn btn--text fix-banner__cta" (click)="onTile('Дописать из журнала')">{{ journal.fixBannerCta }}</button>
            </div>
          }

          @if (rows().length) {
            <div class="paper tbl-wrap">
              <table class="tbl journal">
                <caption class="visually-hidden">{{ nav.journal }}</caption>
                <colgroup>
                  <col class="journal__c-n" />
                  <col />
                  <col class="journal__c-outcome" />
                  <col class="journal__c-status" />
                  <col class="journal__c-go" />
                </colgroup>
                <thead>
                  <tr>
                    @for (c of columns; track c) {
                      <th scope="col">{{ c }}</th>
                    }
                    <th scope="col"><span class="visually-hidden">{{ openLabel }}</span></th>
                  </tr>
                </thead>
                @for (g of groups(); track g.id) {
                  <tbody>
                    @if (groups().length > 1) {
                      <tr class="journal__group">
                        <td colspan="5" class="journal__group-cell">
                          <rr-group-header [title]="g.title" [count]="g.rows.length" [tone]="g.tone" [sticky]="false" [collapsible]="true" [collapsed]="ui.isGroupCollapsed(g.id)" (toggle)="ui.toggleGroup(g.id)" />
                        </td>
                      </tr>
                    }
                    @if (groups().length === 1 || !ui.isGroupCollapsed(g.id)) {
                      @for (r of g.rows; track r.id; let i = $index) {
                        <tr class="tbl__row rise" [class.tbl__row--mine]="g.id === 'mine' && groups().length > 1" [attr.data-status]="r.status" [style.--i]="i">
                          <td class="journal__n">
                            <a class="row-link n-serif journal__num" [routerLink]="cardLink(r)" [attr.aria-label]="rowLabel(r)" [style.viewTransitionName]="ui.lastRemarkId() === r.id ? 'remark-n' : null" (click)="onRow(r)">{{ r.number }}</a>
                          </td>
                          <td class="journal__title">
                            <div class="journal__title-in">
                              @if (thumb(r); as s) {
                                <span class="thumb"><rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" /></span>
                              }
                              <div class="journal__text">
                                <span class="journal__title-text">{{ r.title }}</span>
                                <span class="meta journal__meta">{{ metaLine(r) }}</span>
                                <rr-status-pill class="journal__status-inline" [status]="r.status" [dot]="true" />
                              </div>
                            </div>
                          </td>
                          <td class="journal__outcome">
                            <span class="journal__outcome-text">{{ outcomeText(r) }}</span>
                            @if (r.status === 'duplicate' && r.duplicateOfNumber && !r.duplicateLinked && role() === 'pm') {
                              <button type="button" class="btn btn--text act" [disabled]="store.loading()" (click)="link(r)">{{ linkLabel(r.duplicateOfNumber) }}</button>
                            }
                          </td>
                          <td class="journal__status"><rr-status-pill [status]="r.status" [dot]="true" /></td>
                          <td class="journal__go"><rr-icon name="chevron-right" [size]="16" /></td>
                        </tr>
                      }
                    }
                  </tbody>
                }
              </table>
            </div>
            @if (filter() === 'Ждут меня' && restCount() > 0) {
              <div class="rest meta">
                <span>{{ journal.restCount(restCount()) }}</span>
                <button type="button" class="btn btn--text" (click)="onTile('Все')">{{ journal.showAll }}</button>
              </div>
            }
          } @else if (!store.loading()) {
            <rr-empty-state [title]="filter() === 'Дописать из журнала' ? journal.emptyFilter : journal.allDone">
              <button cta type="button" class="btn btn--secondary" (click)="onTile('Все')">{{ journal.showAll }}</button>
            </rr-empty-state>
          }
        }
      </main>
    </div>
  `,
  styles: `
    .banner {
      margin-bottom: var(--sp-4);
    }
    .how {
      margin-bottom: var(--sp-5);
      padding: var(--sp-3) var(--sp-5) var(--sp-4);
    }
    .how--collapsed {
      padding-bottom: var(--sp-3);
    }
    .how__head {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
    }
    .how__title {
      margin-right: auto;
    }
    .how__btn {
      min-height: 28px;
      padding: 0 6px;
      font-size: var(--fs-13);
    }
    .how__strip {
      margin-top: var(--sp-2);
    }
    .filters {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      margin-bottom: var(--sp-5);
    }
    .chips {
      display: flex;
      gap: var(--sp-2);
      flex-wrap: wrap;
    }
    .fix-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 var(--sp-4);
      margin-bottom: var(--sp-4);
      border-radius: var(--rr-r-md);
      background: var(--rr-danger-bg);
      color: var(--rr-danger-ink);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .fix-banner__cta {
      margin-left: auto;
      color: var(--rr-danger-ink);
      font-size: var(--fs-14);
    }
    .journal__c-n {
      width: 72px;
    }
    .journal__c-outcome {
      width: 320px;
    }
    .journal__c-status {
      width: 210px;
    }
    .journal__c-go {
      width: 44px;
    }
    .journal__group-cell {
      padding: 0 !important;
      border-bottom: 0 !important;
    }
    .journal__n {
      padding-right: 0 !important;
    }
    .journal__num {
      display: inline-block;
      min-width: 28px;
    }
    .tbl__row:hover .journal__num {
      color: var(--rr-accent-2-text);
    }
    .journal__title {
      max-width: 0;
    }
    .journal__title-in {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      min-width: 0;
    }
    .journal__text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .journal__title-text {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .journal__meta {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .journal__outcome {
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
    }
    .journal__outcome-text {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
    }
    .journal__outcome .act {
      margin-left: 10px;
      vertical-align: middle;
    }
    .journal__go {
      color: var(--rr-ink-3);
      padding-left: 0 !important;
      transition: transform var(--dur-fast) var(--ease);
    }
    .tbl__row:hover .journal__go {
      transform: translateX(2px);
      color: var(--rr-ink-2);
    }
    .journal__status-inline {
      display: none;
    }
    .rest {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-2) 0;
    }
    @media (max-width: 900px) {
      .journal__c-outcome,
      .journal__c-status,
      .journal :is(td, th):nth-child(3),
      .journal :is(td, th):nth-child(4) {
        display: none;
      }
      .journal__c-n {
        width: 52px;
      }
      .journal__title {
        white-space: normal;
        max-width: none;
        padding-top: var(--sp-3);
        padding-bottom: var(--sp-3);
      }
      .journal__title-text {
        white-space: normal;
      }
      .journal__status-inline {
        display: inline-flex;
        margin-top: 6px;
      }
      .thumb {
        display: none;
      }
    }
  `,
})
export class JournalPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  protected readonly ui = inject(UiStateService);
  private readonly queue = inject(QueueService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly onboarding = inject(OnboardingService);

  protected readonly columns = JOURNAL.columns;
  protected readonly journal = JOURNAL;
  protected readonly empty = EMPTY;
  protected readonly nav = NAV;
  protected readonly filterLabel = 'Фильтр';
  protected readonly openLabel = CARD.zoomOpen;
  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly roleTitle = computed(() => (this.role() ? ROLE_TITLE[this.role()!] : ''));
  protected readonly explain = computed(() => (this.role() === 'business' ? JOURNAL.explain.business : JOURNAL.explain.pm));
  protected readonly hintText = computed(() => (this.role() === 'business' ? HINT.journal.business : HINT.journal.pm));
  protected readonly process = PROCESS;
  /** Схема и тур — только у нетехнических ролей. */
  protected readonly tourRole = computed<'business' | 'pm' | null>(() => {
    const r = this.role();
    return r === 'business' || r === 'pm' ? r : null;
  });
  protected readonly filter = signal<JournalChip>(this.ui.journalFilter() ?? 'Ждут меня');
  protected readonly canOpenRound = computed(() => this.role() === 'pm' || this.role() === 'business' || this.role() === 'admin');
  protected readonly creatingRound = signal(false);

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const round = this.round();
      untracked(() => void this.store.enterRound(projectId, round));
    });
    // Дефолт «Ждут меня»; если там пусто и человек ещё ничего не выбирал — «Все».
    effect(() => {
      const list = this.store.remarks();
      const role = this.role();
      untracked(() => {
        if (this.ui.journalFilter() || !list.length || this.store.loading()) return;
        if (this.filter() === 'Ждут меня' && filterRemarks(list, 'Ждут меня', role).length === 0) this.filter.set('Все');
      });
    });
    effect(() => {
      const n = this.store.roundNumber();
      this.title.setTitle(`${TITLE.journal(n)} — ${APP_NAME}`);
    });
    // Первый заход бизнеса или PM — тур «Как это работает» один раз.
    effect(() => {
      const role = this.role();
      untracked(() => this.onboarding.maybeAutoOpen(role));
    });
  }

  protected openTour(e: Event): void {
    const role = this.tourRole();
    if (role) this.onboarding.open(role, 0, e.currentTarget as HTMLElement);
  }

  // ---------- счётчики и тайлы ----------

  private count(chip: JournalChip): number {
    return filterRemarks(this.store.remarks(), chip, this.role()).length;
  }

  protected readonly mineCount = computed(() => this.count('Ждут меня'));
  protected readonly wishCount = computed(() => this.count('Новые желания'));
  protected readonly fixCount = computed(() => this.count('Дописать из журнала'));
  protected readonly restCount = computed(() => this.store.remarks().length - this.mineCount());

  protected readonly tiles = computed<Tile[]>(() => {
    const list = this.store.remarks();
    const total = list.length;
    const round = this.store.roundNumber() ?? 0;
    return [
      { chip: 'Ждут меня', label: JOURNAL.tiles.mine, count: this.mineCount(), tone: 'accent-2', sub: this.mineSub(), cta: QUEUE.start },
      { chip: 'В работе', label: JOURNAL.tiles.work, count: this.count('В работе'), tone: 'work', sub: JOURNAL.tileSub.work },
      { chip: 'На ретесте', label: JOURNAL.tiles.retest, count: this.count('На ретесте'), tone: 'wait', sub: JOURNAL.tileSub.retest },
      { chip: 'Закрыто', label: JOURNAL.tiles.closed, count: this.count('Закрыто'), tone: 'ok', sub: JOURNAL.tileSub.closed(this.count('Закрыто'), total) },
      { chip: 'Все', label: JOURNAL.tiles.all, count: total, tone: 'muted', sub: round ? JOURNAL.tileSub.all(round) : null },
    ];
  });

  /** Бизнесу — из чего состоит «ждут вас»: закрыть · новый кадр · скрин. */
  private mineSub(): string | null {
    if (this.role() !== 'business') return null;
    const list = this.store.remarks();
    const n = (s: Remark['status']) => list.filter((r) => r.status === s).length;
    return JOURNAL.businessBreakdown(n('awaiting_business_close'), n('ready_for_retest'), n('cannot_tell') + n('unspecified')) || null;
  }

  protected chipLabel(chip: JournalChip): string {
    return TILE_LABEL[chip] ?? chip;
  }

  // ---------- строки и группы ----------

  protected readonly rows = computed<Remark[]>(() => filterRemarks(this.store.remarks(), this.filter(), this.role()));

  protected readonly groups = computed<Group[]>(() => {
    const rows = this.rows();
    if (this.filter() !== 'Все') return [{ id: 'rest', title: this.chipLabel(this.filter()), tone: 'muted', rows }];
    const mineIds = new Set(filterRemarks(rows, 'Ждут меня', this.role()).map((r) => r.id));
    const mine = rows.filter((r) => mineIds.has(r.id));
    const rest = rows.filter((r) => !mineIds.has(r.id));
    const groups: Group[] = [];
    if (mine.length) groups.push({ id: 'mine', title: JOURNAL.groups.mine, tone: 'accent-2', rows: mine });
    if (rest.length) groups.push({ id: 'rest', title: JOURNAL.groups.rest, tone: 'muted', rows: rest });
    return groups;
  });

  protected onTile(chip: JournalChip): void {
    const next = chip === this.filter() && chip !== 'Все' ? 'Все' : chip;
    this.filter.set(next);
    this.ui.setJournalFilter(next);
  }

  protected reload(): void {
    void this.store.enterRound(this.projectId(), this.round());
  }

  /** Первый раунд нового проекта. */
  protected async newRound(): Promise<void> {
    if (this.creatingRound()) return;
    this.creatingRound.set(true);
    try {
      const round = await this.store.createRound(this.projectId());
      if (round) await this.router.navigate(['/p', this.projectId(), 'r', round.number]);
    } finally {
      this.creatingRound.set(false);
    }
  }

  /** «Начать разбор»: снимок очереди из «Ждут меня» в порядке показа → первая карточка. */
  protected startReview(): void {
    const mine = filterRemarks(this.store.remarks(), 'Ждут меня', this.role());
    if (!mine.length) return;
    this.queue.set(mine.map((r) => r.id), QUEUE.title, this.backLink());
    this.ui.lastRemarkId.set(mine[0]!.id);
    void this.router.navigate(this.cardLink(mine[0]!));
  }

  /** Клик по строке: очередь = текущий фильтр в порядке показа; номер строки перетекает в шапку карточки. */
  protected onRow(r: Remark): void {
    const ids = this.groups().flatMap((g) => g.rows.map((x) => x.id));
    this.queue.set(ids, this.chipLabel(this.filter()), this.backLink());
    this.ui.lastRemarkId.set(r.id);
  }

  private backLink(): (string | number)[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round()];
  }

  protected cardLink(r: Remark): (string | number)[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', r.id];
  }

  protected newLink(): unknown[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', 'new'];
  }

  protected rowLabel(r: Remark): string {
    return TITLE.remark(r.number, r.title);
  }

  /** «Где: Профиль · Business · J-01». */
  protected metaLine(r: Remark): string {
    const parts = [r.pageOrScreen && r.pageOrScreen !== '—' ? `${CARD.where} ${r.pageOrScreen}` : '', r.authorName ?? '', r.externalId ?? ''];
    return parts.filter(Boolean).join(' · ');
  }

  /** Миниатюра только когда скрин есть: последний кадр без диффа. */
  protected thumb(r: Remark): Screenshot | null {
    const shots = r.screenshots.filter((s) => s.kind !== 'diff');
    return shots.length ? shots[shots.length - 1]! : null;
  }

  /** Колонка «Итог»: всегда с текстом — черновик, кто и что решил, где сейчас работа. Прочерка нет. */
  protected outcomeText(r: Remark): string {
    switch (r.status) {
      case 'awaiting_pm':
      case 'triaging':
      case 'cannot_tell':
      case 'duplicate':
        if (r.draftShort) return r.draftShort;
        break;
      case 'defect':
        return PHASE_EXTRA.inDevWith(r.fixedByName ?? 'разработчика');
      case 'ready_for_retest':
      case 'awaiting_business_close':
        return r.fixedByName ? CARD.fixedBy(r.fixedByName) : STATUS_LABEL[r.status];
      case 'closed':
        return r.closedByName && r.closedAt ? PHASE_EXTRA.closedAt(r.closedByName, r.closedAt) : STATUS_LABEL.closed;
    }
    if (r.verdict && r.verdict.code !== 'rejected_binding') {
      const label = VERDICT_LABEL[r.verdict.code];
      return r.verdict.userName ? `${label} · ${r.verdict.userName}` : label;
    }
    return STATUS_LABEL[r.status];
  }

  protected linkLabel(n: number): string {
    return CARD.linkDuplicate(n);
  }

  protected link(r: Remark): void {
    void this.store.linkDuplicate(r.id);
  }
}

