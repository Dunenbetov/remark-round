import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { APP_NAME, LOGIN, TAGLINE } from '../core/copy';
import { SessionService } from '../core/session.service';

/** Вход: слово RemarkRound, одна строка, e-mail и пароль, «Войти». Без иллюстраций и маркетинга. */
@Component({
  selector: 'rr-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <form class="login__box" (submit)="submit($event)" novalidate>
        <div class="login__brand">
          <div class="serif login__name">{{ appName }}</div>
          <div class="login__tagline">{{ tagline }}</div>
        </div>
        <div class="login__fields">
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.email }}</span>
            <input class="input" type="email" name="email" autocomplete="username" [value]="email()" (input)="email.set(value($event))" [class.input--danger]="error()" />
          </label>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.password }}</span>
            <input class="input" type="password" name="password" autocomplete="current-password" [value]="password()" (input)="password.set(value($event))" />
          </label>
          @if (error()) {
            <div class="login__error">{{ copy.unknown }}</div>
          }
          <button type="submit" class="btn btn--primary login__submit">{{ copy.submit }}</button>
        </div>
        <div class="meta login__demo">
          {{ copy.demoHint }}
          @for (u of session.users; track u.id) {
            <button type="button" class="login__demo-link" (click)="email.set(u.email)">{{ u.email }}</button>
          }
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
      padding: 24px;
    }
    .login__box {
      width: 360px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .login__brand {
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .login__name {
      font-size: 40px;
      line-height: 48px;
    }
    .login__tagline {
      color: var(--rr-ink-soft);
    }
    .login__fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .login__submit {
      margin-top: 4px;
    }
    .login__error {
      font-size: 13px;
      line-height: 18px;
      color: var(--rr-danger);
    }
    .login__demo {
      text-align: center;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px 10px;
    }
    .login__demo-link {
      border: 0;
      background: transparent;
      padding: 0;
      font-size: 13px;
      color: var(--rr-accent);
      cursor: pointer;
    }
    .login__demo-link:hover {
      text-decoration: underline;
    }
  `,
})
export class LoginPage {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly tagline = TAGLINE;
  protected readonly copy = LOGIN;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal(false);

  constructor() {
    if (this.session.isLoggedIn()) void this.router.navigateByUrl('/');
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected submit(e: Event): void {
    e.preventDefault();
    const user = this.session.login(this.email());
    if (!user) {
      this.error.set(true);
      return;
    }
    this.error.set(false);
    void this.router.navigateByUrl('/');
  }
}
