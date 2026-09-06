import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Remark, Screenshot } from '../core/models';
import { CARD, DECISION, DEV_QUEUE, EMPTY, QUEUE, ROLE_TITLE, STAMP_LABEL } from '../core/copy';
import { SessionService } from '../core/session.service';
import { PendingActionService } from '../core/pending-action.service';
import { QueueService } from '../core/queue.service';
import { RemarksStore } from '../core/remarks.store';
import { ShortcutsService } from '../core/shortcuts.service';
import { UiStateService } from '../core/ui-state.service';
import { AppBar } from '../ui/app-bar';
import { EmptyState } from '../ui/empty-state';
import { ErrorBanner } from '../ui/error-banner';
import { GroupHeader } from '../ui/group-header';
import { PageHeader } from '../ui/page-header';
import { Shot } from '../ui/shot';
import { Skeleton } from '../ui/skeleton';
import { Stamp } from '../ui/stamp';
import { StatusPill } from '../ui/status-pill';

/** Сколько символов цитаты ТЗ показываем в строке. */
const QUOTE_LEN = 90;

/**
 * Очередь разработчика: только принятые поломки, две группы — каждая одной бумагой с заголовком
 * (как группы в журнале). «В работе» — строки 104px с медной полосой и кнопкой «Готово, можно смотреть снова»;
 * «Ждут проверки заказчика» — строки 64px без кнопок. Кнопки «Закрыть» нет.
 * Клик по строке записывает снимок очереди — карточка покажет рельс «i из N».
 * Клавиши: ↓/↑ (J/K) — подсветка строки, Enter — открыть, 1 — «Готово» у подсвеченной поломки.
 */
@Component({
  selector: 'rr-dev-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, PageHeader, GroupHeader, ErrorBanner, EmptyState, Skeleton, Shot, Stamp, StatusPill],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose queue">
        <rr-page-header size="lg" [title]="roleTitle" [subtitle]="subtitle">
          @if (store.devQueue().length || advisory().length) {
            <div hint class="meta num queue__counts">{{ counts() }}</div>
          }
        </rr-page-header>

        @if (store.error(); as err) {
          <rr-error-banner class="queue__banner" [message]="err" [busy]="store.loading()" (retry)="reload()" />
        }

        @if (store.loading() && !store.devQueue().length && !advisory().length && !store.error()) {
          <rr-skeleton kind="cards104" [rows]="3" />
        } @else if (!store.devQueue().length && !advisory().length) {
          @if (!store.loading() && !store.error()) {
            <rr-empty-state [title]="empty" />
          }
        } @else {
          <!-- В работе -->
          @if (store.devQueue().length) {
          <section class="paper rows" [attr.aria-label]="copy.groups.todo">
            <rr-group-header [title]="copy.groups.todo" [count]="todo().length" tone="accent-2" [sticky]="false" />
            @for (r of todo(); track r.id; let i = $index) {
              <article class="row row--card rise" [class.row--focused]="focused() === r.id" [style.--i]="i" [attr.data-status]="r.status" [attr.data-id]="r.id">
                <span class="n-serif row__n num">{{ r.number }}</span>
                <div class="row__text">
                  <h2 class="row__title row__title--card">
                    <a class="row-link" [routerLink]="cardLink(r)" [style.viewTransitionName]="ui.lastRemarkId() === r.id ? 'remark-n' : null" (click)="onOpen(r)">{{ r.title }}</a>
                  </h2>
                  <div class="meta row__meta">{{ metaLine(r) }}</div>
                  @if (quote(r); as q) {
                    <div class="row__quote">{{ q }}</div>
                  }
                </div>
                <div class="row__side">
                  @if (thumb(r); as s) {
                    <span class="thumb thumb--lg row__thumb"><rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" /></span>
                  }
                  <button type="button" class="btn btn--soft btn--sm act row__btn" [disabled]="store.loading() || !!actions.pendingFor(r.id)" (click)="ready(r)">{{ readyLabel }}</button>
                </div>
              </article>
            } @empty {
              <div class="row row--done rise">
                <rr-stamp [label]="stampReady" tone="work" [animate]="false" />
                <span class="row__done-text">{{ copy.allDone }}</span>
              </div>
            }
          </section>
          }

          <!-- Сейчас у руководителя приёмки: не работа, но можно посоветовать решение -->
          @if (advisory().length) {
            <section class="paper rows" [attr.aria-label]="copy.groups.advisory">
              <rr-group-header [title]="copy.groups.advisory" [count]="advisory().length" tone="wait" [sticky]="false" />
              <div class="rows__hint meta">{{ copy.advisoryHint }}</div>
              @for (r of advisory(); track r.id; let i = $index) {
                <div class="row rise" [class.row--focused]="focused() === r.id" [style.--i]="i" [attr.data-status]="r.status" [attr.data-id]="r.id">
                  <span class="n-serif row__n num">{{ r.number }}</span>
                  <div class="row__text">
                    <span class="row__title"><a class="row-link" [routerLink]="cardLink(r)" (click)="onOpenAdvisory(r)">{{ r.title }}</a></span>
                    <span class="meta row__meta">{{ r.draftShort || whereLine(r) }}</span>
                  </div>
                  @if (myAdvice(r); as a) {
                    <span class="row__advice num">{{ copy.yourAdvice }} {{ stampLabel[a.code] }}</span>
                  } @else {
                    <span class="meta row__advise">{{ copy.advise }} →</span>
                  }
                </div>
              }
            </section>
          }

          <!-- Ждут проверки заказчика -->
          @if (review().length) {
            <section class="paper rows" [attr.aria-label]="copy.groups.review">
              <rr-group-header [title]="copy.groups.review" [count]="review().length" tone="muted" [sticky]="false" />
              @for (r of review(); track r.id; let i = $index) {
                <div class="row rise" [class.row--focused]="focused() === r.id" [style.--i]="i" [attr.data-status]="r.status" [attr.data-id]="r.id">
                  <span class="n-serif row__n num">{{ r.number }}</span>
                  <div class="row__text">
                    <span class="row__title"><a class="row-link" [routerLink]="cardLink(r)" (click)="onOpenReview(r)">{{ r.title }}</a></span>
                    <span class="meta row__meta">{{ whereLine(r) }}</span>
                  </div>
                  <rr-status-pill [status]="r.status" [dot]="true" />
                </div>
              }
            </section>
          }
        }
      </main>
    </div>
  `,
  styles: `
    .queue {
      gap: var(--sp-6);
    }
    .queue__counts {
      margin-top: calc(-1 * var(--sp-2));
    }
    .queue__banner {
      margin-bottom: calc(-1 * var(--sp-2));
    }
    .rows {
      overflow: hidden;
    }

    /* ---------- строка ---------- */
    .row {
      position: relative;
      min-height: 64px;
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      gap: var(--sp-4);
      align-items: center;
      padding: 0 var(--sp-5);
      border-bottom: 1px solid var(--rr-line);
      transition: background-color var(--dur-fast) var(--ease);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row:hover,
    .row--focused {
      background: var(--rr-surface-2);
    }
    .row:has(.row-link:focus-visible),
    .row--focused {
      outline: 2px solid var(--rr-focus);
      outline-offset: -2px;
    }
    .row__n {
      transition: color var(--dur-fast) var(--ease);
    }
    .row:hover .row__n,
    .row--focused .row__n {
      color: var(--rr-accent-2-text);
    }
    .row__text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .row__title {
      margin: 0;
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      font-weight: var(--fw-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row__meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ---------- «В работе»: строка 104px с медной полосой (закон меди п. а) ---------- */
    .row--card {
      min-height: 104px;
      padding-top: var(--sp-3);
      padding-bottom: var(--sp-3);
    }
    .row--card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 12px;
      bottom: 12px;
      width: 3px;
      border-radius: 0 2px 2px 0;
      background: var(--rr-accent-2);
    }
    .row--card .row__text {
      gap: 4px;
    }
    .row__title--card {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    /* строка цитаты ТЗ — «голос документов», сериф */
    .row__quote {
      font-family: var(--rr-serif);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      color: var(--rr-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row__side {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
    }
    .row__btn {
      white-space: nowrap;
    }

    /* ---------- на приёмке у PM ---------- */
    .rows__hint {
      padding: var(--sp-2) var(--sp-5) var(--sp-3);
      border-bottom: 1px solid var(--rr-line);
    }
    .row__advice {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      background: var(--rr-work-bg);
      color: var(--rr-work-ink);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      font-weight: var(--fw-medium);
      white-space: nowrap;
    }
    .row__advise {
      white-space: nowrap;
      color: var(--rr-ink-3);
    }

    /* ---------- всё сделано ---------- */
    .row--done {
      display: flex;
      align-items: center;
      gap: var(--sp-5);
      min-height: 104px;
      padding: var(--sp-4) var(--sp-6);
    }
    .row__done-text {
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      color: var(--rr-ink-2);
    }

    @media (max-width: 900px) {
      .row {
        grid-template-columns: 56px minmax(0, 1fr);
        padding-top: var(--sp-3);
        padding-bottom: var(--sp-3);
      }
      .row__title {
        white-space: normal;
      }
      .row__thumb {
        display: none;
      }
      .row__side {
        grid-column: 2;
      }
      .row__btn {
        width: 100%;
      }
      .row > rr-status-pill {
        grid-column: 2;
      }
    }
  `,
})
export class DevQueuePage {
  readonly projectId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  protected readonly actions = inject(PendingActionService);
  protected readonly ui = inject(UiStateService);
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);
  private readonly shortcuts = inject(ShortcutsService);
  private readonly session = inject(SessionService);

  protected readonly copy = DEV_QUEUE;
  protected readonly roleTitle = ROLE_TITLE.developer;
  protected readonly subtitle = DEV_QUEUE.subtitle;
  protected readonly readyLabel = DECISION.readyForRetest;
  protected readonly empty = EMPTY.devEmpty;
  protected readonly stampReady = STAMP_LABEL.ready;
  protected readonly stampLabel = STAMP_LABEL;

  /** Строка, подсвеченная клавишами ↓/↑ (J/K); Enter открывает, «1» — «Готово» у поломки. */
  protected readonly focused = signal<string | null>(null);

  /** «В работе»: принятые поломки, у которых ещё нет «Готово». */
  protected readonly todo = computed(() => this.store.devQueue().filter((r) => r.status === 'defect'));
  /** «Ждут проверки заказчика»: всё остальное, что API отдал разработчику. */
  protected readonly review = computed(() => this.store.devQueue().filter((r) => r.status !== 'defect'));
  /** «Сейчас у руководителя приёмки»: awaiting_pm — можно посоветовать. */
  protected readonly advisory = computed(() => this.store.advisoryQueue());
  protected readonly counts = computed(() => DEV_QUEUE.counts(this.todo().length, this.review().length, this.advisory().length));

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      untracked(() => {
        void this.store.loadDevQueue(projectId);
        void this.store.loadAdvisoryQueue(projectId);
      });
    });
    const unbind = this.shortcuts.bind({
      ArrowDown: () => this.move(1),
      KeyJ: () => this.move(1),
      ArrowUp: () => this.move(-1),
      KeyK: () => this.move(-1),
      Enter: () => this.openFocused(),
      Digit1: () => this.readyFocused(),
    });
    inject(DestroyRef).onDestroy(unbind);
  }

  protected reload(): void {
    void this.store.loadDevQueue(this.projectId());
    void this.store.loadAdvisoryQueue(this.projectId());
  }

  /** Мой совет по замечанию на приёмке (если давал). */
  protected myAdvice(r: Remark): { code: keyof typeof STAMP_LABEL } | null {
    const me = this.session.user()?.id;
    const a = r.advice?.find((x) => x.userId === me);
    return a ? { code: a.code } : null;
  }

  /** «Где: Профиль · Как должно быть: …» — ожидание заказчика, иначе подпись для разработчика. */
  protected metaLine(r: Remark): string {
    const tail = r.expected ? `${DEV_QUEUE.expected} ${r.expected}` : (r.devNote ?? '');
    return [this.whereLine(r), tail].filter(Boolean).join(' · ');
  }

  protected whereLine(r: Remark): string {
    return r.pageOrScreen && r.pageOrScreen !== '—' ? `${CARD.where} ${r.pageOrScreen}` : '';
  }

  /** Первые ~90 символов цитаты ТЗ; без цитаты строка не рендерится. */
  protected quote(r: Remark): string | null {
    const spec = r.citations.find((c) => c.source === 'spec' && c.text);
    if (!spec) return null;
    const text = spec.text.trim();
    return text.length > QUOTE_LEN ? `${text.slice(0, QUOTE_LEN).trimEnd()}…` : text;
  }

  /** Миниатюра только когда скрин есть: последний кадр без диффа. */
  protected thumb(r: Remark): Screenshot | null {
    const shots = r.screenshots.filter((s) => s.kind !== 'diff');
    return shots.length ? shots[shots.length - 1]! : null;
  }

  protected cardLink(r: Remark): (string | number)[] {
    return ['/p', this.projectId(), 'r', r.roundNumber, 'remarks', r.id];
  }

  private backLink(): (string | number)[] {
    return ['/p', this.projectId(), 'dev'];
  }

  /** Клик по строке «В работе»: очередь = строки группы в порядке показа; номер перетекает в шапку карточки. */
  protected onOpen(r: Remark): void {
    this.queue.set(this.todo().map((x) => x.id), QUEUE.dev, this.backLink());
    this.ui.lastRemarkId.set(r.id);
  }

  /** Клик по строке «Ждут проверки»: очередь = строки этой группы. */
  protected onOpenReview(r: Remark): void {
    this.queue.set(this.review().map((x) => x.id), DEV_QUEUE.groups.review, this.backLink());
    this.ui.lastRemarkId.set(r.id);
  }

  /** Клик по строке «на приёмке»: очередь = замечания, ждущие PM; на карточке — режим «Посоветовать». */
  protected onOpenAdvisory(r: Remark): void {
    this.queue.set(this.advisory().map((x) => x.id), DEV_QUEUE.advisoryQueue, this.backLink());
    this.ui.lastRemarkId.set(r.id);
  }

  /** «Готово, можно смотреть снова» уходит через 5 секунд — внизу полоса с «Отменить». */
  protected ready(r: Remark): void {
    this.actions.schedule({ remarkId: r.id, label: DECISION.readyForRetest, inline: false, commit: () => this.store.readyForRetest(r.id) });
  }

  // ---------- клавиатура ----------

  private rowsInOrder(): Remark[] {
    return [...this.todo(), ...this.advisory(), ...this.review()];
  }

  private focusedRemark(): Remark | null {
    return this.rowsInOrder().find((r) => r.id === this.focused()) ?? null;
  }

  private move(delta: 1 | -1): void {
    const rows = this.rowsInOrder();
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === this.focused());
    const next = i < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + delta));
    const id = rows[next]!.id;
    this.focused.set(id);
    document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private openFocused(): void {
    const r = this.focusedRemark();
    if (!r) return;
    if (r.status === 'defect') this.onOpen(r);
    else if (r.status === 'awaiting_pm') this.onOpenAdvisory(r);
    else this.onOpenReview(r);
    void this.router.navigate(this.cardLink(r));
  }

  /** «1» — «Готово» у подсвеченной поломки; пока по ней идёт отсчёт — ничего. */
  private readyFocused(): void {
    const r = this.focusedRemark();
    if (!r || r.status !== 'defect' || this.actions.pendingFor(r.id) || this.store.loading()) return;
    this.ready(r);
  }
}
