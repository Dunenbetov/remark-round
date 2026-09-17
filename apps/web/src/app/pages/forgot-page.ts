import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { APP_NAME, ERROR, FORGOT } from '../core/copy';
import { errorMessage } from '../core/errors';
import { BrandMark } from '../ui/brand-mark';

/**
 * «Забыли пароль» (ADR 012): один e-mail, одна кнопка. Ответ сервера всегда 204, поэтому и текст один — «если адрес есть,
 * письмо в пути». Без SMTP (GET /auth/options → mail: false) формы нет: помочь сможет только администратор.
 */
@Component({
  selector: 'rr-forgot-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, RouterLink],
  template: `
    <main id="main" class="fp">
      <form class="paper fp__box rise" (submit)="submit($event)" novalidate>
        <div class="fp__brand">
          <rr-brand-mark [size]="40" />
          <span class="serif fp__name">{{ appName }}</span>
        </div>
        <h1 class="fp__title">{{ copy.pageTitle }}</h1>
        @if (mailOn() === false) {
          <p class="fp__note" role="status">{{ copy.noMail }}</p>
        } @else if (sent(); as to) {
          <p class="fp__note" role="status">{{ copy.sent(to) }}</p>
        } @else {
          <p class="meta">{{ copy.lead }}</p>
          <label class="field">
            <span class="field__label field__label--soft">{{ copy.email }}</span>
            <input class="input" type="email" name="email" autocomplete="email" inputmode="email" [value]="email()" (input)="email.set(value($event))" [attr.aria-invalid]="error() ? 'true' : null" />
          </label>
          @if (error(); as err) {
            <div class="fp__error" role="alert">{{ err }}</div>
          }
          <button type="submit" class="btn btn--primary btn--lg" [class.btn--busy]="busy()" [disabled]="busy() || !email().trim()">{{ copy.submit }}</button>
        }
        <p class="meta fp__switch"><a class="link" routerLink="/login">{{ copy.toLogin }}</a></p>
      </form>
    </main>
  `,
  styles: `
    .fp {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--sp-8) var(--sp-4);
    }
    .fp__box {
      width: min(440px, 100%);
      padding: var(--sp-8) var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .fp__brand {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
    }
    .fp__name {
      font-size: var(--fs-18);
    }
    .fp__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
    }
    .fp__note {
      margin: 0;
    }
    .fp__error {
      color: var(--rr-danger-text);
      font-size: var(--fs-13);
    }
    .fp__switch {
      margin: 0;
    }
  `,
})
export class ForgotPage {
  private readonly api = inject(ApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly appName = APP_NAME;
  protected readonly copy = FORGOT;
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** E-mail, на который «отправлено» (текст один и тот же — сервер не раскрывает адреса). */
  protected readonly sent = signal<string | null>(null);
  /** null — ещё не знаем; false — SMTP не настроен, формы не будет. */
  protected readonly mailOn = signal<boolean | null>(null);

  constructor() {
    void this.api
      .authOptions()
      .then((o) => this.mailOn.set(o.mail))
      .catch(() => this.mailOn.set(true));
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[name=email]')?.focus());
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    const email = this.email().trim();
    if (this.busy() || !email) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.forgotPassword(email);
      this.sent.set(email);
    } catch (err) {
      this.error.set(errorMessage(err, ERROR.request));
    } finally {
      this.busy.set(false);
    }
  }
}
