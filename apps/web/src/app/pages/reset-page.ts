import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { APP_NAME, ERROR, LOGIN, RESET } from '../core/copy';
import { errorMessage, errorStatus } from '../core/errors';
import { BrandMark } from '../ui/brand-mark';

/**
 * Новый пароль по ссылке /reset/<token>, которую прислал администратор (ADR 012, ADR 013 — писем нет). После 204 — на вход
 * с подсказкой «пароль изменён»: сессию сервер по ссылке не выдаёт. Мёртвая или использованная ссылка (404/410) — попросить
 * у администратора новую.
 */
@Component({
  selector: 'rr-reset-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, RouterLink],
  template: `
    <main id="main" class="rp">
      <form class="paper rp__box rise" (submit)="submit($event)" novalidate>
        <div class="rp__brand">
          <rr-brand-mark [size]="40" />
          <span class="serif rp__name">{{ appName }}</span>
        </div>
        <h1 class="rp__title">{{ copy.pageTitle }}</h1>
        @if (dead()) {
          <p class="rp__note" role="alert">{{ copy.dead }}</p>
        } @else {
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.password }}</span>
            <span class="rp__pass">
              <input
                class="input rp__pass-input"
                [type]="showPassword() ? 'text' : 'password'"
                name="password"
                autocomplete="new-password"
                [value]="password()"
                (input)="password.set(value($event))"
                [attr.aria-invalid]="error() ? 'true' : null"
              />
              <button type="button" class="btn btn--secondary btn--sm" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())">{{ showPassword() ? login.hidePassword : login.showPassword }}</button>
            </span>
            <span class="meta">{{ copy.passwordHint }}</span>
          </label>
          @if (error(); as err) {
            <div class="rp__error" role="alert">{{ err }}</div>
          }
          <button type="submit" class="btn btn--primary btn--lg" [class.btn--busy]="busy()" [disabled]="busy()">{{ copy.submit }}</button>
        }
        <p class="meta rp__switch"><a class="link" routerLink="/login">{{ copy.toLogin }}</a></p>
      </form>
    </main>
  `,
  styles: `
    .rp {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--sp-8) var(--sp-4);
    }
    .rp__box {
      width: min(440px, 100%);
      padding: var(--sp-8) var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .rp__brand {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
    }
    .rp__name {
      font-size: var(--fs-18);
    }
    .rp__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
    }
    .rp__pass {
      display: flex;
      gap: var(--sp-2);
      align-items: center;
    }
    .rp__pass-input {
      flex: 1;
    }
    .rp__note {
      margin: 0;
    }
    .rp__error {
      color: var(--rr-danger-text);
      font-size: var(--fs-13);
    }
    .rp__switch {
      margin: 0;
    }
  `,
})
export class ResetPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly appName = APP_NAME;
  protected readonly copy = RESET;
  protected readonly login = LOGIN;
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dead = signal(false);
  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  constructor() {
    if (!this.token) this.dead.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[name=password]')?.focus());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy()) return;
    if (this.password().length < 8) {
      this.error.set(this.copy.invalid);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.resetPassword(this.token, this.password());
      await this.router.navigate(['/login'], { queryParams: { reset: 'ok' } });
    } catch (err) {
      const status = errorStatus(err);
      if (status === 404 || status === 410) this.dead.set(true);
      else this.error.set(status === 422 ? this.copy.invalid : errorMessage(err, ERROR.request));
    } finally {
      this.busy.set(false);
    }
  }
}
