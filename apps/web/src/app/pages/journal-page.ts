import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Remark, Role, Screenshot } from '../core/models';
import { APP_NAME, CARD, EMPTY, JOURNAL, JournalChip, NAV, ROLE_TITLE, ROUND, TITLE } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Shot } from '../ui/shot';
import { Skeleton } from '../ui/skeleton';
import { StatusPill } from '../ui/status-pill';

/** Журнал раунда: чипы-фильтры и таблица № · Суть · Скрин · Черновик · Статус. Не канбан. */
@Component({
  selector: 'rr-journal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, ErrorBanner, EmptyState, Skeleton, Shot, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="roleTitle()" [subtitle]="subtitle()">
          @if (role() === 'business') {
            <a actions class="btn btn--primary ph-add" [routerLink]="newLink()">{{ nav.addRemark }}</a>
          }
        </rr-page-header>

        @if (store.error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        <div class="chips" role="group" [attr.aria-label]="filterLabel">
          @for (chip of chips; track chip) {
            <button type="button" class="chip" [class.chip--on]="filter() === chip" [attr.aria-pressed]="filter() === chip" (click)="filter.set(chip)">
              {{ chip }}<span class="chip__n num">{{ counts()[chip] }}</span>
            </button>
          }
        </div>

        @if (store.loading() && !store.remarks().length && !store.error()) {
          <rr-skeleton kind="table" [rows]="6" />
        } @else if (rows().length) {
          <div class="paper tbl-wrap">
            <table class="tbl journal">
              <caption class="visually-hidden">{{ nav.journal }}</caption>
              <colgroup>
                <col class="journal__c-n" />
                <col />
                <col class="journal__c-shot" />
                <col class="journal__c-draft" />
                <col class="journal__c-status" />
              </colgroup>
              <thead>
                <tr>
                  @for (c of columns; track c) {
                    <th scope="col">{{ c }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id) {
                  <tr class="tbl__row" [attr.data-status]="r.status">
                    <td class="num journal__n"><a class="row-link" [routerLink]="cardLink(r)" [attr.aria-label]="rowLabel(r)">{{ r.number }}</a></td>
                    <td class="journal__title">
                      <span class="journal__title-text">{{ r.title }}</span>
                      <rr-status-pill class="journal__status-inline" [status]="r.status" [dot]="true" />
                    </td>
                    <td>
                      @if (thumb(r); as s) {
                        <span class="thumb"><rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" /></span>
                      } @else {
                        <span class="dash" aria-hidden="true">—</span>
                      }
                    </td>
                    <td class="journal__draft">
                      <span class="journal__draft-text">{{ draftText(r) }}</span>
                      @if (r.status === 'duplicate' && r.duplicateOfNumber && !r.duplicateLinked && role() === 'pm') {
                        <button type="button" class="btn btn--text act" [disabled]="store.loading()" (click)="link(r)">{{ linkLabel(r.duplicateOfNumber) }}</button>
                      }
                    </td>
                    <td class="journal__status"><rr-status-pill [status]="r.status" [dot]="true" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (!store.loading()) {
          <rr-empty-state [title]="store.total() === 0 ? empty.noRemarks : emptyFilter">
            @if (store.total() === 0 && role() === 'business') {
              <a cta class="btn btn--primary" [routerLink]="newLink()">{{ nav.addRemark }}</a>
            }
          </rr-empty-state>
        }
      </main>
    </div>
  `,
  styles: `
    .banner {
      margin-bottom: var(--sp-4);
    }
    .chips {
      display: flex;
      gap: var(--sp-2);
      flex-wrap: wrap;
      margin-bottom: var(--sp-4);
    }
    .journal__c-n {
      width: 72px;
    }
    .journal__c-shot {
      width: 112px;
    }
    .journal__c-draft {
      width: 320px;
    }
    .journal__c-status {
      width: 200px;
    }
    .journal__n {
      color: var(--rr-ink-2);
    }
    .journal__title {
      font-weight: var(--fw-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 0;
    }
    .journal__draft {
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
    }
    .journal__draft-text {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
    }
    .journal__draft .act {
      margin-left: 10px;
      vertical-align: middle;
    }
    .journal__status-inline {
      display: none;
    }
    .ph-add {
      display: none;
    }
    @media (max-width: 1100px) and (min-width: 721px) {
      .journal {
        min-width: 880px;
      }
    }
    @media (max-width: 720px) {
      .ph-add {
        display: inline-flex;
      }
      .journal__c-draft,
      .journal__c-shot,
      .journal__c-status,
      .journal :is(td, th):nth-child(3),
      .journal :is(td, th):nth-child(4),
      .journal :is(td, th):nth-child(5) {
        display: none;
      }
      .journal__c-n {
        width: 48px;
      }
      .journal__title {
        white-space: normal;
        max-width: none;
        padding-top: var(--sp-3);
        padding-bottom: var(--sp-3);
      }
      .journal__status-inline {
        display: inline-flex;
        margin-top: 6px;
      }
      .journal__title-text {
        display: block;
      }
    }
  `,
})
export class JournalPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly title = inject(Title);

  protected readonly chips = JOURNAL.chips;
  protected readonly columns = JOURNAL.columns;
  protected readonly empty = EMPTY;
  protected readonly nav = NAV;
  protected readonly emptyFilter = JOURNAL.emptyFilter;
  protected readonly filterLabel = 'Фильтр';
  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly roleTitle = computed(() => (this.role() ? ROLE_TITLE[this.role()!] : ''));
  protected readonly filter = signal<JournalChip>('Все');

  protected readonly subtitle = computed(() => {
    const n = this.store.roundNumber();
    if (!n) return this.store.projectName() || null;
    return `${ROUND.label(n)} · ${JOURNAL.summary(this.store.total(), this.store.awaitingCount())}`;
  });

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const round = this.round();
      untracked(() => {
        this.filter.set(this.session.roleIn(projectId) === 'pm' ? 'Ждут меня' : 'Все');
        void this.store.enterRound(projectId, round);
      });
    });
    effect(() => {
      const n = this.store.roundNumber();
      this.title.setTitle(`${TITLE.journal(n)} — ${APP_NAME}`);
    });
  }

  protected readonly rows = computed<Remark[]>(() => filterRemarks(this.store.remarks(), this.filter(), this.role()));

  protected readonly counts = computed<Record<string, number>>(() => {
    const list = this.store.remarks();
    const role = this.role();
    return Object.fromEntries(this.chips.map((c) => [c, filterRemarks(list, c, role).length]));
  });

  protected reload(): void {
    void this.store.enterRound(this.projectId(), this.round());
  }

  protected cardLink(r: Remark): unknown[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', r.id];
  }

  protected newLink(): unknown[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', 'new'];
  }

  protected rowLabel(r: Remark): string {
    return TITLE.remark(r.number, r.title);
  }

  /** Последний кадр без диффа: в журнале видно «стало», если ретест уже был. */
  protected thumb(r: Remark): Screenshot | null {
    const shots = r.screenshots.filter((s) => s.kind !== 'diff');
    return shots.length ? shots[shots.length - 1]! : null;
  }

  protected draftText(r: Remark): string {
    const withDraft = r.status === 'awaiting_pm' || r.status === 'cannot_tell' || r.status === 'duplicate' || r.status === 'triaging';
    return withDraft && r.draftShort ? r.draftShort : '—';
  }

  protected linkLabel(n: number): string {
    return CARD.linkDuplicate(n);
  }

  protected link(r: Remark): void {
    void this.store.linkDuplicate(r.id);
  }
}

/** Фильтр журнала: чип × роль. «Ждут меня» у бизнеса и у PM — разные статусы. */
export function filterRemarks(list: Remark[], chip: JournalChip, role: Role | null): Remark[] {
  switch (chip) {
    case 'Ждут меня':
      return list.filter((r) =>
        role === 'business'
          ? r.status === 'cannot_tell' || r.status === 'ready_for_retest' || r.status === 'awaiting_business_close' || r.status === 'unspecified'
          : r.status === 'awaiting_pm' || r.status === 'cannot_tell',
      );
    case 'В работе':
      return list.filter((r) => r.status === 'defect');
    case 'Новые желания':
      return list.filter((r) => r.status === 'change_request' || (r.status === 'awaiting_pm' && r.proposedClass === 'change_request_candidate'));
    case 'На ретесте':
      return list.filter((r) => r.status === 'ready_for_retest' || r.status === 'awaiting_business_close');
    case 'Дописать из журнала':
      return list.filter((r) => r.status === 'needs_human_parse');
    default:
      return list;
  }
}
