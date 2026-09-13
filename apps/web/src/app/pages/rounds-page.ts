import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ROLE_SHORT, ROUNDS } from '../core/copy';
import { journalFileName, saveBlob } from '../core/download';
import { errorMessage } from '../core/errors';
import { dateRu } from '../core/format';
import { links } from '../core/links';
import type { Round } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';

/**
 * Все раунды проекта (ADR 011): когда открыт, когда и кем закрыт, из чего состоит; строка ведёт в журнал раунда,
 * у каждой — выгрузка этого раунда, в шапке — журнал всего проекта (три листа: раунды, замечания, история).
 * Свежий раунд сверху: через год ищут «раунд 2», а сегодня работают в последнем. Цветного объекта на странице нет —
 * это архив, а не очередь; открытый раунд отмечен словом «идёт».
 */
@Component({
  selector: 'rr-rounds-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, ErrorBanner, EmptyState, Skeleton],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="copy.title" [subtitle]="copy.subtitle">
          @if (rounds().length) {
            <button actions type="button" class="btn btn--secondary" [class.btn--busy]="exporting() === 'all'" [disabled]="!!exporting()" (click)="exportJournal()">{{ copy.exportJournal }}</button>
          }
        </rr-page-header>

        @if (error(); as err) {
          <rr-error-banner class="banner" [message]="err" [retryable]="false" />
        } @else if (store.error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="store.loading()" (retry)="load()" />
        }

        @if (loading() && !rounds().length) {
          <rr-skeleton kind="table" [rows]="3" />
        } @else if (!rounds().length) {
          <rr-empty-state [title]="copy.empty" />
        } @else {
          <div class="paper tbl-wrap">
            <table class="tbl rounds">
              <caption class="visually-hidden">{{ copy.title }}</caption>
              <colgroup>
                <col class="rounds__c-n" />
                <col class="rounds__c-state" />
                <col class="rounds__c-counts" />
                <col class="rounds__c-act" />
              </colgroup>
              <thead>
                <tr>
                  @for (c of copy.columns; track $index) {
                    <th scope="col">{{ c }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of rounds(); track r.id; let i = $index) {
                  <tr class="tbl__row rise" [style.--i]="i" [attr.data-round-status]="r.status">
                    <td class="rounds__n">
                      <a class="row-link n-serif rounds__num" [routerLink]="journalLink(r)" [attr.aria-label]="copy.label(r.number)">{{ r.number }}</a>
                    </td>
                    <td class="rounds__state">
                      <span class="rounds__label">{{ copy.label(r.number) }}</span>
                      <span class="meta rounds__when" [class.rounds__when--open]="r.status === 'open'">{{ stateLine(r) }}</span>
                    </td>
                    <td class="rounds__counts">{{ copy.counts(r) }}</td>
                    <td class="rounds__act">
                      <button type="button" class="btn btn--text act" [class.btn--busy]="exporting() === r.id" [disabled]="!!exporting()" [attr.aria-label]="copy.exportRoundAria(r.number)" (click)="exportRound(r)">
                        {{ copy.exportRound }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </main>
    </div>
  `,
  styles: `
    .banner {
      margin-bottom: var(--sp-4);
    }
    .rounds {
      table-layout: fixed;
    }
    .rounds__c-n {
      width: 10%;
    }
    .rounds__c-state {
      width: 38%;
    }
    .rounds__c-counts {
      width: 36%;
    }
    .rounds__c-act {
      width: 16%;
    }
    .rounds .tbl__row {
      height: 72px;
    }
    .rounds__num {
      display: inline-block;
      min-width: 28px;
    }
    .tbl__row:hover .rounds__num {
      color: var(--rr-accent-text);
    }
    .rounds__label {
      display: block;
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .rounds__when {
      display: block;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* открытый раунд — маркер «сейчас здесь» на бумаге: тил, без заливки */
    .rounds__when--open {
      color: var(--rr-accent-2-text);
      font-weight: var(--fw-medium);
    }
    .rounds__counts {
      color: var(--rr-ink-2);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .rounds__act {
      text-align: right;
      white-space: nowrap;
    }
    .rounds tr:last-child td {
      border-bottom: 0;
    }
    @media (max-width: 900px) {
      .rounds {
        table-layout: auto;
      }
      .rounds :is(td, th):nth-child(3) {
        display: none;
      }
      .rounds__c-counts {
        display: none;
      }
      .rounds__when {
        white-space: normal;
      }
    }
  `,
})
export class RoundsPage {
  readonly projectId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);

  protected readonly copy = ROUNDS;
  protected readonly loading = signal(false);
  protected readonly exporting = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Свежий раунд сверху. */
  protected readonly rounds = computed(() => [...this.store.rounds()].sort((a, b) => b.number - a.number));
  private readonly slug = computed(() => this.session.slugOf(this.projectId()));

  constructor() {
    effect(() => {
      this.projectId();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      await this.store.loadRounds(this.projectId());
    } finally {
      this.loading.set(false);
    }
  }

  protected journalLink(r: Round): string[] {
    return links.journal(this.slug(), r.number);
  }

  protected stateLine(r: Round): string {
    if (r.status === 'open') return this.copy.open(dateRu(r.createdAt));
    const who = r.closedByName ? (r.closedByRole ? `${r.closedByName} (${ROLE_SHORT[r.closedByRole]})` : r.closedByName) : '';
    return this.copy.closed(dateRu(r.closedAt), who);
  }

  protected async exportJournal(): Promise<void> {
    await this.download('all', () => this.api.exportJournal(this.projectId()), journalFileName(this.slug()));
  }

  protected async exportRound(r: Round): Promise<void> {
    await this.download(r.id, () => this.api.exportRound(this.projectId(), r.id), journalFileName(this.slug(), r.number));
  }

  private async download(key: string, fetch: () => Promise<Blob>, fileName: string): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(key);
    this.error.set(null);
    try {
      saveBlob(await fetch(), fileName);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.exporting.set(null);
    }
  }
}
