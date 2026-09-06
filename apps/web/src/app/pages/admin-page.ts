import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { ADMIN, ERROR, ROLE_SHORT } from '../core/copy';
import type { AdminProject, AdminUser } from '../core/models';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';

/**
 * Администрирование инстанса (ADR 006): люди и проекты поперёк тенантов для e-mail из ADMIN_EMAILS.
 * Три действия — выдать/снять право создавать проекты, отключить/включить человека, завершить его сессии.
 * Роли внутри проектов здесь не меняются: это дело руководителя приёмки на «Участниках».
 */
@Component({
  selector: 'rr-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, Skeleton],
  template: `
    <div class="page">
      <rr-app-bar [brandOnly]="true" />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="copy.title" [subtitle]="copy.subtitle" />

        @if (error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="loading()" (retry)="load()" />
        }
        @if (note(); as n) {
          <p class="meta adm__note" role="status">{{ n }}</p>
        }

        @if (loading() && !users().length) {
          <rr-skeleton kind="table" [rows]="5" />
        } @else {
          <section class="adm__section" [attr.aria-label]="copy.usersTitle">
            <div class="eyebrow">{{ copy.usersTitle }} · {{ users().length }}</div>
            <div class="paper tbl-wrap">
              <table class="tbl adm">
                <thead>
                  <tr>
                    @for (c of copy.columns; track c) {
                      <th scope="col">{{ c }}</th>
                    }
                    <th scope="col"><span class="visually-hidden">Действия</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (u of users(); track u.id) {
                    <tr class="tbl__row" [class.adm__row--off]="u.disabledAt">
                      <td>
                        <span class="adm__name">{{ u.name }}</span>
                        @if (u.id === meId()) {
                          <span class="meta"> · {{ copy.you }}</span>
                        }
                        @if (u.isInstanceAdmin) {
                          <span class="pill pill--muted adm__pill">{{ copy.admin }}</span>
                        }
                      </td>
                      <td class="meta adm__email">{{ u.email }}</td>
                      <td class="meta">
                        @if (u.memberships.length) {
                          @for (m of u.memberships; track m.projectId; let last = $last) {
                            <span>{{ m.projectName }} <span class="adm__role">{{ roleShort[m.role] }}</span>{{ last ? '' : ', ' }}</span>
                          }
                        } @else {
                          {{ copy.noProjects }}
                        }
                      </td>
                      <td>
                        @if (u.isInstanceAdmin) {
                          <span class="meta">{{ copy.canCreate }}</span>
                        } @else {
                          <button type="button" class="btn btn--secondary btn--sm" [disabled]="busy() === u.id" (click)="toggleCreate(u)">
                            {{ u.canCreateProjects ? copy.revokeRight : copy.grant }}
                          </button>
                        }
                      </td>
                      <td>
                        @if (u.disabledAt) {
                          <span class="pill pill--danger">{{ copy.disabled(date(u.disabledAt)) }}</span>
                        } @else {
                          <span class="pill pill--ok">{{ copy.active }}</span>
                        }
                      </td>
                      <td class="adm__act">
                        @if (u.id !== meId()) {
                          <button type="button" class="btn btn--text btn--sm" [disabled]="busy() === u.id" (click)="revokeSessions(u)">{{ copy.revokeSessions }}</button>
                          <button type="button" class="btn btn--sm" [class.btn--danger-text]="!u.disabledAt" [class.btn--secondary]="u.disabledAt" [disabled]="busy() === u.id" [attr.title]="u.disabledAt ? null : copy.disableHint" (click)="toggleDisabled(u)">
                            {{ u.disabledAt ? copy.enable : copy.disable }}
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (users().length <= 1) {
              <p class="meta adm__empty">{{ copy.empty }}</p>
            }
          </section>

          <section class="adm__section" [attr.aria-label]="copy.projectsTitle">
            <div class="eyebrow">{{ copy.projectsTitle }} · {{ projects().length }}</div>
            <div class="paper tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    @for (c of copy.projectColumns; track c) {
                      <th scope="col">{{ c }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (p of projects(); track p.id) {
                    <tr class="tbl__row">
                      <td class="adm__name">{{ p.name }}</td>
                      <td class="meta">{{ p.members }}</td>
                      <td class="meta">{{ date(p.createdAt) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      </main>
    </div>
  `,
  styles: `
    .banner,
    .adm__note {
      margin-bottom: var(--sp-4);
    }
    .adm__note {
      margin-top: 0;
    }
    .adm__section {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      margin-bottom: var(--sp-8);
    }
    .adm__name {
      font-weight: var(--fw-medium);
    }
    .adm__pill {
      margin-left: var(--sp-2);
    }
    .adm__role {
      color: var(--rr-ink-3);
    }
    .adm__row--off {
      color: var(--rr-ink-3);
    }
    .adm__act {
      text-align: right;
      white-space: nowrap;
    }
    .adm__act .btn + .btn {
      margin-left: var(--sp-2);
    }
    .adm__empty {
      margin: 0;
    }
    @media (max-width: 900px) {
      .adm__email {
        display: none;
      }
    }
  `,
})
export class AdminPage {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  protected readonly copy = ADMIN;
  protected readonly roleShort = ROLE_SHORT;
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly projects = signal<AdminProject[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly meId = computed(() => this.session.user()?.id ?? '');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [users, projects] = await Promise.all([this.api.adminUsers(), this.api.adminProjects()]);
      this.users.set(users);
      this.projects.set(projects);
    } catch {
      this.error.set(ERROR.load);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggleCreate(u: AdminUser): Promise<void> {
    return this.update(u, { canCreateProjects: !u.canCreateProjects });
  }

  protected toggleDisabled(u: AdminUser): Promise<void> {
    return this.update(u, { disabled: !u.disabledAt });
  }

  protected async revokeSessions(u: AdminUser): Promise<void> {
    if (this.busy()) return;
    this.busy.set(u.id);
    this.error.set(null);
    try {
      await this.api.adminRevokeSessions(u.id);
      this.note.set(this.copy.revoked(u.name));
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async update(u: AdminUser, body: { canCreateProjects?: boolean; disabled?: boolean }): Promise<void> {
    if (this.busy()) return;
    this.busy.set(u.id);
    this.error.set(null);
    this.note.set(null);
    try {
      const updated = await this.api.adminUpdateUser(u.id, body);
      // PATCH возвращает человека без membership — оставляем те, что уже знаем
      this.users.update((list) => list.map((x) => (x.id === u.id ? { ...updated, memberships: x.memberships } : x)));
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private message(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409) return this.copy.disabledSelf;
      const body = err.error as { message?: string | string[] } | null;
      const text = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
      if (text) return text;
    }
    return ERROR.request;
  }
}
