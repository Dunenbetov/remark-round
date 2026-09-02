import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Remark, Screenshot } from '../core/models';
import { CARD, EMPTY, JOURNAL, JournalChip } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { GlassHeader } from '../ui/glass-header';
import { Shot } from '../ui/shot';
import { StatusPill } from '../ui/status-pill';

/** Журнал раунда: чипы-фильтры и таблица № · Суть · Скрин · Черновик · Статус. Не канбан. */
@Component({
  selector: 'rr-journal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GlassHeader, Shot, StatusPill],
  template: `
    <div class="page">
      <rr-glass-header [extra]="summary()" />
      <main class="page__body page__body--loose">
        <div class="chips" role="group" aria-label="Фильтр">
          @for (chip of chips; track chip) {
            <button type="button" class="chip" [class.chip--on]="filter() === chip" [attr.aria-pressed]="filter() === chip" (click)="filter.set(chip)">{{ chip }}</button>
          }
        </div>
        <div class="table paper">
          <div class="row row--head col-title">
            @for (c of columns; track c) {
              <span>{{ c }}</span>
            }
          </div>
          @for (r of rows(); track r.id) {
            <a class="row row--body" [routerLink]="cardLink(r)" [attr.data-status]="r.status">
              <span class="num row__n">{{ r.number }}</span>
              <span class="row__title">{{ r.title }}</span>
              <span>
                @if (thumb(r); as s) {
                  <span class="thumb"><rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" /></span>
                } @else {
                  <span class="dash">—</span>
                }
              </span>
              <span class="row__draft">
                <span class="row__draft-text">{{ draftText(r) }}</span>
                @if (r.status === 'duplicate' && r.duplicateOfNumber && !r.duplicateLinked && role() === 'pm') {
                  <button type="button" class="btn btn--text" (click)="link($event, r)">{{ linkLabel(r.duplicateOfNumber) }}</button>
                }
              </span>
              <span><rr-status-pill [status]="r.status" /></span>
            </a>
          } @empty {
            <div class="empty">{{ store.loading() ? '' : store.total() === 0 ? empty.noRemarks : emptyFilter }}</div>
          }
        </div>
      </main>
    </div>
  `,
  styles: `
    .chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .table {
      overflow: hidden;
    }
    .row {
      display: grid;
      grid-template-columns: 72px minmax(220px, 1fr) 112px minmax(180px, 320px) 200px;
      gap: 16px;
      align-items: center;
      padding: 0 20px;
      border-bottom: 1px solid var(--rr-line);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row--head {
      height: 44px;
    }
    .row--body {
      height: 52px;
      color: var(--rr-ink);
      text-decoration: none;
      cursor: pointer;
    }
    .row--body:hover {
      background: var(--rr-surface-2);
      color: var(--rr-ink);
    }
    .row__n {
      color: var(--rr-ink-soft);
    }
    .row__title {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row__draft {
      color: var(--rr-ink-soft);
      white-space: nowrap;
      overflow: hidden;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .row__draft-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 1100px) {
      .table {
        overflow-x: auto;
      }
      .row {
        min-width: 880px;
      }
    }
  `,
})
export class JournalPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);

  protected readonly chips = JOURNAL.chips;
  protected readonly columns = JOURNAL.columns;
  protected readonly empty = EMPTY;
  protected readonly emptyFilter = JOURNAL.emptyFilter;
  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly filter = signal<JournalChip>('Все');

  protected readonly summary = computed(() => (this.store.round() ? JOURNAL.summary(this.store.total(), this.store.awaitingCount()) : null));

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const round = this.round();
      untracked(() => {
        this.filter.set(this.session.roleIn(projectId) === 'pm' ? 'Ждут меня' : 'Все');
        void this.store.enterRound(projectId, round);
      });
    });
  }

  protected readonly rows = computed<Remark[]>(() => {
    const role = this.role();
    const list = this.store.remarks();
    switch (this.filter()) {
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
  });

  protected cardLink(r: Remark): unknown[] {
    return ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round(), 'remarks', r.id];
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

  protected link(e: Event, r: Remark): void {
    e.preventDefault();
    e.stopPropagation();
    void this.store.linkDuplicate(r.id);
  }
}
