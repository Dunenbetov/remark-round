import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AttentionService } from '../core/attention.service';
import { INBOX, NOTIFY, ROLE_SHORT, ROLE_SIDE } from '../core/copy';
import { errorMessage, errorStatus } from '../core/errors';
import { dateTimeRu, dayMonthRu, isTodayRu, relTimeRu } from '../core/format';
import { homeUrlFor } from '../core/guards';
import { notifyHeadline } from '../core/history-label';
import { InvitationsInboxService } from '../core/invitations-inbox.service';
import { links } from '../core/links';
import type { InboxInvitation, NotificationView, Role } from '../core/models';
import { NotificationsStore } from '../core/notifications.store';
import { SessionService } from '../core/session.service';
import { BrandMark } from './brand-mark';
import { Icon } from './icons';
import { TONE_BY_ROLE } from './role-tone';
import { StatusPill } from './status-pill';

interface NotifyGroup {
  key: 'today' | 'earlier';
  title: string;
  items: NotificationView[];
}

/**
 * Колокольчик в шапке (ADR 013, 016): приглашения на мой e-mail и уведомления о замечаниях. Счётчик — одно число на кнопке;
 * панель якорится к ней, на узком экране растягивается на ширину шапки. Esc и клик снаружи закрывают (как rr-menu),
 * фокус при новых событиях не перехватываем. Строка уведомления — ссылка на карточку; если карточку открыть нельзя
 * (разработчик и ушедшее замечание) — строка без ссылки и без сути. Непрочитанное — тиловой подложкой, без точек (ANTI.md).
 * «Принять» приглашение обновляет membership ровно как принятие по ссылке (join-page) и ведёт в проект; 404/410 — приглашения уже нет.
 */
@Component({
  selector: 'rr-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, BrandMark, StatusPill, RouterLink, NgTemplateOutlet],
  host: {
    class: 'rr-bell',
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <button
      type="button"
      class="bell"
      [class.bell--on]="count() > 0"
      [attr.aria-label]="copy.bell(count())"
      [attr.title]="copy.bell(count())"
      aria-haspopup="dialog"
      aria-controls="rr-bell-panel"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <rr-icon name="bell" [size]="18" />
      @if (count() > 0) {
        <span class="bell__badge num" [class.bell__badge--pop]="pop()" (animationend)="pop.set(false)" aria-hidden="true">{{ count() > 9 ? '9+' : count() }}</span>
      }
    </button>
    @if (open()) {
      <div id="rr-bell-panel" class="bp" role="dialog" [attr.aria-label]="copy.title" tabindex="-1">
        <div class="bp__head">
          <h2 class="bp__title">{{ copy.title }}</h2>
          @if (store.unread() > 0) {
            <button type="button" class="btn btn--text" (click)="readAll()">{{ copy.readAll }}</button>
          }
        </div>

        <div class="bp__scroll">
          @if (inbox.items().length || message()) {
            <section class="bp__section" aria-labelledby="rr-bell-inv">
              <h3 class="bp__group" id="rr-bell-inv">{{ inboxCopy.title }}</h3>
              @if (message(); as m) {
                <p class="meta bp__msg" role="status">{{ m }}</p>
              }
              <ul class="bp__list">
                @for (inv of inbox.items(); track inv.id) {
                  <li class="inv">
                    <span class="inv__text">{{ inboxCopy.item(inv.inviterName, inv.projectName) }}</span>
                    <span class="meta">{{ roleSide[inv.role === 'admin' ? 'pm' : inv.role] }}@if (inv.expiresAt) { · {{ inboxCopy.expires(date(inv.expiresAt)) }}}</span>
                    <span class="inv__actions">
                      <button type="button" class="btn btn--primary btn--sm" [class.btn--busy]="busy() === 'accept:' + inv.id" [disabled]="!!busy()" (click)="accept(inv)">{{ inboxCopy.accept }}</button>
                      <button type="button" class="btn btn--secondary btn--sm" [class.btn--busy]="busy() === 'decline:' + inv.id" [disabled]="!!busy()" (click)="decline(inv)">{{ inboxCopy.decline }}</button>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          @for (g of groups(); track g.key) {
            <section class="bp__section" [attr.aria-labelledby]="'rr-bell-' + g.key">
              <h3 class="bp__group" [id]="'rr-bell-' + g.key">{{ g.title }}</h3>
              <ul class="bp__list">
                @for (n of g.items; track n.id) {
                  <li>
                    @if (n.remark.readable) {
                      <a class="nt" [class.nt--unread]="!n.readAt" [routerLink]="link(n)" (click)="onItem(n)">
                        <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: n }" />
                      </a>
                    } @else {
                      <div class="nt nt--static" [class.nt--unread]="!n.readAt">
                        <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: n }" />
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          }

          @if (store.hasMore()) {
            <div class="bp__more">
              <button type="button" class="btn btn--text" [class.btn--busy]="store.loading()" [disabled]="store.loading()" (click)="store.loadMore()">{{ copy.more }}</button>
            </div>
          }

          @if (store.loaded() && !store.items().length) {
            <div class="bp__empty">
              <p class="bp__empty-title">{{ copy.empty }}</p>
              <p class="meta">{{ copy.emptyHint }}</p>
            </div>
          }
        </div>

        <div class="bp__foot">
          <button type="button" class="sw" role="switch" [attr.aria-checked]="attention.sound()" (click)="attention.setSound(!attention.sound())">
            <span class="sw__track" aria-hidden="true"><span class="sw__knob"></span></span>
            {{ copy.sound }}
          </button>
          @if (attention.desktopSupported()) {
            <button type="button" class="sw" role="switch" [attr.aria-checked]="attention.desktop()" [attr.aria-describedby]="denied() ? 'rr-bell-denied' : null" (click)="attention.setDesktop(!attention.desktop())">
              <span class="sw__track" aria-hidden="true"><span class="sw__knob"></span></span>
              {{ copy.desktop }}
            </button>
          }
          @if (denied()) {
            <p class="meta bp__denied" id="rr-bell-denied">{{ copy.desktopDenied }}</p>
          }
        </div>
      </div>
    }

    <ng-template #row let-n>
      <span class="nt__who" aria-hidden="true">
        @if (n.by) {
          <span class="nt__avatar" [class]="'nt__avatar nt__avatar--' + tone(n)">{{ initial(n) }}</span>
        } @else {
          <span class="nt__avatar nt__avatar--system"><rr-brand-mark [size]="16" /></span>
        }
      </span>
      <span class="nt__body">
        <span class="nt__top">
          <span class="nt__headline">
            @if (!n.readAt) {
              <span class="visually-hidden">{{ copy.unreadSr }}</span>
            }
            {{ headline(n) }}
          </span>
          <time class="nt__time" [attr.datetime]="n.at" [attr.title]="fullTime(n.at)">{{ ago(n.at) }}</time>
        </span>
        <span class="nt__remark">{{ remarkLine(n) }}</span>
        <span class="nt__meta">
          <rr-status-pill class="nt__pill" [status]="n.remark.status" [role]="readerRole(n)" />
          <span class="nt__by">{{ who(n) }}@if (manyProjects()) { · {{ n.project.name }}}</span>
        </span>
      </span>
    </ng-template>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .bell {
      position: relative;
      width: 32px;
      height: 32px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: var(--rr-r-pill);
      border: 1px solid var(--rr-line);
      background: var(--rr-surface-2);
      color: var(--rr-ink-2);
      cursor: pointer;
      transition:
        color var(--dur-fast) var(--ease),
        border-color var(--dur-fast) var(--ease);
    }
    .bell:hover,
    .bell--on {
      color: var(--rr-ink);
    }
    .bell:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 2px;
    }
    .bell__badge {
      position: absolute;
      top: -4px;
      right: -5px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--rr-r-pill);
      background: var(--rr-accent);
      color: var(--rr-accent-ink);
      font-size: 11px;
      line-height: 18px;
      font-weight: var(--fw-semibold);
      text-align: center;
      box-shadow: 0 0 0 2px var(--rr-surface);
    }
    /* число выросло — бейдж пружинит один раз */
    .bell__badge--pop {
      animation: rr-pop var(--dur-slow) var(--rr-ease-spring);
    }

    .bp {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 400px;
      max-width: calc(100vw - 24px);
      max-height: min(72vh, 560px);
      display: flex;
      flex-direction: column;
      z-index: var(--z-menu);
      background: var(--rr-surface-raised);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-xl);
      box-shadow: var(--rr-shadow-2);
      overflow: hidden;
      transform-origin: top right;
      animation: rr-menu-in 140ms var(--rr-ease-out);
    }
    .bp:focus {
      outline: none;
    }
    .bp__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-4) var(--sp-2) var(--sp-5);
    }
    .bp__title {
      margin: 0;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      font-weight: var(--fw-semibold);
      color: var(--rr-ink);
    }
    .bp__scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 var(--sp-2) var(--sp-2);
    }
    .bp__section + .bp__section {
      margin-top: var(--sp-2);
    }
    .bp__group {
      margin: 0;
      padding: var(--sp-2) var(--sp-3) var(--sp-1);
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      font-weight: var(--fw-semibold);
      /* ink-2, а не ink-3: панель лежит на surface-raised, ночью ink-3 на нём ниже 4.5:1 */
      color: var(--rr-ink-2);
    }
    .bp__list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .bp__msg {
      margin: 0;
      padding: var(--sp-1) var(--sp-3);
    }

    /* приглашение — как было, с воздухом строки уведомления */
    .inv {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--sp-2) var(--sp-3) var(--sp-3);
    }
    .inv__text {
      font-weight: var(--fw-medium);
      overflow-wrap: anywhere;
    }
    .inv__actions {
      display: flex;
      gap: var(--sp-2);
      margin-top: var(--sp-2);
    }

    /* строка уведомления: что случилось и когда · № и суть на всю ширину · статус сейчас и кто */
    .nt {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      align-items: start;
      gap: var(--sp-3);
      padding: 10px var(--sp-3);
      border-radius: var(--rr-r-md);
      color: var(--rr-ink);
      text-decoration: none;
      transition: background-color var(--dur-fast) var(--ease);
    }
    a.nt:hover {
      background: var(--rr-surface-2);
      color: var(--rr-ink);
    }
    a.nt:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: -2px;
    }
    .nt--unread {
      background: var(--rr-accent-2-soft);
    }
    /* подложка непрочитанного не темнеет: мета ink-2 держит 4.5:1, наведение — линией по контуру */
    a.nt--unread:hover {
      background: var(--rr-accent-2-soft);
      box-shadow: inset 0 0 0 1px var(--rr-line-strong);
    }
    .nt__avatar {
      width: 28px;
      height: 28px;
      border-radius: var(--rr-r-pill);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: var(--fs-12);
      font-weight: var(--fw-semibold);
      color: var(--rr-ink);
      background: var(--rr-surface-2);
      border: 1px solid var(--rr-line);
    }
    .nt__avatar--wait {
      color: var(--rr-accent-2-text);
    }
    .nt__avatar--work,
    .nt__avatar--system {
      color: var(--rr-accent-text);
    }
    .nt__body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .nt__top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--sp-3);
      min-width: 0;
    }
    .nt__headline {
      min-width: 0;
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      font-weight: var(--fw-regular);
    }
    .nt--unread .nt__headline {
      font-weight: var(--fw-semibold);
    }
    .nt__time {
      flex: none;
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      color: var(--rr-ink-2);
      white-space: nowrap;
    }
    .nt__remark {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nt__meta {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      min-width: 0;
      margin-top: 2px;
    }
    .nt__by {
      min-width: 0;
      font-size: var(--fs-12);
      line-height: var(--lh-12);
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nt__pill {
      flex: none;
    }
    /* «ждёт» тем же тилом, что подложка непрочитанного, — пилюля ложится на бумагу, иначе слова без формы */
    .nt--unread .nt__pill ::ng-deep .pill--wait {
      background: var(--rr-surface-raised);
    }
    .nt__pill ::ng-deep .pill {
      height: 20px;
      padding: 0 8px;
      font-size: var(--fs-12);
      line-height: var(--lh-12);
    }

    .bp__more {
      display: flex;
      justify-content: center;
      padding: var(--sp-2) 0 var(--sp-1);
    }
    .bp__empty {
      padding: var(--sp-6) var(--sp-4) var(--sp-5);
      text-align: center;
    }
    .bp__empty p {
      margin: 0;
    }
    .bp__empty .bp__empty-title {
      margin-bottom: var(--sp-1);
      font-weight: var(--fw-medium);
    }

    /* низ: переключатели звука и системных уведомлений — настройка этого устройства */
    .bp__foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sp-2) var(--sp-5);
      padding: var(--sp-3) var(--sp-5);
      border-top: 1px solid var(--rr-line);
    }
    .bp__denied {
      flex-basis: 100%;
      margin: 0;
    }
    .sw {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: 28px;
      padding: 0;
      border: 0;
      background: transparent;
      font: inherit;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      font-weight: var(--fw-medium);
      color: var(--rr-ink);
      cursor: pointer;
    }
    .sw:focus-visible {
      outline: 2px solid var(--rr-focus);
      outline-offset: 3px;
      border-radius: var(--rr-r-xs);
    }
    .sw__track {
      position: relative;
      flex: none;
      width: 30px;
      height: 18px;
      border-radius: var(--rr-r-pill);
      background: var(--rr-line-strong);
      transition: background-color var(--dur) var(--ease);
    }
    .sw__knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: var(--rr-r-pill);
      background: var(--rr-surface);
      box-shadow: 0 1px 2px rgba(20, 26, 51, 0.25);
      transition: transform var(--dur) var(--rr-ease-out);
    }
    .sw[aria-checked='true'] .sw__track {
      background: var(--rr-accent);
    }
    .sw[aria-checked='true'] .sw__knob {
      transform: translateX(12px);
      background: var(--rr-accent-ink);
    }

    @media (prefers-reduced-motion: reduce) {
      .bell__badge--pop {
        animation: none;
      }
    }
    @media (max-width: 900px) {
      /* панель — по ширине шапки: якорем становится сама шапка, а не кнопка у правого края */
      :host {
        position: static;
      }
      .bp {
        left: var(--sp-2);
        right: var(--sp-2);
        width: auto;
        max-width: none;
      }
      .inv__actions .btn {
        flex: 1 1 0;
      }
    }
  `,
})
export class Bell {
  protected readonly store = inject(NotificationsStore);
  protected readonly inbox = inject(InvitationsInboxService);
  protected readonly attention = inject(AttentionService);
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly copy = NOTIFY;
  protected readonly inboxCopy = INBOX;
  /** Как на странице /join: сторона, а не «что вы делаете» — admin показываем как руководителя приёмки. */
  protected readonly roleSide = ROLE_SIDE;
  protected readonly open = signal(false);
  /** `accept:<id>` / `decline:<id>` — пока идёт запрос, остальные кнопки ждут. */
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly pop = signal(false);

  /** Одно число на кнопке: непрочитанные уведомления и приглашения. */
  protected readonly count = this.store.badge;
  protected readonly manyProjects = computed(() => this.session.memberships().length > 1);
  protected readonly denied = computed(() => this.attention.permission() === 'denied');
  /** Минутная метка: «5 мин назад» не застывает, пока панель открыта. */
  private readonly now = signal(Date.now());

  protected readonly groups = computed<NotifyGroup[]>(() => {
    const now = this.now();
    const today: NotificationView[] = [];
    const earlier: NotificationView[] = [];
    for (const n of this.store.items()) (isTodayRu(n.at, now) ? today : earlier).push(n);
    const groups: NotifyGroup[] = [];
    if (today.length) groups.push({ key: 'today', title: NOTIFY.today, items: today });
    if (earlier.length) groups.push({ key: 'earlier', title: NOTIFY.earlier, items: earlier });
    return groups;
  });

  private tick: ReturnType<typeof setInterval> | undefined;

  constructor() {
    let prev = this.count();
    effect(() => {
      const n = this.count();
      untracked(() => {
        if (n > prev) this.pop.set(true);
        prev = n;
      });
    });
    effect((onCleanup) => {
      if (!this.open()) return;
      this.now.set(Date.now());
      this.tick = setInterval(() => this.now.set(Date.now()), 30_000);
      onCleanup(() => clearInterval(this.tick));
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    this.message.set(null);
    this.open.set(true);
    void this.inbox.refresh();
    void this.store.sync();
    afterNextRender(() => this.panel()?.focus(), { injector: this.injector });
  }

  protected onDocClick(e: Event): void {
    // Кнопка внутри панели могла исчезнуть из DOM после клика (принято, «Прочитать все») — такой клик не «снаружи»
    const target = e.target as Node;
    if (this.open() && target.isConnected && !this.host.nativeElement.contains(target)) this.close(false);
  }

  protected onEscape(): void {
    if (this.open()) this.close(true);
  }

  /** Переход делает routerLink (работает и «открыть в новой вкладке»); здесь — прочитано, проект и закрыть панель. */
  protected onItem(n: NotificationView): void {
    void this.store.markRead([n.id]);
    if (this.session.isMember(n.project.id)) this.session.selectProject(n.project.id);
    this.close(false);
  }

  protected readAll(): void {
    void this.store.markAll();
    // Кнопка исчезнет вместе с непрочитанным — фокус остаётся в панели
    this.panel()?.focus();
  }

  protected link(n: NotificationView): string[] {
    return links.remark(n.project.slug, n.remark.roundNumber, n.remark.number);
  }

  protected headline(n: NotificationView): string {
    return notifyHeadline(n.event);
  }

  protected remarkLine(n: NotificationView): string {
    return NOTIFY.remark(n.remark.number, n.remark.title, n.remark.roundNumber);
  }

  /** «Дана · руководитель приёмки»; действие системы — «RemarkRound». */
  protected who(n: NotificationView): string {
    if (!n.by) return NOTIFY.system;
    return n.by.role ? `${n.by.name} · ${ROLE_SHORT[n.by.role]}` : n.by.name;
  }

  protected tone(n: NotificationView): string {
    return n.by?.role ? TONE_BY_ROLE[n.by.role] : 'accent';
  }

  protected initial(n: NotificationView): string {
    return (n.by?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  }

  /** Статус читает тот, кто смотрит: «Ждёт вашего решения» — только адресату решения. */
  protected readerRole(n: NotificationView): Role | null {
    return this.session.roleIn(n.project.id);
  }

  protected ago(iso: string): string {
    return relTimeRu(iso, this.now());
  }

  protected fullTime(iso: string): string {
    return dateTimeRu(iso);
  }

  protected date(iso: string): string {
    return dayMonthRu(iso);
  }

  protected async accept(inv: InboxInvitation): Promise<void> {
    if (this.busy()) return;
    this.busy.set(`accept:${inv.id}`);
    this.message.set(null);
    try {
      const me = await this.api.acceptInboxInvitation(inv.id);
      this.session.patch({ user: me.user, memberships: me.memberships });
      this.inbox.remove(inv.id);
      const joined = me.memberships.find((m) => m.projectId === inv.projectId) ?? me.memberships[me.memberships.length - 1];
      this.close(false);
      if (joined) {
        this.session.selectProject(joined.projectId);
        await this.router.navigateByUrl(homeUrlFor(joined));
      }
    } catch (err) {
      this.fail(inv, err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async decline(inv: InboxInvitation): Promise<void> {
    if (this.busy()) return;
    this.busy.set(`decline:${inv.id}`);
    this.message.set(null);
    try {
      await this.api.declineInboxInvitation(inv.id);
      this.inbox.remove(inv.id);
    } catch (err) {
      this.fail(inv, err);
    } finally {
      this.busy.set(null);
    }
  }

  /** 404 — отозвали, 410 — истекло: убираем строку и коротко объясняем; прочее — общий текст ошибки. */
  private fail(inv: InboxInvitation, err: unknown): void {
    const status = errorStatus(err);
    if (status === 404 || status === 410) {
      this.inbox.remove(inv.id);
      this.message.set(this.inboxCopy.gone);
    } else {
      this.message.set(errorMessage(err));
    }
  }

  private panel(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.bp');
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLButtonElement>('.bell')?.focus();
  }
}
