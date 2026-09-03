import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Remark } from '../core/models';
import { CARD, DECISION, DEV_QUEUE, EMPTY, ROLE_TITLE } from '../core/copy';
import { PendingActionService } from '../core/pending-action.service';
import { RemarksStore } from '../core/remarks.store';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Shot } from '../ui/shot';
import { Skeleton } from '../ui/skeleton';
import { StatusPill } from '../ui/status-pill';

/** Очередь разработчика: только принятые поломки. Кнопки «Закрыть» нет. */
@Component({
  selector: 'rr-dev-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, ErrorBanner, EmptyState, Skeleton, Shot, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose queue">
        <rr-page-header [title]="roleTitle" [subtitle]="subtitle" />
        @if (store.error(); as err) {
          <rr-error-banner [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }
        @if (store.loading() && !store.devQueue().length && !store.error()) {
          <rr-skeleton kind="cards" [rows]="3" />
        }
        @for (r of store.devQueue(); track r.id) {
          <article class="paper item" [attr.data-status]="r.status">
            <span class="num item__n">{{ r.number }}</span>
            <div class="item__text">
              <h2 class="item__title"><a class="row-link" [routerLink]="cardLink(r)">{{ r.title }}</a></h2>
              <div class="meta">{{ copy.where }} {{ r.pageOrScreen }}@if (r.devNote) { · {{ r.devNote }}}</div>
            </div>
            <span class="tag">{{ section(r) }}</span>
            @if (r.screenshots[0]; as s) {
              <span class="thumb thumb--lg"><rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" /></span>
            } @else {
              <span class="thumb thumb--lg thumb--empty"></span>
            }
            <span class="item__action">
              @if (r.status === 'defect') {
                <button type="button" class="btn btn--primary act" [disabled]="store.loading() || !!actions.pendingFor(r.id)" (click)="ready(r)">{{ readyLabel }}</button>
              } @else {
                <rr-status-pill [status]="r.status" [dot]="true" />
              }
            </span>
          </article>
        } @empty {
          @if (!store.loading() && !store.error()) {
            <rr-empty-state [title]="empty" />
          }
        }
      </main>
    </div>
  `,
  styles: `
    .queue {
      gap: var(--sp-4);
    }
    .item {
      position: relative;
      padding: var(--sp-5) var(--sp-6);
      display: grid;
      grid-template-columns: 72px 1fr 160px 200px 260px;
      gap: var(--sp-4);
      align-items: center;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .item:hover {
      background: var(--rr-surface-2);
    }
    .item:has(.row-link:focus-visible) {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .item__n {
      color: var(--rr-ink-2);
      font-size: var(--fs-16);
    }
    .item__text {
      min-width: 0;
    }
    .item__title {
      margin: 0;
      font-weight: var(--fw-semibold);
      font-size: var(--fs-16);
      line-height: var(--lh-16);
    }
    .item__action {
      display: flex;
      justify-content: flex-end;
    }
    .thumb--empty {
      background: var(--rr-surface-2);
    }
    @media (max-width: 960px) {
      .item {
        grid-template-columns: 48px 1fr;
      }
      .item > .tag,
      .item > .thumb {
        display: none;
      }
      .item__action {
        grid-column: 2;
        justify-content: flex-start;
      }
    }
  `,
})
export class DevQueuePage {
  readonly projectId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  protected readonly actions = inject(PendingActionService);

  protected readonly copy = CARD;
  protected readonly roleTitle = ROLE_TITLE.developer;
  protected readonly subtitle = DEV_QUEUE.subtitle;
  protected readonly readyLabel = DECISION.readyForRetest;
  protected readonly empty = EMPTY.devEmpty;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      untracked(() => void this.store.loadDevQueue(projectId));
    });
  }

  protected reload(): void {
    void this.store.loadDevQueue(this.projectId());
  }

  protected section(r: Remark): string {
    const spec = r.citations.find((c) => c.source === 'spec' && c.section);
    const number = spec?.section ? /§\S+/.exec(spec.section)?.[0] : null;
    return number ? `ТЗ ${number}` : 'ТЗ';
  }

  protected cardLink(r: Remark): unknown[] {
    return ['/p', this.projectId(), 'r', r.roundNumber, 'remarks', r.id];
  }

  /** «Готово, можно смотреть снова» уходит через 5 секунд — внизу полоса с «Отменить». */
  protected ready(r: Remark): void {
    this.actions.schedule({ remarkId: r.id, label: DECISION.readyForRetest, inline: false, commit: () => this.store.readyForRetest(r.id) });
  }
}
