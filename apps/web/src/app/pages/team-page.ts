import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { COMMON, ERROR, ROLE_SIDE, ROLE_SHORT, SIDES, TEAM } from '../core/copy';
import type { InvitationLink, InvitationSummary, MemberSummary, Role, Side } from '../core/models';
import { PendingActionService } from '../core/pending-action.service';
import { errorMessage } from '../core/errors';
import { SessionService } from '../core/session.service';
import { AppBar } from '../ui/app-bar';
import { ErrorBanner } from '../ui/error-banner';
import { Menu, MenuItem } from '../ui/menu';
import { PageHeader } from '../ui/page-header';
import { SegmentItem, Segmented } from '../ui/segmented';
import { Skeleton } from '../ui/skeleton';

/**
 * Участники проекта (ADR 005, ADR 006): руководитель приёмки добавляет по e-mail — зарегистрированный входит сразу,
 * незнакомый получает ссылку-приглашение, которую PM копирует и шлёт сам (писем нет). Токен ссылки сервер отдаёт
 * один раз; «Новая ссылка» выпускает заново. Роль — на проект, меняется здесь же; «Убрать из проекта» — через
 * 5-секундную отмену, как любое необратимое действие.
 */
@Component({
  selector: 'rr-team-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBar, PageHeader, ErrorBanner, Segmented, Menu, Skeleton],
  template: `
    <div class="page">
      <rr-app-bar />
      <main id="main" class="page__body page__body--loose">
        <rr-page-header [title]="copy.title" [eyebrow]="projectName()" [subtitle]="copy.subtitle" />

        <form class="paper add" (submit)="add($event)" novalidate>
          <div class="eyebrow">{{ copy.addTitle }}</div>
          <div class="add__row">
            <label class="field add__email">
              <span class="field__label field__label--soft">{{ copy.emailLabel }}</span>
              <input class="input" type="email" name="email" inputmode="email" autocomplete="off" [value]="email()" (input)="email.set(value($event))" [attr.aria-invalid]="addError() ? 'true' : null" />
            </label>
            <div class="field">
              <span class="field__label field__label--soft">{{ copy.roleLabel }}</span>
              <rr-segmented [items]="sideItems" [selected]="side()" [label]="copy.roleLabel" (pick)="pickSide($event)" />
            </div>
            <button type="submit" class="btn btn--primary add__btn" [class.btn--busy]="adding()" [disabled]="adding() || !email().trim()">{{ copy.add }}</button>
          </div>
          @if (addError(); as err) {
            <div class="add__error" role="alert">{{ err }}</div>
          }
          @if (addNote(); as note) {
            <div class="meta add__note" role="status">{{ note }}</div>
          }
        </form>

        @if (error(); as err) {
          <rr-error-banner class="banner" [message]="err" [busy]="loading()" (retry)="load()" />
        }

        @if (loading() && !members().length) {
          <rr-skeleton kind="table" [rows]="4" />
        } @else {
          <div class="paper tbl-wrap">
            <table class="tbl team">
              <caption class="visually-hidden">{{ copy.title }}</caption>
              <thead>
                <tr>
                  @for (c of copy.columns; track c) {
                    <th scope="col">{{ c }}</th>
                  }
                  <th scope="col"><span class="visually-hidden">{{ copy.remove }}</span></th>
                </tr>
              </thead>
              <tbody>
                @for (m of visibleMembers(); track m.userId) {
                  <tr class="tbl__row">
                    <td>
                      <span class="team__person">
                        <span class="avatar avatar--sm" [class]="'avatar avatar--sm avatar--' + tone(m.role)">{{ m.name.charAt(0).toUpperCase() }}</span>
                        <span class="team__name">{{ m.name }}</span>
                        @if (m.userId === meId()) {
                          <span class="meta">· {{ copy.you }}</span>
                        }
                      </span>
                    </td>
                    <td class="meta team__email">{{ m.email }}</td>
                    <td>
                      @if (m.role === 'admin') {
                        <span class="pill pill--muted">{{ roleShort.admin }}</span>
                      } @else {
                        <rr-menu align="start" [items]="roleItems(m)" [label]="copy.changeRole" triggerClass="switch" (pick)="changeRole(m, $event)">
                          <span class="switch__text">{{ roleSide[sideOf(m.role)] }}</span>
                        </rr-menu>
                      }
                    </td>
                    <td class="team__act">
                      <button type="button" class="btn btn--danger-text btn--sm" [disabled]="isLastPm(m)" [attr.title]="isLastPm(m) ? copy.lastPm : null" (click)="remove(m)">{{ copy.remove }}</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (members().length <= 1 && !invitations().length) {
            <p class="meta team__empty">{{ copy.empty }}</p>
          }

          @if (invitations().length) {
            <section class="paper inv" [attr.aria-label]="copy.invitationsTitle">
              <div class="inv__head">
                <div class="eyebrow">{{ copy.invitationsTitle }}</div>
                <p class="meta inv__hint">{{ copy.invitationsHint }}</p>
              </div>
              <ul class="inv__list">
                @for (inv of invitations(); track inv.id) {
                  <li class="inv__row">
                    <span class="inv__who">
                      <span class="inv__email">{{ inv.email }}</span>
                      <span class="meta">{{ roleSide[sideOf(inv.role)] }}@if (inv.expiresAt) { · {{ copy.expires(date(inv.expiresAt)) }}}</span>
                    </span>
                    <span class="inv__actions">
                      @if (links()[inv.id]; as fresh) {
                        <button type="button" class="btn btn--secondary btn--sm" (click)="copyLink(inv.id, fresh)">{{ copiedId() === inv.id ? copy.copied : copy.copyLink }}</button>
                      } @else {
                        <button type="button" class="btn btn--secondary btn--sm" [disabled]="linking() === inv.id" (click)="newLink(inv)">{{ copy.newLink }}</button>
                      }
                      <button type="button" class="btn btn--danger-text btn--sm" (click)="revoke(inv)">{{ copy.revoke }}</button>
                    </span>
                    @if (links()[inv.id]; as fresh) {
                      <span class="meta inv__ready" role="status">{{ copy.linkReady }}</span>
                      <input class="input inv__url" type="text" readonly [value]="link(fresh)" (focus)="selectAll($event)" />
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      </main>
    </div>
  `,
  styles: `
    .add {
      padding: var(--sp-5) var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      margin-bottom: var(--sp-6);
    }
    .add__row {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto auto;
      gap: var(--sp-4);
      align-items: end;
    }
    .add__btn {
      height: 40px;
    }
    .add__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .add__note {
      margin: 0;
    }
    .banner {
      margin-bottom: var(--sp-4);
    }
    .team__person {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
    }
    .avatar--sm {
      width: 28px;
      height: 28px;
      font-size: var(--fs-13);
    }
    .team__name {
      font-weight: var(--fw-medium);
    }
    .team__act {
      text-align: right;
      white-space: nowrap;
    }
    .team__empty {
      margin: var(--sp-3) 0 0;
    }
    .inv {
      margin-top: var(--sp-6);
      padding: var(--sp-5) var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
    }
    .inv__head {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .inv__hint {
      margin: 0;
      max-width: 72ch;
    }
    .inv__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .inv__row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--sp-3);
      align-items: center;
      padding: var(--sp-3) 0;
      border-top: 1px solid var(--rr-line);
    }
    .inv__who {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .inv__email {
      font-weight: var(--fw-medium);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .inv__actions {
      display: inline-flex;
      gap: var(--sp-2);
    }
    .inv__ready,
    .inv__url {
      grid-column: 1 / -1;
    }
    .inv__ready {
      margin: 0;
      color: var(--rr-accent-2-text);
      font-weight: var(--fw-semibold);
    }
    @media (max-width: 900px) {
      .add__row {
        grid-template-columns: 1fr;
      }
      .team__email {
        display: none;
      }
      .inv__row {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class TeamPage {
  readonly projectId = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly actions = inject(PendingActionService);

  protected readonly copy = TEAM;
  protected readonly roleSide = ROLE_SIDE;
  protected readonly roleShort = ROLE_SHORT;
  protected readonly sideItems: SegmentItem[] = SIDES.map((s) => ({ id: s, label: ROLE_SIDE[s] }));
  protected readonly members = signal<MemberSummary[]>([]);
  protected readonly invitations = signal<InvitationSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly email = signal('');
  protected readonly side = signal<Side>('developer');
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addNote = signal<string | null>(null);
  protected readonly copiedId = signal<string | null>(null);
  /** Сырые токены, полученные в этой сессии страницы (создание или «Новая ссылка»): сервер их больше не отдаст. */
  protected readonly links = signal<Record<string, InvitationLink>>({});
  protected readonly linking = signal<string | null>(null);
  /** Строка, ждущая отмены: скрыта, пока идёт отсчёт; отмена возвращает её. */
  private readonly hiddenUserId = signal<string | null>(null);
  protected readonly meId = computed(() => this.session.user()?.id ?? '');
  protected readonly projectName = computed(() => this.session.membership(this.projectId())?.projectName ?? '');
  protected readonly visibleMembers = computed(() => this.members().filter((m) => m.userId !== this.hiddenUserId()));
  private readonly pmCount = computed(() => this.members().filter((m) => m.role === 'pm').length);

  constructor() {
    effect(() => {
      this.projectId();
      untracked(() => void this.load());
    });
    // Отменили в полосе — строка возвращается; коммит сам перечитает список
    effect(() => {
      const pending = this.actions.pending();
      const hidden = untracked(() => this.hiddenUserId());
      if (hidden && pending?.remarkId !== `member:${hidden}` && !this.actions.committing()) this.hiddenUserId.set(null);
    });
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const view = await this.api.members(this.projectId());
      this.members.set(view.members);
      this.invitations.set(view.invitations);
    } catch {
      this.error.set(ERROR.load);
    } finally {
      this.loading.set(false);
    }
  }

  protected sideOf(role: Role): Side {
    return role === 'admin' ? 'pm' : role;
  }

  protected pickSide(id: string): void {
    if (id === 'pm' || id === 'developer' || id === 'business') this.side.set(id);
  }

  protected tone(role: Role): 'accent' | 'wait' | 'work' {
    return role === 'business' ? 'wait' : role === 'developer' ? 'work' : 'accent';
  }

  protected isLastPm(m: MemberSummary): boolean {
    return m.role === 'pm' && this.pmCount() <= 1;
  }

  protected roleItems(m: MemberSummary): MenuItem[] {
    return SIDES.map((s) => ({ id: s, label: ROLE_SIDE[s], selected: m.role === s }));
  }

  protected async add(e: Event): Promise<void> {
    e.preventDefault();
    if (this.adding() || !this.email().trim()) return;
    this.adding.set(true);
    this.addError.set(null);
    this.addNote.set(null);
    try {
      const result = await this.api.addMember(this.projectId(), { email: this.email().trim(), role: this.side() });
      this.addNote.set(result.kind === 'member' ? this.copy.addedMember(result.member.name) : this.copy.addedInvitation(result.invitation.email));
      if (result.kind === 'invitation') this.remember(result.invitation.id, result.invitation);
      this.email.set('');
      await this.load();
    } catch (err) {
      this.addError.set(this.message(err));
    } finally {
      this.adding.set(false);
    }
  }

  protected async changeRole(m: MemberSummary, id: string): Promise<void> {
    const role = id as Role;
    if (role === m.role) return;
    this.error.set(null);
    try {
      const updated = await this.api.updateMember(this.projectId(), m.userId, role);
      this.members.update((list) => list.map((x) => (x.userId === updated.userId ? updated : x)));
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  /** Убрать — с отменой 5 с (ANTI.md: необратимое без «Отменить» не бывает). */
  protected remove(m: MemberSummary): void {
    if (this.isLastPm(m)) return;
    this.hiddenUserId.set(m.userId);
    this.actions.schedule({
      remarkId: `member:${m.userId}`,
      label: this.copy.removed(m.name),
      record: '',
      inline: false,
      commit: async () => {
        try {
          await this.api.removeMember(this.projectId(), m.userId);
        } catch (err) {
          this.error.set(this.message(err));
        }
        this.hiddenUserId.set(null);
        await this.load();
      },
    });
  }

  protected async revoke(inv: InvitationSummary): Promise<void> {
    this.error.set(null);
    try {
      await this.api.revokeInvitation(this.projectId(), inv.id);
      this.invitations.update((list) => list.filter((x) => x.id !== inv.id));
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  protected link(fresh: InvitationLink): string {
    return `${location.origin}/join/${fresh.token}`;
  }

  /** Сервер отдаёт токен один раз (ADR 006): держим его в памяти страницы и показываем текстом — буфер обмена может быть недоступен. */
  private remember(id: string, fresh: InvitationLink): void {
    this.links.update((all) => ({ ...all, [id]: { token: fresh.token, expiresAt: fresh.expiresAt } }));
  }

  protected async newLink(inv: InvitationSummary): Promise<void> {
    if (this.linking()) return;
    this.linking.set(inv.id);
    this.error.set(null);
    try {
      const fresh = await this.api.invitationLink(this.projectId(), inv.id);
      this.remember(inv.id, fresh);
      this.invitations.update((list) => list.map((x) => (x.id === inv.id ? { ...x, expiresAt: fresh.expiresAt } : x)));
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.linking.set(null);
    }
  }

  protected async copyLink(id: string, fresh: InvitationLink): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link(fresh));
      this.copiedId.set(id);
      setTimeout(() => this.copiedId.update((current) => (current === id ? null : current)), 2000);
    } catch {
      // Буфер недоступен (http без TLS, старый браузер): ссылка и так показана текстом под строкой
    }
  }

  protected selectAll(e: Event): void {
    (e.target as HTMLInputElement).select();
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  private message(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409) return this.copy.lastPm;
    }
    return errorMessage(err);
  }

  protected readonly common = COMMON;
}
