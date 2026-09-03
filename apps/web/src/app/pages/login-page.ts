import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { APP_NAME, LOGIN, LOGIN_EXTRA, TAGLINE } from '../core/copy';
import { homeUrl } from '../core/guards';
import { SessionService } from '../core/session.service';

const DEMO_EMAILS = ['dana@remarkround.dev', 'aigerim@remarkround.dev', 'timur@remarkround.dev'];

/** Вход: слово RemarkRound, одна строка, e-mail и пароль, «Войти». Без иллюстраций и маркетинга. */
@Component({
  selector: 'rr-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main" class="login">
      <form class="login__box" (submit)="submit($event)" novalidate>
        <div class="login__brand">
          <h1 class="serif login__name">{{ appName }}</h1>
          <p class="login__tagline">{{ tagline }}</p>
        </div>
        <div class="login__fields">
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
          <button type="submit" class="btn btn--primary login__submit" [class.btn--busy]="busy()" [disabled]="busy()">{{ copy.submit }}</button>
        </div>
        <div class="login__demo">
          <span class="meta">{{ copy.demoHint }}</span>
          <div class="login__chips">
            @for (e of demoEmails; track e) {
              <button type="button" class="chip login__chip" [class.chip--on]="email() === e" (click)="pick(e)">{{ e }}</button>
            }
          </div>
          <span class="meta">{{ demoPassword }}</span>
        </div>
      </form>
    </main>
  `,
  styles: `
    .login {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sp-6);
    }
    .login__box {
      width: 380px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--sp-7);
    }
    .login__brand {
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .login__name {
      margin: 0;
      font-size: 40px;
      line-height: 48px;
      letter-spacing: -0.01em;
    }
    .login__tagline {
      margin: 0;
      color: var(--rr-ink-2);
    }
    .login__fields {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
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
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-2);
      text-align: center;
    }
    .login__chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
    }
    .login__chip {
      height: 28px;
      padding: 0 10px;
      font-size: var(--fs-13);
    }
  `,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly appName = APP_NAME;
  protected readonly tagline = TAGLINE;
  protected readonly copy = LOGIN;
  protected readonly demoEmails = DEMO_EMAILS;
  protected readonly demoPassword = LOGIN_EXTRA.demoPassword;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);

  constructor() {
    if (this.session.isLoggedIn()) void this.router.navigateByUrl(homeUrl(this.session));
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[name=email]')?.focus());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
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
      this.session.set(session);
      await this.router.navigateByUrl(homeUrl(this.session));
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
