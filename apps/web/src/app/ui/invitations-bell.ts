import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { INBOX, ROLE_SIDE } from '../core/copy';
import { errorMessage, errorStatus } from '../core/errors';
import { dayMonthRu } from '../core/format';
import { homeUrlFor } from '../core/guards';
import { InvitationsInboxService } from '../core/invitations-inbox.service';
import type { InboxInvitation } from '../core/models';
import { SessionService } from '../core/session.service';
import { Icon } from './icons';

/**
 * Колокольчик в шапке (ADR 013 «без почты»): приглашения на мой e-mail. Счётчик — на кнопке; панель якорится к ней,
 * на узком экране растягивается на ширину шапки. Esc и клик снаружи закрывают (как rr-menu).
 * «Принять» обновляет membership ровно как принятие по ссылке (join-page) и ведёт в проект; 404/410 — приглашения уже нет.
 */
@Component({
  selector: 'rr-invitations-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'rr-bell',
    '(document:click)': 'onDocClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <button
      type="button"
      class="bell"
      [class.bell--on]="inbox.count() > 0"
      [attr.aria-label]="copy.bell(inbox.count())"
      [attr.title]="copy.bell(inbox.count())"
      aria-haspopup="dialog"
      aria-controls="rr-bell-panel"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <rr-icon name="bell" [size]="18" />
      @if (inbox.count() > 0) {
        <span class="bell__badge num" aria-hidden="true">{{ inbox.count() > 9 ? '9+' : inbox.count() }}</span>
      }
    </button>
    @if (open()) {
      <div id="rr-bell-panel" class="bp" role="dialog" [attr.aria-label]="copy.title" tabindex="-1">
        <div class="eyebrow bp__title">{{ copy.title }}</div>
        @if (message(); as m) {
          <p class="meta bp__msg" role="status">{{ m }}</p>
        }
        @if (inbox.items().length) {
          <ul class="bp__list">
            @for (inv of inbox.items(); track inv.id) {
              <li class="bp__item">
                <span class="bp__text">{{ copy.item(inv.inviterName, inv.projectName) }}</span>
                <span class="meta">{{ roleSide[inv.role === 'admin' ? 'pm' : inv.role] }}@if (inv.expiresAt) { · {{ copy.expires(date(inv.expiresAt)) }}}</span>
                <span class="bp__actions">
                  <button type="button" class="btn btn--primary btn--sm" [class.btn--busy]="busy() === 'accept:' + inv.id" [disabled]="!!busy()" (click)="accept(inv)">{{ copy.accept }}</button>
                  <button type="button" class="btn btn--secondary btn--sm" [class.btn--busy]="busy() === 'decline:' + inv.id" [disabled]="!!busy()" (click)="decline(inv)">{{ copy.decline }}</button>
                </span>
              </li>
            }
          </ul>
        } @else {
          <p class="meta bp__empty">{{ copy.empty }}</p>
        }
      </div>
    }
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
    .bp {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 340px;
      max-width: calc(100vw - 24px);
      max-height: min(70vh, 520px);
      overflow-y: auto;
      padding: var(--sp-3);
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      z-index: var(--z-menu);
      background: var(--rr-surface-raised);
      border: 1px solid var(--rr-line);
      border-radius: var(--rr-r-xl);
      box-shadow: var(--rr-shadow-2);
      transform-origin: top right;
      animation: rr-menu-in 140ms var(--rr-ease-out);
    }
    .bp:focus {
      outline: none;
    }
    .bp__title {
      padding: 2px 4px;
    }
    .bp__msg,
    .bp__empty {
      margin: 0;
      padding: 4px;
    }
    .bp__list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
    }
    .bp__item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--sp-3) 4px;
      border-top: 1px solid var(--rr-line);
    }
    .bp__text {
      font-weight: var(--fw-medium);
      overflow-wrap: anywhere;
    }
    .bp__actions {
      display: flex;
      gap: var(--sp-2);
      margin-top: var(--sp-2);
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
      .bp__actions .btn {
        flex: 1 1 0;
      }
    }
  `,
})
export class InvitationsBell {
  protected readonly inbox = inject(InvitationsInboxService);
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly copy = INBOX;
  /** Как на странице /join: сторона, а не «что вы делаете» — admin показываем как руководителя приёмки. */
  protected readonly roleSide = ROLE_SIDE;
  protected readonly open = signal(false);
  /** `accept:<id>` / `decline:<id>` — пока идёт запрос, остальные кнопки ждут. */
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    this.message.set(null);
    this.open.set(true);
    void this.inbox.refresh();
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.bp')?.focus(), { injector: this.injector });
  }

  protected onDocClick(e: Event): void {
    // Кнопка внутри панели могла исчезнуть из DOM после клика (принято, отклонено) — такой клик не «снаружи»
    const target = e.target as Node;
    if (this.open() && target.isConnected && !this.host.nativeElement.contains(target)) this.close(false);
  }

  protected onEscape(): void {
    if (this.open()) this.close(true);
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

  protected date(iso: string): string {
    return dayMonthRu(iso);
  }

  /** 404 — отозвали, 410 — истекло: убираем строку и коротко объясняем; прочее — общий текст ошибки. */
  private fail(inv: InboxInvitation, err: unknown): void {
    const status = errorStatus(err);
    if (status === 404 || status === 410) {
      this.inbox.remove(inv.id);
      this.message.set(this.copy.gone);
    } else {
      this.message.set(errorMessage(err));
    }
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLButtonElement>('.bell')?.focus();
  }
}
