import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { ERROR, PROFILE, REGISTER, ROLE_SHORT, ROLE_SIDE, SIDES } from '../core/copy';
import type { Side } from '../core/models';
import { SessionService } from '../core/session.service';
import { AppBar, TONE_BY_ROLE } from '../ui/app-bar';
import { PageHeader } from '../ui/page-header';
import { SegmentItem, Segmented } from '../ui/segmented';

/**
 * Профиль во всю ширину: полоса «кто я» (буква, имя, e-mail, проекты и роли) и под ней две равные карточки —
 * «Данные» (имя, сторона-подсказка) и «Пароль». Внутренние половины полосы стоят ровно над содержимым карточек.
 * После смены пароля другие устройства выйдут сами. Писем нет (ADR 013) — и переключателя писем тоже.
 */
@Component({
  selector: 'rr-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, Segmented],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header size="lg" [title]="copy.title" />

        @if (user(); as u) {
          <section class="paper pf-id rise" [style.--i]="0" [attr.aria-label]="u.name">
            <div class="pf-id__who">
              <span class="avatar pf-id__ava" [class]="'avatar--' + tone()" aria-hidden="true">{{ initial() }}</span>
              <div class="pf-id__text">
                <h2 class="pf-id__name">{{ u.name }}</h2>
                <span class="pf-id__email">{{ u.email }}</span>
              </div>
            </div>
            <div class="pf-id__projects">
              <span class="pf-id__label">{{ copy.projects }}</span>
              @if (memberships().length) {
                <ul class="pf-id__list">
                  @for (m of memberships(); track m.projectId) {
                    <li>
                      <span class="pf-id__project">{{ m.projectName }}</span>
                      <span class="pf-id__role">{{ roleShort[m.role] }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <span class="meta">{{ copy.noProjects }}</span>
              }
            </div>
          </section>
        }

        <div class="pf-grid">
          <form class="paper pf-card rise" [style.--i]="1" (submit)="saveProfile($event)" novalidate>
            <h2 class="pf-card__title">{{ copy.dataTitle }}</h2>
            <label class="field">
              <span class="field__label field__label--soft">{{ copy.name }}</span>
              <input class="input" type="text" name="name" autocomplete="name" [value]="name()" (input)="name.set(value($event))" />
            </label>
            <div class="field">
              <span class="field__label field__label--soft">{{ copy.who }}</span>
              <rr-segmented [items]="sideItems" [selected]="side()" [label]="copy.who" (pick)="pickSide($event)" />
              <span class="meta">{{ copy.whoHint }}</span>
            </div>
            @if (profileError(); as err) {
              <div class="pf__error" role="alert">{{ err }}</div>
            }
            <div class="pf__row">
              <button type="submit" class="btn btn--primary" [class.btn--busy]="saving()" [disabled]="saving() || !name().trim()">{{ copy.save }}</button>
              @if (savedNote()) {
                <span class="meta" role="status">{{ copy.saved }}</span>
              }
            </div>
          </form>

          <form class="paper pf-card rise" [style.--i]="2" (submit)="changePassword($event)" novalidate>
            <h2 class="pf-card__title">{{ copy.passwordTitle }}</h2>
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
            @if (passwordError(); as err) {
              <div class="pf__error" role="alert">{{ err }}</div>
            }
            <div class="pf__row">
              <button type="submit" class="btn btn--secondary" [class.btn--busy]="changing()" [disabled]="changing() || !canChange()">{{ copy.change }}</button>
              @if (changedNote()) {
                <span class="meta" role="status">{{ copy.changed }}</span>
              }
            </div>
          </form>
        </div>
      </main>
    </div>
  `,
  styles: `
    /* паддинг бумаги один на полосу и карточки — от него считается выравнивание половин полосы */
    :host {
      --pf-pad: var(--sp-6);
    }
    /* полоса «кто я»: те же две колонки, что у карточек; зазор шире на два паддинга, поэтому правая половина
       начинается ровно над содержимым карточки «Пароль» */
    .pf-id {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: calc(var(--sp-6) + 2 * var(--pf-pad));
      row-gap: var(--sp-5);
      align-items: center;
      padding: var(--pf-pad);
      margin-bottom: var(--sp-6);
    }
    .pf-id__who {
      display: flex;
      align-items: center;
      gap: var(--sp-5);
      min-width: 0;
    }
    .pf-id__ava {
      width: 72px;
      height: 72px;
      font-size: var(--fs-28);
      line-height: 1;
      cursor: default;
    }
    .pf-id__text {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
      min-width: 0;
    }
    .pf-id__name {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-id__email {
      color: var(--rr-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-id__projects {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      min-width: 0;
    }
    .pf-id__label {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
    }
    .pf-id__list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .pf-id__list li {
      display: flex;
      align-items: baseline;
      gap: var(--sp-2);
      min-width: 0;
    }
    .pf-id__project {
      font-weight: var(--fw-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-id__role {
      flex: none;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
    }
    .pf-id__role::before {
      content: '· ';
      color: var(--rr-ink-3);
    }
    .pf-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sp-6);
      align-items: stretch;
    }
    .pf-card {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      padding: var(--pf-pad);
      min-width: 0;
    }
    .pf-card__title {
      margin: 0 0 var(--sp-1);
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      font-weight: var(--fw-semibold);
    }
    /* кнопки обеих карточек на одной линии — у нижнего края */
    .pf__row {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      margin-top: auto;
      padding-top: var(--sp-2);
    }
    .pf__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    @media (max-width: 900px) {
      :host {
        --pf-pad: var(--sp-5);
      }
      .pf-id,
      .pf-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--sp-4);
      }
      .pf-id {
        margin-bottom: var(--sp-4);
      }
      .pf-id__ava {
        width: 56px;
        height: 56px;
        font-size: var(--fs-22);
      }
    }
  `,
})
export class ProfilePage {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  protected readonly copy = PROFILE;
  protected readonly register = REGISTER;
  protected readonly roleShort = ROLE_SHORT;
  protected readonly sideItems: SegmentItem[] = SIDES.map((s) => ({ id: s, label: ROLE_SIDE[s] }));
  protected readonly user = this.session.user;
  protected readonly memberships = this.session.memberships;
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
  protected readonly initial = computed(() => (this.user()?.name ?? '?').charAt(0).toUpperCase());
  /** Тон буквы — по сохранённой стороне, как у аватара в шапке по роли в проекте. */
  protected readonly tone = computed(() => TONE_BY_ROLE[this.sideOf(this.session.preferredRole())]);

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
