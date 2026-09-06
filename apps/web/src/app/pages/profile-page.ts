import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { ERROR, PROFILE, REGISTER, ROLE_SIDE, SIDES } from '../core/copy';
import type { Side } from '../core/models';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { SegmentItem, Segmented } from '../ui/segmented';
import { Sheet } from '../ui/sheet';

/** Профиль: имя, сторона (подсказка), смена пароля. После смены пароля другие устройства выйдут сами. */
@Component({
  selector: 'rr-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, Sheet, Segmented],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body pf-body">
        <rr-sheet align="start">
          <h1 class="pf__title">{{ copy.title }}</h1>
          <form class="pf__form" (submit)="saveProfile($event)" novalidate>
            <label class="field">
              <span class="field__label field__label--soft">{{ copy.name }}</span>
              <input class="input" type="text" name="name" autocomplete="name" [value]="name()" (input)="name.set(value($event))" />
            </label>
            <div class="field">
              <span class="field__label field__label--soft">{{ copy.who }}</span>
              <rr-segmented [items]="sideItems" [selected]="side()" [label]="copy.who" (pick)="pickSide($event)" />
              <span class="meta">{{ copy.whoHint }}</span>
            </div>
            <div class="pf__row">
              <button type="submit" class="btn btn--primary" [class.btn--busy]="saving()" [disabled]="saving() || !name().trim()">{{ copy.save }}</button>
              @if (savedNote()) {
                <span class="meta" role="status">{{ copy.saved }}</span>
              }
            </div>
            @if (profileError(); as err) {
              <div class="pf__error" role="alert">{{ err }}</div>
            }
          </form>

          <form class="pf__form pf__form--pass" (submit)="changePassword($event)" novalidate>
            <h2 class="pf__title pf__title--sm">{{ copy.passwordTitle }}</h2>
            <label class="field">
              <span class="field__label field__label--soft">{{ copy.current }}</span>
              <input class="input" type="password" name="current" autocomplete="current-password" [value]="current()" (input)="current.set(value($event))" />
            </label>
            <label class="field">
              <span class="field__label field__label--soft">{{ copy.next }}</span>
              <input class="input" type="password" name="next" autocomplete="new-password" [value]="next()" (input)="next.set(value($event))" />
              <span class="meta">{{ register.passwordHint }}</span>
            </label>
            <label class="field">
              <span class="field__label field__label--soft">{{ copy.repeat }}</span>
              <input class="input" type="password" name="repeat" autocomplete="new-password" [value]="repeat()" (input)="repeat.set(value($event))" />
            </label>
            <div class="pf__row">
              <button type="submit" class="btn btn--secondary" [class.btn--busy]="changing()" [disabled]="changing() || !canChange()">{{ copy.change }}</button>
            </div>
            @if (passwordError(); as err) {
              <div class="pf__error" role="alert">{{ err }}</div>
            }
            @if (changedNote()) {
              <div class="meta" role="status">{{ copy.changed }}</div>
            }
          </form>
        </rr-sheet>
      </main>
    </div>
  `,
  styles: `
    .pf-body {
      align-items: center;
      justify-content: center;
      padding-bottom: var(--sp-12);
    }
    .pf__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .pf__title--sm {
      font-size: var(--fs-18);
      line-height: var(--lh-18);
    }
    .pf__form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .pf__form--pass {
      margin-top: var(--sp-4);
      padding-top: var(--sp-6);
      border-top: 1px solid var(--rr-line);
    }
    .pf__row {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
    }
    .pf__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
  `,
})
export class ProfilePage {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  protected readonly copy = PROFILE;
  protected readonly register = REGISTER;
  protected readonly sideItems: SegmentItem[] = SIDES.map((s) => ({ id: s, label: ROLE_SIDE[s] }));
  protected readonly name = signal(this.session.user()?.name ?? '');
  protected readonly side = signal<Side>(this.sideOf(this.session.preferredRole()));
  protected readonly saving = signal(false);
  protected readonly savedNote = signal(false);
  protected readonly profileError = signal<string | null>(null);
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly repeat = signal('');
  protected readonly changing = signal(false);
  protected readonly changedNote = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly canChange = computed(() => this.current().length > 0 && this.next().length >= 8 && this.repeat().length > 0);

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  private sideOf(role: string | null): Side {
    return role === 'pm' || role === 'developer' || role === 'business' ? role : 'business';
  }

  protected pickSide(id: string): void {
    this.side.set(this.sideOf(id));
  }

  protected async saveProfile(e: Event): Promise<void> {
    e.preventDefault();
    if (this.saving()) return;
    this.saving.set(true);
    this.profileError.set(null);
    this.savedNote.set(false);
    try {
      const user = await this.api.updateProfile({ name: this.name().trim(), preferredRole: this.side() });
      this.session.patch({ user });
      this.savedNote.set(true);
    } catch {
      this.profileError.set(ERROR.request);
    } finally {
      this.saving.set(false);
    }
  }

  protected async changePassword(e: Event): Promise<void> {
    e.preventDefault();
    if (this.changing() || !this.canChange()) return;
    this.passwordError.set(null);
    this.changedNote.set(false);
    if (this.next() !== this.repeat()) {
      this.passwordError.set(this.copy.mismatch);
      return;
    }
    this.changing.set(true);
    try {
      const { accessToken } = await this.api.changePassword({ current: this.current(), next: this.next() });
      // Новый токен — сессия живёт дальше; WsService переподключится с ним сам
      this.session.patch({ accessToken });
      this.current.set('');
      this.next.set('');
      this.repeat.set('');
      this.changedNote.set(true);
    } catch (err) {
      this.passwordError.set(err instanceof HttpErrorResponse && err.status === 422 ? this.copy.wrongCurrent : ERROR.request);
    } finally {
      this.changing.set(false);
    }
  }
}
