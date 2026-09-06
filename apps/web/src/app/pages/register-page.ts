import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { ApiService } from '../core/api.service';
import { APP_NAME, ERROR, LOGIN, REGISTER, ROLE_SIDE, SIDES, SIDE_DOES } from '../core/copy';
import { homeUrl } from '../core/guards';
import type { InvitationPeek, Side } from '../core/models';
import { SessionService } from '../core/session.service';
import { BrandMark } from '../ui/brand-mark';

const TONE_BY_SIDE: Record<Side, 'accent' | 'wait' | 'work'> = { pm: 'accent', business: 'wait', developer: 'work' };

/**
 * Регистрация (ADR 005): слева — продукт и три стороны (карточки выбирают «Кто вы»), справа — лист формы.
 * По ссылке приглашения (?invite=) сверху карточка «Вас пригласили…» и e-mail предзаполнен.
 * После регистрации: есть проект — в него, нет — страница ожидания.
 */
@Component({
  selector: 'rr-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, RouterLink],
  template: `
    <main id="main" class="reg">
      <div class="reg__in">
        <section class="reg__intro">
          <div class="reg__brand rise" style="--i: 0">
            <rr-brand-mark [size]="40" />
            <span class="serif reg__name">{{ appName }}</span>
          </div>
          <p class="reg__lead rise" style="--i: 1">
            @for (line of copy.lead; track line) {
              <span class="reg__lead-line">{{ line }}</span>
            }
          </p>
          <div class="reg__sides rise" style="--i: 2" role="radiogroup" [attr.aria-label]="copy.who">
            <div class="eyebrow">{{ copy.who }}</div>
            @for (s of sides; track s) {
              <button
                type="button"
                role="radio"
                class="side paper paper--lift"
                [class.side--on]="side() === s"
                [attr.aria-checked]="side() === s"
                [style.--side-tone]="ring(s)"
                (click)="side.set(s)"
              >
                <span class="avatar" [class]="'avatar avatar--' + tone(s)">{{ roleSide[s].charAt(0) }}</span>
                <span class="side__text">
                  <span class="side__name">{{ roleSide[s] }}</span>
                  <span class="side__does">{{ sideDoes[s] }}</span>
                </span>
                <span class="side__check" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>
                </span>
              </button>
            }
          </div>
        </section>

        <form class="paper reg__box rise" style="--i: 1" [class.is-shake]="shake()" (animationend)="shake.set(false)" (submit)="submit($event)" novalidate>
          <h1 class="reg__title">{{ copy.pageTitle }}</h1>
          @if (invite(); as inv) {
            <p class="reg__invite" role="status">
              {{ copy.invited(inv.projectName, roleSide[sideOf(inv.role)]) }}
              <span class="meta">{{ copy.invitedBy(inv.inviterName) }}</span>
            </p>
          } @else if (inviteGone()) {
            <p class="reg__invite reg__invite--gone" role="status">{{ copy.inviteGone }}</p>
          }
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.name }}</span>
            <input class="input" type="text" name="name" autocomplete="name" [value]="name()" (input)="name.set(value($event))" [attr.aria-invalid]="error() ? 'true' : null" />
          </label>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.email }}</span>
            <input class="input" type="email" name="email" autocomplete="email" inputmode="email" [value]="email()" (input)="email.set(value($event))" [attr.aria-invalid]="error() ? 'true' : null" />
          </label>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.password }}</span>
            <span class="reg__pass">
              <input
                class="input reg__pass-input"
                [type]="showPassword() ? 'text' : 'password'"
                name="password"
                autocomplete="new-password"
                [value]="password()"
                (input)="password.set(value($event))"
                [attr.aria-invalid]="error() ? 'true' : null"
              />
              <button type="button" class="reg__eye" [attr.aria-label]="showPassword() ? login.hidePassword : login.showPassword" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())">
                @if (showPassword()) {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4 10 7-.4 1.2-1.2 2.5-2.3 3.6M6.2 6.2C4.2 7.6 2.7 9.5 2 12c1 3 5 7 10 7 1.6 0 3.1-.4 4.4-1" /></svg>
                } @else {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7S3 15 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                }
              </button>
            </span>
            <span class="meta">{{ copy.passwordHint }}</span>
          </label>
          <p class="reg__side-line meta">{{ copy.who }}: <strong>{{ roleSide[side()] }}</strong></p>
          @if (error(); as err) {
            <div class="reg__error" role="alert">{{ err }}</div>
          }
          <button type="submit" class="btn btn--primary btn--lg" [class.btn--busy]="busy()" [disabled]="busy()">{{ copy.submit }}</button>
          <p class="meta reg__switch">{{ copy.haveAccount }} <a class="link" [routerLink]="['/login']" [queryParams]="loginParams()">{{ copy.toLogin }}</a></p>
        </form>
      </div>
    </main>
  `,
  styles: `
    .reg {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--sp-8) var(--sp-6);
    }
    .reg__in {
      width: min(1120px, 100%);
      display: grid;
      grid-template-columns: 7fr 5fr;
      gap: var(--sp-12);
      align-items: center;
    }
    .reg__intro {
      display: flex;
      flex-direction: column;
      gap: var(--sp-7);
      min-width: 0;
    }
    .reg__brand {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      color: var(--rr-ink);
    }
    .reg__name {
      font-size: var(--rr-fs-40);
      line-height: var(--rr-lh-40);
      letter-spacing: -0.015em;
    }
    .reg__lead {
      margin: 0;
      display: flex;
      flex-direction: column;
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      color: var(--rr-ink-2);
      max-width: 34ch;
    }
    .reg__lead-line:last-child {
      color: var(--rr-ink);
      font-weight: var(--fw-semibold);
    }
    .reg__sides {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .reg__sides .eyebrow {
      margin-bottom: var(--sp-1);
    }
    .side {
      display: grid;
      grid-template-columns: 32px 1fr 16px;
      align-items: center;
      gap: var(--sp-4);
      min-height: 64px;
      padding: 0 var(--sp-5);
      text-align: left;
      cursor: pointer;
      color: var(--rr-ink);
    }
    .side .avatar {
      cursor: pointer;
      box-shadow: none;
    }
    .side--on {
      box-shadow: 0 0 0 2px var(--side-tone), var(--rr-shadow-1);
      border-color: transparent;
    }
    .side__text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .side__name {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .side__does {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-3);
    }
    .side__check {
      display: inline-flex;
      color: var(--side-tone);
      transform: scale(0);
      transition: transform var(--dur) var(--rr-ease-spring);
    }
    .side--on .side__check {
      transform: scale(1);
    }
    .reg__box {
      width: 400px;
      max-width: 100%;
      justify-self: end;
      padding: var(--sp-7);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .reg__box.is-shake {
      animation: rr-shake 240ms var(--rr-ease-in-out);
    }
    .reg__title {
      margin: 0 0 var(--sp-1);
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
    }
    .reg__invite {
      margin: 0;
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--rr-r-sm);
      background: var(--rr-surface-2);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .reg__invite--gone {
      color: var(--rr-ink-2);
    }
    .reg__pass {
      position: relative;
      display: block;
    }
    .reg__pass-input {
      padding-right: 44px;
    }
    .reg__eye {
      position: absolute;
      right: 4px;
      top: 4px;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: var(--rr-r-sm);
      background: transparent;
      color: var(--rr-ink-2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .reg__eye:hover {
      background: var(--rr-surface-2);
      color: var(--rr-ink);
    }
    .reg__side-line {
      margin: 0;
    }
    .reg__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .reg__switch {
      margin: 0;
      text-align: center;
    }
    @media (max-width: 900px) {
      .reg {
        padding: var(--sp-6) var(--sp-4);
        align-items: start;
      }
      .reg__in {
        grid-template-columns: 1fr;
        gap: var(--sp-7);
      }
      .reg__box {
        order: -1;
        justify-self: stretch;
        width: 100%;
      }
    }
  `,
})
export class RegisterPage {
  private readonly session = inject(SessionService);
  private readonly account = inject(AccountService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly appName = APP_NAME;
  protected readonly copy = REGISTER;
  protected readonly login = LOGIN;
  protected readonly roleSide = ROLE_SIDE;
  protected readonly sideDoes = SIDE_DOES;
  protected readonly sides = SIDES;
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly side = signal<Side>('business');
  protected readonly showPassword = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly shake = signal(false);
  protected readonly invite = signal<InvitationPeek | null>(null);
  protected readonly inviteGone = signal(false);
  private readonly inviteToken = signal<string | null>(null);
  /** «Войти» с приглашением ведёт через /join, чтобы вошедший принял ссылку. */
  protected readonly loginParams = computed(() => (this.inviteToken() ? { next: `/join/${this.inviteToken()}` } : {}));

  constructor() {
    if (this.session.isLoggedIn()) void this.router.navigateByUrl(homeUrl(this.session));
    const token = this.route.snapshot.queryParamMap.get('invite');
    if (token) {
      this.inviteToken.set(token);
      void this.api
        .invitation(token)
        .then((inv) => {
          this.invite.set(inv);
          this.email.set(inv.email);
          this.side.set(this.sideOf(inv.role));
        })
        .catch(() => this.inviteGone.set(true));
    }
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[name=name]')?.focus());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected tone(side: Side): 'accent' | 'wait' | 'work' {
    return TONE_BY_SIDE[side];
  }

  protected ring(side: Side): string {
    switch (TONE_BY_SIDE[side]) {
      case 'wait':
        return 'var(--rr-accent-2)';
      case 'work':
        return 'var(--rr-work-dot)';
      default:
        return 'var(--rr-accent)';
    }
  }

  /** admin в приглашении — редкость: показываем как руководителя приёмки, сторону всё равно ставит PM. */
  protected sideOf(role: string): Side {
    return role === 'pm' || role === 'developer' || role === 'business' ? role : 'pm';
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.busy.set(true);
    this.error.set(null);
    try {
      const session = await this.api.register({
        name: this.name().trim(),
        email: this.email().trim(),
        password: this.password(),
        preferredRole: this.side(),
        inviteToken: this.inviteToken() ?? undefined,
      });
      this.account.applyLogin(session);
      await this.router.navigateByUrl(homeUrl(this.session));
    } catch (err) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      this.error.set(status === 409 ? this.copy.taken : status === 422 ? this.copy.invalid : ERROR.request);
      this.shake.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
