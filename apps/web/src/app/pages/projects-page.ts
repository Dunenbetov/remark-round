import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccountService } from '../core/account.service';
import { ApiService } from '../core/api.service';
import { ERROR, PROJECTS, ROLE_SHORT } from '../core/copy';
import { errorMessage } from '../core/errors';
import { homeUrlFor } from '../core/guards';
import type { Membership } from '../core/models';
import { SessionService } from '../core/session.service';
import { links, toUrl } from '../core/links';
import { AppBar } from '../ui/app-bar';
import { BrandMark } from '../ui/brand-mark';
import { Sheet } from '../ui/sheet';

/** Пока человек ждёт, страница сама спрашивает /auth/me: проект появится без перелогина. */
const POLL_MS = 25_000;

/**
 * Проекты (ADR 005, ADR 006). Без membership — лист ожидания: участника добавит руководитель приёмки по ссылке,
 * а тот, кому администратор выдал право, создаёт проект прямо здесь. С проектами — список «Ваши проекты» и та же форма.
 */
@Component({
  selector: 'rr-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, BrandMark, Sheet],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body pr-body">
        @if (!hasProjects()) {
          <rr-sheet>
            <rr-brand-mark [size]="40" />
            @if (canCreate()) {
              <h1 class="pr__title">{{ copy.createTitle }}</h1>
              <p class="pr__hint">{{ copy.createHint }}</p>
              <form class="pr__form" (submit)="create($event)" novalidate>
                <label class="field">
                  <span class="field__label field__label--soft">{{ copy.nameLabel }}</span>
                  <input class="input" type="text" name="name" [value]="name()" (input)="name.set(value($event))" [attr.aria-invalid]="error() ? 'true' : null" />
                </label>
                @if (error(); as err) {
                  <div class="pr__error" role="alert">{{ err }}</div>
                }
                <button type="submit" class="btn btn--primary btn--lg" [class.btn--busy]="busy()" [disabled]="busy() || !name().trim()">{{ copy.create }}</button>
              </form>
            } @else {
              <h1 class="pr__title">{{ copy.waitingTitle }}</h1>
              <p class="pr__hint">{{ copy.waitingHint(email()) }}</p>
              <button type="button" class="btn btn--secondary" [class.btn--busy]="checking()" [disabled]="checking()" (click)="check()">{{ copy.refresh }}</button>
            }
          </rr-sheet>
        } @else {
          <div class="pr__list">
            <h1 class="pr__h">{{ copy.title }}</h1>
            <div class="paper tbl-wrap">
              <table class="tbl">
                <tbody>
                  @for (m of memberships(); track m.projectId) {
                    <tr class="tbl__row">
                      <td class="pr__name">{{ m.projectName }}</td>
                      <td class="meta">{{ roleShort[m.role] }}</td>
                      <td class="pr__go"><button type="button" class="btn btn--secondary btn--sm" (click)="open(m)">{{ copy.open }}</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (canCreate()) {
              <form class="paper pr__create" (submit)="create($event)" novalidate>
                <h2 class="pr__title pr__title--sm">{{ copy.createTitle }}</h2>
                <label class="field">
                  <span class="field__label field__label--soft">{{ copy.nameLabel }}</span>
                  <input class="input" type="text" name="name" [value]="name()" (input)="name.set(value($event))" />
                </label>
                @if (error(); as err) {
                  <div class="pr__error" role="alert">{{ err }}</div>
                }
                <button type="submit" class="btn btn--primary" [class.btn--busy]="busy()" [disabled]="busy() || !name().trim()">{{ copy.create }}</button>
              </form>
            }
          </div>
        }
      </main>
    </div>
  `,
  styles: `
    .pr-body {
      align-items: center;
      justify-content: center;
      padding-bottom: var(--sp-12);
    }
    .pr__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .pr__title--sm {
      font-size: var(--fs-18);
      line-height: var(--lh-18);
    }
    .pr__hint {
      margin: 0;
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      color: var(--rr-ink-2);
      max-width: 42ch;
    }
    .pr__form,
    .pr__create {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      text-align: left;
    }
    .pr__create {
      padding: var(--sp-6);
    }
    .pr__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .pr__list {
      width: min(720px, 100%);
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
      margin-inline: auto;
    }
    .pr__h {
      margin: 0;
      font-size: var(--fs-28);
      line-height: var(--lh-28);
      font-weight: var(--fw-bold);
      letter-spacing: -0.01em;
    }
    .pr__name {
      font-weight: var(--fw-medium);
    }
    .pr__go {
      text-align: right;
    }
  `,
})
export class ProjectsPage {
  private readonly session = inject(SessionService);
  private readonly account = inject(AccountService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly copy = PROJECTS;
  protected readonly roleShort = ROLE_SHORT;
  protected readonly memberships = this.session.memberships;
  protected readonly hasProjects = computed(() => this.memberships().length > 0);
  protected readonly canCreate = this.session.canCreateProjects;
  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly checking = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    const timer = setInterval(() => {
      if (!this.hasProjects()) void this.check();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.check();
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** /auth/me: появился проект — сразу в него (первый заход после приглашения). */
  protected async check(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    const had = this.hasProjects();
    try {
      await this.account.refresh();
    } finally {
      this.checking.set(false);
    }
    const first = this.memberships()[0];
    if (!had && first) await this.router.navigateByUrl(homeUrlFor(first));
  }

  protected open(m: Membership): void {
    this.session.selectProject(m.projectId);
    void this.router.navigateByUrl(homeUrlFor(m));
  }

  protected async create(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy() || !this.name().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const project = await this.api.createProject(this.name().trim());
      await this.account.refresh();
      this.session.selectProject(project.id);
      this.name.set('');
      await this.router.navigateByUrl(toUrl(links.project(project.slug)));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
