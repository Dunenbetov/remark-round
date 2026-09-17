import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { ApiService } from '../core/api.service';
import { ERROR, JOIN, ROLE_SIDE } from '../core/copy';
import { homeUrlFor } from '../core/guards';
import type { InvitationPeek, Side } from '../core/models';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { BrandMark } from '../ui/brand-mark';
import { Sheet } from '../ui/sheet';

/**
 * Ссылка приглашения /join/<token> (ADR 005): вошедший принимает кнопкой и попадает в проект,
 * остальных ведём на регистрацию с предзаполненным e-mail или на вход (с возвратом сюда).
 */
@Component({
  selector: 'rr-join-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, BrandMark, Sheet, RouterLink],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body jn-body">
        <rr-sheet>
          <rr-brand-mark [size]="40" [tone]="gone() ? 'danger' : 'default'" />
          <h1 class="jn__title">{{ copy.title }}</h1>
          @if (peek(); as inv) {
            <p class="jn__lead">{{ copy.lead(inv.projectName, roleSide[sideOf(inv.role)]) }}</p>
            <p class="meta">{{ copy.by(inv.inviterName) }}</p>
            @if (loggedIn()) {
              <p class="meta">{{ copy.signedAs(email()) }}</p>
              <button type="button" class="btn btn--primary btn--lg" [class.btn--busy]="busy()" [disabled]="busy()" (click)="accept()">{{ busy() ? copy.accepting : copy.accept }}</button>
            } @else {
              <div class="jn__actions">
                <a class="btn btn--primary btn--lg" [routerLink]="['/register']" [queryParams]="{ invite: token() }">{{ copy.register }}</a>
                <a class="btn btn--text" [routerLink]="['/login']" [queryParams]="{ next: '/join/' + token() }">{{ copy.login }}</a>
              </div>
            }
          } @else if (gone()) {
            <p class="jn__lead">{{ copy.gone }}</p>
            <a class="btn btn--secondary" routerLink="/">{{ loggedIn() ? toMy : copy.login }}</a>
          }
          @if (error(); as err) {
            <div class="jn__error" role="alert">{{ err }}</div>
          }
        </rr-sheet>
      </main>
    </div>
  `,
  styles: `
    .jn-body {
      align-items: center;
      justify-content: center;
      padding-bottom: var(--sp-12);
    }
    .jn__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .jn__lead {
      margin: 0;
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      color: var(--rr-ink-2);
      max-width: 40ch;
    }
    .jn__actions {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      align-items: center;
      margin-top: var(--sp-2);
    }
    .jn__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
  `,
})
export class JoinPage {
  readonly token = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);

  protected readonly copy = JOIN;
  protected readonly roleSide = ROLE_SIDE;
  protected readonly toMy = 'К моим проектам';
  protected readonly peek = signal<InvitationPeek | null>(null);
  protected readonly gone = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loggedIn = this.session.isLoggedIn;
  protected readonly email = computed(() => this.session.user()?.email ?? '');

  constructor() {
    queueMicrotask(() =>
      this.api
        .invitation(this.token())
        .then((inv) => this.peek.set(inv))
        .catch(() => this.gone.set(true)),
    );
  }

  protected sideOf(role: string): Side {
    return role === 'pm' || role === 'developer' || role === 'business' ? role : 'pm';
  }

  protected async accept(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const me = await this.api.acceptInvitation(this.token());
      this.session.patch({ user: me.user, memberships: me.memberships });
      const joined = me.memberships.find((m) => m.projectName === this.peek()?.projectName) ?? me.memberships[me.memberships.length - 1];
      if (joined) {
        this.session.selectProject(joined.projectId);
        await this.router.navigateByUrl(homeUrlFor(joined));
      } else {
        await this.router.navigateByUrl(this.account.home());
      }
    } catch {
      this.gone.set(true);
      this.peek.set(null);
      this.error.set(ERROR.request);
    } finally {
      this.busy.set(false);
    }
  }
}
