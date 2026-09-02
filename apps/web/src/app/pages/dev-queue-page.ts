import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { Remark } from '../core/models';
import { CARD, DECISION, DEV_QUEUE, EMPTY } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { GlassHeader } from '../ui/glass-header';
import { Shot } from '../ui/shot';
import { StatusPill } from '../ui/status-pill';

/** Очередь разработчика: только принятые поломки. Кнопки «Закрыть» нет. */
@Component({
  selector: 'rr-dev-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassHeader, Shot, StatusPill],
  template: `
    <div class="page">
      <rr-glass-header [presence]="false" />
      <main class="page__body page__body--loose queue">
        <p class="queue__subtitle">{{ subtitle }}</p>
        @for (r of store.devQueue(); track r.id) {
          <div class="paper item" [attr.data-status]="r.status" (click)="open(r)" role="link" tabindex="0" (keydown.enter)="open(r)">
            <span class="num item__n">{{ r.number }}</span>
            <div class="item__text">
              <div class="item__title">{{ r.title }}</div>
              <div class="meta">{{ copy.where }} {{ r.pageOrScreen }}@if (r.devNote) { · {{ r.devNote }}}</div>
            </div>
            <span class="tag">{{ section(r) }}</span>
            @if (r.screenshots[0]; as s) {
              <span class="thumb thumb--lg"><rr-shot [variant]="s.variant" /></span>
            } @else {
              <span class="thumb thumb--lg thumb--empty"></span>
            }
            <span class="item__action">
              @if (r.status === 'defect') {
                <button type="button" class="btn btn--primary" (click)="ready($event, r)">{{ readyLabel }}</button>
              } @else {
                <rr-status-pill [status]="r.status" />
              }
            </span>
          </div>
        } @empty {
          <div class="paper empty">{{ empty }}</div>
        }
      </main>
    </div>
  `,
  styles: `
    .queue {
      gap: 16px;
    }
    .queue__subtitle {
      margin: 0;
      color: var(--rr-ink-soft);
      max-width: 720px;
    }
    .item {
      padding: 20px 24px;
      display: grid;
      grid-template-columns: 72px 1fr 160px 200px 260px;
      gap: 16px;
      align-items: center;
      cursor: pointer;
    }
    .item:hover {
      background: var(--rr-surface-2);
    }
    .item__n {
      color: var(--rr-ink-soft);
      font-size: 15px;
    }
    .item__text {
      min-width: 0;
    }
    .item__title {
      font-weight: 600;
      font-size: 15px;
      line-height: 22px;
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
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly copy = CARD;
  protected readonly subtitle = DEV_QUEUE.subtitle;
  protected readonly readyLabel = DECISION.readyForRetest;
  protected readonly empty = EMPTY.devEmpty;

  protected section(r: Remark): string {
    const spec = r.citations.find((c) => c.source === 'spec' && c.section);
    return spec ? `ТЗ ${spec.section}` : 'ТЗ';
  }

  protected open(r: Remark): void {
    void this.router.navigate(['/p', this.projectId(), 'r', r.roundNumber, 'remarks', r.id]);
  }

  protected ready(e: Event, r: Remark): void {
    e.stopPropagation();
    this.store.readyForRetest(r.id, this.session.user()?.id ?? '');
  }
}
