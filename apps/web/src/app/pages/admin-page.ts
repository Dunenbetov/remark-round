import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { ADMIN, ERROR, ROLE_SHORT } from '../core/copy';
import type { AdminProject, AdminUser, InvitationLink, InvitationSummary } from '../core/models';
import { errorMessage } from '../core/errors';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';

/**
 * Администрирование инстанса (ADR 006): люди и проекты поперёк тенантов для e-mail из ADMIN_EMAILS.
 * Три действия — выдать/снять право создавать проекты, отключить/включить человека, завершить его сессии —
 * и приглашение руководителя приёмки без проекта (ссылка /join, как у участников; токен показывается один раз).
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

          <section class="adm__section" [attr.aria-label]="copy.inviteTitle">
            <div class="eyebrow">{{ copy.inviteTitle }}</div>
            <form class="paper adm__invite" (submit)="invite($event)" novalidate>
              <p class="meta adm__invite-hint">{{ copy.inviteHint }}</p>
              <div class="adm__invite-row">
                <label class="field adm__invite-field">
                  <span class="field__label field__label--soft">{{ copy.inviteEmail }}</span>
                  <input class="input" type="email" name="email" autocomplete="off" inputmode="email" [value]="inviteEmail()" (input)="inviteEmail.set(value($event))" />
                </label>
                <button type="submit" class="btn btn--primary" [class.btn--busy]="inviting()" [disabled]="inviting() || !inviteEmail().trim()">{{ copy.invite }}</button>
              </div>
              @if (inviteNote(); as n) {
                <p class="meta" role="status">{{ n }}</p>
              }
              @if (inviteError(); as err) {
                <div class="adm__error" role="alert">{{ err }}</div>
              }
              @if (invitations().length) {
                <div class="eyebrow adm__pending">{{ copy.pendingTitle }}</div>
                <ul class="adm__inv-list">
                  @for (inv of invitations(); track inv.id) {
                    <li class="adm__inv-row">
                      <span class="adm__inv-who">
                        <span>{{ inv.email }}</span>
                        @if (inv.expiresAt) {
                          <span class="meta">{{ copy.expires(date(inv.expiresAt)) }}</span>
                        }
                      </span>
                      <span class="adm__inv-actions">
                        @if (links()[inv.id]; as fresh) {
                          <button type="button" class="btn btn--secondary btn--sm" (click)="copyLink(inv.id, fresh)">{{ copiedId() === inv.id ? copy.copied : copy.copyLink }}</button>
                        } @else {
                          <button type="button" class="btn btn--secondary btn--sm" [disabled]="busy() === inv.id" (click)="newLink(inv)">{{ copy.newLink }}</button>
                        }
                        <button type="button" class="btn btn--danger-text btn--sm" [disabled]="busy() === inv.id" (click)="revokeInvitation(inv)">{{ copy.revoke }}</button>
                      </span>
                      @if (links()[inv.id]; as fresh) {
                        <span class="meta adm__inv-ready" role="status">{{ fresh.emailed ? copy.linkReadyMailed : copy.linkReady }}</span>
                        <input class="input adm__inv-url" type="text" readonly [value]="link(fresh)" (focus)="selectAll($event)" />
                      }
                    </li>
                  }
                </ul>
              }
            </form>
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
    .adm__invite {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      padding: var(--sp-5) var(--sp-6);
    }
    .adm__invite-hint {
      margin: 0;
      max-width: 72ch;
    }
    .adm__invite-row {
      display: flex;
      gap: var(--sp-3);
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .adm__invite-field {
      flex: 1 1 280px;
      max-width: 420px;
    }
    .adm__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .adm__pending {
      margin-top: var(--sp-2);
    }
    .adm__inv-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    .adm__inv-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--sp-2) var(--sp-4);
      align-items: center;
    }
    .adm__inv-who {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .adm__inv-actions {
      display: flex;
      gap: var(--sp-2);
      white-space: nowrap;
    }
    .adm__inv-ready,
    .adm__inv-url {
      grid-column: 1 / -1;
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
  /** Приглашения руководителей без проекта (ADR 006, 17.09): токен приходит один раз — держим его в памяти страницы. */
  protected readonly invitations = signal<InvitationSummary[]>([]);
  protected readonly links = signal<Record<string, InvitationLink>>({});
  protected readonly inviteEmail = signal('');
  protected readonly inviting = signal(false);
  protected readonly inviteNote = signal<string | null>(null);
  protected readonly inviteError = signal<string | null>(null);
  protected readonly copiedId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [users, projects, invitations] = await Promise.all([this.api.adminUsers(), this.api.adminProjects(), this.api.adminInvitations()]);
      this.users.set(users);
      this.projects.set(projects);
      this.invitations.set(invitations);
    } catch {
      this.error.set(ERROR.load);
    } finally {
      this.loading.set(false);
    }
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async invite(e: Event): Promise<void> {
    e.preventDefault();
    const email = this.inviteEmail().trim();
    if (this.inviting() || !email) return;
    this.inviting.set(true);
    this.inviteError.set(null);
    this.inviteNote.set(null);
    try {
      const result = await this.api.adminInvite(email);
      if (result.kind === 'user') {
        this.inviteNote.set(this.copy.granted(result.user.name));
        this.users.update((list) => list.map((x) => (x.id === result.user.id ? { ...result.user, memberships: x.memberships } : x)));
      } else {
        this.inviteNote.set(result.invitation.emailed ? this.copy.invitedMailed(result.invitation.email) : this.copy.invited(result.invitation.email));
        this.remember(result.invitation.id, result.invitation);
        this.invitations.update((list) => [...list.filter((x) => x.id !== result.invitation.id), result.invitation]);
      }
      this.inviteEmail.set('');
    } catch (err) {
      this.inviteError.set(errorMessage(err));
    } finally {
      this.inviting.set(false);
    }
  }

  protected link(fresh: InvitationLink): string {
    return `${location.origin}/join/${fresh.token}`;
  }

  private remember(id: string, fresh: InvitationLink): void {
    this.links.update((all) => ({ ...all, [id]: { token: fresh.token, expiresAt: fresh.expiresAt, emailed: fresh.emailed } }));
  }

  protected async newLink(inv: InvitationSummary): Promise<void> {
    if (this.busy()) return;
    this.busy.set(inv.id);
    this.inviteError.set(null);
    try {
      const fresh = await this.api.adminInvitationLink(inv.id);
      this.remember(inv.id, fresh);
      this.invitations.update((list) => list.map((x) => (x.id === inv.id ? { ...x, expiresAt: fresh.expiresAt } : x)));
    } catch (err) {
      this.inviteError.set(errorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async revokeInvitation(inv: InvitationSummary): Promise<void> {
    if (this.busy()) return;
    this.busy.set(inv.id);
    this.inviteError.set(null);
    try {
      await this.api.adminRevokeInvitation(inv.id);
      this.invitations.update((list) => list.filter((x) => x.id !== inv.id));
    } catch (err) {
      this.inviteError.set(errorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async copyLink(id: string, fresh: InvitationLink): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link(fresh));
      this.copiedId.set(id);
      setTimeout(() => this.copiedId.update((current) => (current === id ? null : current)), 2000);
    } catch {
      // буфер обмена недоступен (http, iframe): ссылка видна текстом в поле ниже
    }
  }

  protected selectAll(e: Event): void {
    (e.target as HTMLInputElement).select();
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
    }
    return errorMessage(err);
  }
}
