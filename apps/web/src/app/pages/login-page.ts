import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { ApiService } from '../core/api.service';
import { APP_NAME, LOGIN, LOGIN_EXTRA, ROLE_TITLE } from '../core/copy';
import { homeUrl } from '../core/guards';
import type { Role } from '../core/models';
import { SessionService } from '../core/session.service';
import { BrandMark } from '../ui/brand-mark';

const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };

/**
 * Вход: слева — продукт и три роли демо за три секунды (лид + карточки ролей), справа — лист формы.
 * Карточка роли заполняет e-mail и пароль (демо-стенд), фокус уходит на «Войти».
 */
@Component({
  selector: 'rr-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, RouterLink],
  template: `
    <main id="main" class="login">
      <svg class="login__ring" width="560" height="560" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.12" stroke-linecap="round" aria-hidden="true">
        <path d="M14.8 3.5A9 9 0 1 0 20.5 9.2" />
      </svg>
      <div class="login__in">
        <section class="login__intro">
          <div class="login__brand rise" style="--i: 0">
            <rr-brand-mark [size]="40" />
            <h1 class="serif login__name">{{ appName }}</h1>
          </div>
          <p class="login__lead rise" style="--i: 1">
            @for (line of copy.lead; track line) {
              <span class="login__lead-line">{{ line }}</span>
            }
          </p>
          @if (demo()) {
          <div class="login__roles rise" style="--i: 2">
            <div class="eyebrow">{{ copy.tryAs }}</div>
            @for (r of copy.roles; track r.email; let i = $index) {
              <button
                type="button"
                class="role paper paper--lift"
                [class.role--on]="email() === r.email"
                [attr.aria-pressed]="email() === r.email"
                [style.--role-tone]="ring(r.role)"
                (click)="pick(r.email)"
              >
                <span class="avatar" [class]="'avatar avatar--' + tone(r.role)">{{ r.name.charAt(0) }}</span>
                <span class="role__text">
                  <span class="role__name">{{ r.name }}</span>
                  <span class="role__title">{{ roleTitle[r.role] }}</span>
                  <span class="role__does">{{ r.does }}</span>
                </span>
                <span class="role__mail meta">{{ r.email }}</span>
                <span class="role__check" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>
                </span>
              </button>
            }
          </div>
          }
          <ol class="login__steps rise" style="--i: 3" aria-label="Как это работает">
            @for (s of copy.steps; track s; let last = $last) {
              <li class="login__step">
                <span class="pill pill--muted">{{ s }}</span>
                @if (!last) {
                  <span class="login__arrow" aria-hidden="true">→</span>
                }
              </li>
            }
          </ol>
        </section>

        <form class="paper login__box rise" style="--i: 1" [class.is-shake]="shake()" (animationend)="shake.set(false)" (submit)="submit($event)" novalidate>
          <h2 class="login__title">{{ copy.pageTitle }}</h2>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.email }}</span>
            <input
              class="input"
              type="email"
              name="email"
              autocomplete="username"
              inputmode="email"
              [value]="email()"
              (input)="email.set(value($event))"
              [attr.aria-invalid]="error() ? 'true' : null"
            />
          </label>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.password }}</span>
            <span class="login__pass">
              <input
                class="input login__pass-input"
                [type]="showPassword() ? 'text' : 'password'"
                name="password"
                autocomplete="current-password"
                [value]="password()"
                (input)="password.set(value($event))"
                [attr.aria-invalid]="error() ? 'true' : null"
              />
              <button
                type="button"
                class="login__eye"
                [attr.aria-label]="showPassword() ? copy.hidePassword : copy.showPassword"
                [attr.aria-pressed]="showPassword()"
                (click)="showPassword.set(!showPassword())"
              >
                @if (showPassword()) {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4 10 7-.4 1.2-1.2 2.5-2.3 3.6M6.2 6.2C4.2 7.6 2.7 9.5 2 12c1 3 5 7 10 7 1.6 0 3.1-.4 4.4-1" /></svg>
                } @else {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7S3 15 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                }
              </button>
            </span>
          </label>
          @if (error()) {
            <div class="login__error" role="alert">{{ copy.unknown }}</div>
          }
          <button type="submit" class="btn btn--primary btn--lg login__submit" [class.btn--busy]="busy()" [disabled]="busy()">{{ copy.submit }}</button>
          @if (demo()) {
            <span class="meta login__demo">{{ demoPassword }}</span>
          }
          @if (registrationOpen() || registerParams()['invite']) {
            <p class="meta login__switch">{{ copy.noAccount }} <a class="link" routerLink="/register" [queryParams]="registerParams()">{{ copy.toRegister }}</a></p>
          } @else {
            <p class="meta login__switch">{{ copy.inviteOnly }}</p>
          }
        </form>
      </div>
    </main>
  `,
  styles: `
    .login {
      position: relative;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--sp-8) var(--sp-6);
      overflow: hidden;
    }
    .login__ring {
      position: absolute;
      left: -140px;
      bottom: -160px;
      color: var(--rr-ink);
      opacity: 0.06;
      pointer-events: none;
    }
    .login__in {
      position: relative;
      width: min(1120px, 100%);
      display: grid;
      grid-template-columns: 7fr 5fr;
      gap: var(--sp-12);
      align-items: center;
    }
    .login__intro {
      display: flex;
      flex-direction: column;
      gap: var(--sp-7);
      min-width: 0;
    }
    .login__brand {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      color: var(--rr-ink);
    }
    .login__name {
      margin: 0;
      font-size: var(--rr-fs-40);
      line-height: var(--rr-lh-40);
      letter-spacing: -0.015em;
    }
    .login__lead {
      margin: 0;
      display: flex;
      flex-direction: column;
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      color: var(--rr-ink-2);
      max-width: 34ch;
    }
    .login__lead-line:last-child {
      color: var(--rr-ink);
      font-weight: var(--fw-semibold);
    }
    .login__roles {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .login__roles .eyebrow {
      margin-bottom: var(--sp-1);
    }
    .role {
      position: relative;
      display: grid;
      grid-template-columns: 32px 1fr auto 16px;
      align-items: center;
      gap: var(--sp-4);
      min-height: 72px;
      padding: 0 var(--sp-5);
      text-align: left;
      cursor: pointer;
      color: var(--rr-ink);
    }
    .role .avatar {
      cursor: pointer;
      box-shadow: none;
    }
    .role--on {
      box-shadow: 0 0 0 2px var(--role-tone), var(--rr-shadow-1);
      border-color: transparent;
    }
    .role__text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .role__name {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .role__title {
      font-size: var(--fs-14);
      line-height: var(--lh-14);
      color: var(--rr-ink-2);
    }
    .role__does {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-3);
    }
    .role__mail {
      white-space: nowrap;
    }
    .role__check {
      display: inline-flex;
      color: var(--role-tone);
      transform: scale(0);
      transition: transform var(--dur) var(--rr-ease-spring);
    }
    .role--on .role__check {
      transform: scale(1);
    }
    .login__steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sp-2);
    }
    .login__step {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
    }
    .login__arrow {
      color: var(--rr-ink-3);
    }
    .login__box {
      width: 400px;
      max-width: 100%;
      justify-self: end;
      padding: var(--sp-7);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .login__box.is-shake {
      animation: rr-shake 240ms var(--rr-ease-in-out);
    }
    .login__title {
      margin: 0 0 var(--sp-1);
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
    }
    .login__pass {
      position: relative;
      display: block;
    }
    .login__pass-input {
      padding-right: 44px;
    }
    .login__eye {
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
    .login__eye:hover {
      background: var(--rr-surface-2);
      color: var(--rr-ink);
    }
    .login__submit {
      margin-top: var(--sp-1);
    }
    .login__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .login__demo {
      text-align: center;
    }
    .login__switch {
      margin: 0;
      text-align: center;
    }
    @media (max-width: 900px) {
      .login {
        padding: var(--sp-6) var(--sp-4);
        align-items: start;
      }
      .login__in {
        grid-template-columns: 1fr;
        gap: var(--sp-7);
      }
      .login__box {
        order: -1;
        justify-self: stretch;
        width: 100%;
      }
      .login__steps {
        display: none;
      }
      .role {
        grid-template-columns: 32px 1fr 16px;
      }
      .role__mail {
        display: none;
      }
    }
  `,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly account = inject(AccountService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly appName = APP_NAME;
  protected readonly copy = LOGIN;
  protected readonly roleTitle = ROLE_TITLE;
  protected readonly demoPassword = LOGIN_EXTRA.demoPassword;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly shake = signal(false);
  protected readonly showPassword = signal(false);
  /** Карточки демо-персон — только на демо-стенде (GET /auth/options); в проде их нет. */
  protected readonly demo = signal(false);
  /** invite_only (ADR 006): ссылку «Зарегистрироваться» показываем только пришедшим по приглашению. */
  protected readonly registrationOpen = signal(false);

  constructor() {
    if (this.session.isLoggedIn()) void this.router.navigateByUrl(this.afterLogin());
    void this.api
      .authOptions()
      .then((o) => {
        this.demo.set(o.demoLogins);
        this.registrationOpen.set(o.registration === 'open');
      })
      .catch(() => this.demo.set(false));
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[name=email]')?.focus());
  }

  /** ?next=/join/<token> — после входа принять приглашение; иначе домой. */
  private afterLogin(): string {
    const next = this.route.snapshot.queryParamMap.get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : homeUrl(this.session);
  }

  /** Регистрация по той же ссылке приглашения, если пришли через /join. */
  protected registerParams(): Record<string, string> {
    const next = this.route.snapshot.queryParamMap.get('next') ?? '';
    const token = next.startsWith('/join/') ? next.slice('/join/'.length) : '';
    return token ? { invite: token } : {};
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected tone(role: Role): 'accent' | 'wait' | 'work' {
    return TONE_BY_ROLE[role];
  }

  /** Кольцо выбранной карточки — тон роли (business — медь, закон меди п. а). */
  protected ring(role: Role): string {
    switch (TONE_BY_ROLE[role]) {
      case 'wait':
        return 'var(--rr-accent-2)';
      case 'work':
        return 'var(--rr-work-dot)';
      default:
        return 'var(--rr-accent)';
    }
  }

  protected pick(email: string): void {
    this.email.set(email);
    this.error.set(false);
    if (!this.password()) this.password.set('remarkround');
    this.host.nativeElement.querySelector<HTMLButtonElement>('button[type=submit]')?.focus();
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.busy.set(true);
    this.error.set(false);
    try {
      const session = await this.api.login(this.email(), this.password());
      this.account.applyLogin(session);
      await this.router.navigateByUrl(this.afterLogin());
    } catch {
      this.error.set(true);
      this.shake.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
