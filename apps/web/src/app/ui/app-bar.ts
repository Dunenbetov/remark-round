import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_NAME, NAV, ROLE_ADMIN, ROLE_TITLE, ROUND } from '../core/copy';
import { journalFileName, saveBlob } from '../core/download';
import { homeUrlFor } from '../core/guards';
import { links, sectionOf, type Section } from '../core/links';
import { filterRemarks } from '../core/journal-filter';
import type { Role } from '../core/models';
import { AccountService } from '../core/account.service';
import { OnboardingService } from '../core/onboarding.service';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { BrandMark } from './brand-mark';
import { Icon } from './icons';
import { InvitationsBell } from './invitations-bell';
import { Menu, MenuItem } from './menu';
import { SegmentItem, Segmented } from './segmented';
import { ThemeToggle } from './theme-toggle';

/** Цвет буквы в кружке аватара по роли; профиль берёт тот же тон по стороне. */
export const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };

/**
 * Верхняя панель — плавающая белая полоса со скруглением: бренд-знак + RemarkRound + контекст «Проект · Раунд ▾» | сегменты |
 * «Добавить замечание» (бизнес) · колокольчик приглашений (ADR 013) · тумблер темы · аватар. Роль человека — в заголовке страницы и в меню аватара.
 * На узком экране разделы уезжают в нижний таб-бар.
 */
@Component({
  selector: 'rr-app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Menu, Segmented, ThemeToggle, BrandMark, Icon, InvitationsBell],
  template: `
    <a class="skip" href="#main" (click)="skipToMain($event)">{{ nav.skip }}</a>
    <header class="bar">
      <div class="bar__in" [class.bar__in--brand]="brandOnly() || !projectId()" [class.bar__in--nonav]="segments().length < 2">
        <div class="bar__left">
          <a class="bar__brand" routerLink="/">
            <rr-brand-mark [size]="24" />
            <span class="serif bar__word">{{ appName }}</span>
          </a>
          @if (!brandOnly() && projectId()) {
            @if (contextItems().length) {
              <rr-menu align="start" [items]="contextItems()" [label]="nav.contextLabel" triggerClass="switch" (pick)="onContextPick($event)">
                <span class="switch__text">{{ contextLabel() }}</span>
                <rr-icon class="switch__chev" name="chevron-down" [size]="14" />
              </rr-menu>
            } @else {
              <span class="bar__context">{{ contextLabel() }}</span>
            }
          }
        </div>
        @if (!brandOnly() && projectId() && segments().length > 1) {
          <nav class="bar__nav" [attr.aria-label]="nav.sections">
            <rr-segmented [items]="segments()" [selected]="section()" [label]="nav.sections" />
          </nav>
        }
        <div class="bar__right">
          <!-- В закрытый раунд не добавляют: он только для чтения (ADR 011) -->
          @if (!brandOnly() && role() === 'business' && projectId() && store.round()?.status !== 'closed') {
            <a class="btn btn--primary btn--sm bar__add" [routerLink]="newRemarkLink()">
              <rr-icon name="plus" [size]="16" />
              {{ nav.addRemark }}
            </a>
          }
          @if (user()) {
            <rr-invitations-bell />
          }
          <rr-theme-toggle />
          @if (user(); as u) {
            <rr-menu [items]="userItems()" [head]="userHead()" [label]="nav.menu" [triggerClass]="'avatar avatar--' + tone()" (pick)="onUserPick($event)">
              {{ initial() }}
            </rr-menu>
          }
        </div>
      </div>
    </header>
    @if (tabs() && !brandOnly() && projectId()) {
      <nav class="tabs" [attr.aria-label]="nav.sections">
        @if (role() === 'developer') {
          <a class="tabs__link" [class.tabs__link--on]="section() === 'dev'" [attr.aria-current]="section() === 'dev' ? 'page' : null" [routerLink]="devLink()">{{ nav.dev }}</a>
          <a class="tabs__link" [class.tabs__link--on]="section() === 'documents'" [attr.aria-current]="section() === 'documents' ? 'page' : null" [routerLink]="docsLink()">{{ nav.documents }}</a>
        } @else {
          <a class="tabs__link" [class.tabs__link--on]="section() === 'journal'" [attr.aria-current]="section() === 'journal' ? 'page' : null" [routerLink]="journalLink()">{{ nav.journal }}</a>
          <a class="tabs__link" [class.tabs__link--on]="section() === 'documents'" [attr.aria-current]="section() === 'documents' ? 'page' : null" [routerLink]="docsLink()">{{ nav.documents }}</a>
          <a class="tabs__link" [class.tabs__link--on]="section() === 'import'" [attr.aria-current]="section() === 'import' ? 'page' : null" [routerLink]="importLink()">{{ nav.import }}</a>
          @if (canManage()) {
            <a class="tabs__link" [class.tabs__link--on]="section() === 'team'" [attr.aria-current]="section() === 'team' ? 'page' : null" [routerLink]="teamLink()">{{ nav.team }}</a>
          }
        }
      </nav>
    }
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: var(--z-bar);
      padding: var(--sp-3) 0 0;
      background: linear-gradient(180deg, var(--rr-bg) 60%, transparent);
    }
    .bar {
      height: calc(var(--rr-bar-h) - 4px);
      width: min(var(--rr-container-wide), 100% - 48px);
      margin-inline: auto;
      background: var(--rr-glass-bg);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
      border: 1px solid var(--rr-glass-line);
      border-radius: var(--rr-r-lg);
      box-shadow: var(--rr-glass-shadow);
    }
    .bar__in {
      width: 100%;
      padding: 0 var(--sp-3) 0 var(--sp-4);
      height: 100%;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: var(--sp-4);
    }
    .bar__in--brand,
    .bar__in--nonav {
      grid-template-columns: 1fr auto;
    }
    .bar__left {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      min-width: 0;
    }
    /* Контекст сжимается с многоточием, а не уезжает под колокольчик и навигацию */
    .bar__left rr-menu {
      min-width: 0;
    }
    .bar__left ::ng-deep .switch {
      max-width: min(320px, 100%);
    }
    .bar__brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--rr-ink);
      text-decoration: none;
      white-space: nowrap;
    }
    .bar__brand:hover {
      color: var(--rr-ink);
    }
    .bar__word {
      font-size: 15px;
      line-height: 24px;
      font-weight: var(--fw-semibold);
      letter-spacing: -0.02em;
    }
    .bar__context {
      font-size: var(--fs-14);
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 6px;
      min-width: 0;
      max-width: 320px;
    }
    .bar__context::before,
    .bar__left ::ng-deep .switch::before {
      content: '·';
      margin-right: 8px;
      color: var(--rr-ink-3);
    }
    .bar__nav {
      display: flex;
      justify-content: center;
    }
    .bar__right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--sp-3);
      min-width: 0;
    }
    .bar__add {
      padding-left: 12px;
    }
    .tabs {
      display: none;
    }
    @media (max-width: 900px) {
      :host {
        padding-top: var(--sp-2);
      }
      .bar {
        width: calc(100% - 16px);
      }
      .bar__in {
        grid-template-columns: 1fr auto;
        gap: var(--sp-3);
      }
      .bar__nav,
      .bar__add,
      .bar__word {
        display: none;
      }
      .bar__context {
        max-width: 200px;
      }
      .tabs {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: var(--z-bar);
        display: flex;
        height: calc(var(--rr-tabbar-h) + env(safe-area-inset-bottom));
        padding-bottom: env(safe-area-inset-bottom);
        background: var(--rr-glass-bg);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
        backdrop-filter: blur(16px) saturate(140%);
        border-top: 1px solid var(--rr-line);
      }
      .tabs__link {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--fs-13);
        font-weight: var(--fw-medium);
        color: var(--rr-ink-2);
        text-decoration: none;
      }
      .tabs__link--on {
        color: var(--rr-accent-text);
        font-weight: var(--fw-semibold);
        box-shadow: inset 0 2px 0 var(--rr-accent-text);
      }
    }
  `,
})
export class AppBar {
  readonly brandOnly = input(false);
  /** Нижний таб-бар на узком экране. Карточка и форма выключают: у них своя липкая зона снизу. */
  readonly tabs = input(true);

  private readonly session = inject(SessionService);
  protected readonly store = inject(RemarksStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly onboarding = inject(OnboardingService);
  private readonly account = inject(AccountService);

  protected readonly appName = APP_NAME;
  protected readonly nav = NAV;

  protected readonly user = this.session.user;
  protected readonly projectId = computed(() => this.store.projectId() ?? this.session.currentProjectId());
  protected readonly role = computed<Role | null>(() => this.session.roleIn(this.projectId()));
  /** Участников ведут руководитель приёмки и admin (ADR 005). */
  protected readonly canManage = computed(() => this.role() === 'pm' || this.role() === 'admin');
  private readonly canOpenRound = computed(() => this.role() === 'pm' || this.role() === 'business' || this.role() === 'admin');
  protected readonly tone = computed(() => (this.role() ? TONE_BY_ROLE[this.role()!] : 'accent'));
  protected readonly initial = computed(() => (this.user()?.name ?? '?').charAt(0).toUpperCase());
  protected readonly projectName = computed(() => this.session.membership(this.projectId())?.projectName ?? '');
  protected readonly roundLabel = computed(() => (this.store.roundNumber() ? ROUND.label(this.store.roundNumber()!) : ''));

  /** «Клиентский кабинет · Раунд 2»; у разработчика — только проект. */
  protected readonly contextLabel = computed(() => {
    const parts = [this.projectName()];
    if (this.role() !== 'developer' && this.roundLabel()) parts.push(this.roundLabel());
    return parts.filter(Boolean).join(' · ');
  });

  /** Раунды с нерешёнными замечаниями: пока они есть, новый раунд не открыть (сервер ответит тем же 409). */
  private readonly blockingRounds = computed(() => this.store.rounds().filter((r) => (r.pending ?? 0) > 0));

  /** Одно меню с двумя группами: проекты (список, «Все проекты», «Создать проект» у стороны pm) и раунды (+ «Новый раунд»). */
  protected readonly contextItems = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    const memberships = this.session.memberships();
    if (memberships.length > 1) {
      memberships.forEach((m, i) =>
        items.push({ id: `project:${m.projectId}`, label: m.projectName, hint: ROLE_TITLE[m.role], selected: m.projectId === this.projectId(), group: i === 0 ? NAV.project : undefined }),
      );
    }
    items.push({ id: 'projects:all', label: NAV.allProjects, group: memberships.length > 1 ? undefined : NAV.project, separatorBefore: memberships.length > 1 });
    if (this.session.canCreateProjects()) items.push({ id: 'projects:new', label: NAV.newProject });
    const rounds = this.store.rounds();
    if (this.role() !== 'developer' && rounds.length) {
      rounds.forEach((r, i) =>
        items.push({
          id: `round:${r.number}`,
          label: ROUND.item(r.number, r.status, r.remarks),
          selected: r.number === this.store.roundNumber(),
          group: i === 0 ? NAV.round : undefined,
          separatorBefore: i === 0,
        }),
      );
      items.push({ id: 'rounds:all', label: NAV.allRounds });
      if (this.canOpenRound()) {
        const blocking = this.blockingRounds();
        const pending = blocking.reduce((sum, r) => sum + r.pending, 0);
        items.push({
          id: 'round:new',
          label: NAV.newRound,
          disabled: blocking.length > 0,
          hint: blocking.length ? NAV.newRoundBlocked(pending, blocking.map((r) => r.number)) : undefined,
        });
      }
      const current = this.store.round();
      if (current) {
        items.push({ id: 'round:export', label: NAV.exportRound(current.number), separatorBefore: true });
        items.push({ id: 'round:journal', label: NAV.exportJournal });
        if (this.role() === 'pm' || this.role() === 'business') {
          items.push(current.status === 'closed' ? { id: 'round:reopen', label: NAV.reopenRound(current.number) } : { id: 'round:close', label: NAV.closeRound(current.number) });
        }
      }
    }
    return items;
  });

  /** Разделы: у PM и бизнеса — Журнал (со счётчиком «Ждут меня») · Документы · Импорт; у разработчика — «В работу» · Документы (пакет читает вся команда, 20.09). */
  protected readonly segments = computed<SegmentItem[]>(() => {
    const role = this.role();
    if (role === 'developer') {
      const count = this.store.devQueue().filter((r) => r.status === 'defect').length;
      return [
        { id: 'dev', label: NAV.dev, count, link: this.devLink() },
        { id: 'documents', label: NAV.documents, link: this.docsLink() },
      ];
    }
    const count = filterRemarks(this.store.remarks(), 'Ждут меня', role).length;
    const items: SegmentItem[] = [
      { id: 'journal', label: NAV.journal, count, link: this.journalLink() },
      { id: 'documents', label: NAV.documents, link: this.docsLink() },
      { id: 'import', label: NAV.import, link: this.importLink() },
    ];
    if (this.canManage()) items.push({ id: 'team', label: NAV.team, link: this.teamLink() });
    return items;
  });

  /** Меню аватара: «Профиль», «Как это работает» (бизнес и PM) и «Выйти» — тема живёт тумблером в шапке. */
  protected readonly userItems = computed<MenuItem[]>(() => {
    const role = this.role();
    const items: MenuItem[] = [{ id: 'profile', label: NAV.profile, separatorBefore: true }];
    if (role === 'business' || role === 'pm') items.push({ id: 'how', label: NAV.howItWorks });
    if (this.session.isInstanceAdmin()) items.push({ id: 'admin', label: NAV.admin });
    items.push({ id: 'logout', label: NAV.logout, separatorBefore: true });
    return items;
  });
  /** Шапка меню: e-mail · роль в текущем проекте; администратор инстанса (ADR 006, 17.09) — «Администратор» перед ролью, стороны у него нет. */
  protected readonly userHead = computed(() => {
    const u = this.user();
    if (!u) return null;
    const role = this.role();
    const who = [this.session.isInstanceAdmin() ? ROLE_ADMIN : null, role ? ROLE_TITLE[role] : null].filter(Boolean);
    return { title: u.name, meta: [u.email, ...who].join(' · ') };
  });

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly section = computed<Section>(() => sectionOf(this.url()));

  /** Адреса разделов — человеческие: /klientskiy-kabinet/round-2/import (core/links.ts). */
  private readonly slug = computed(() => this.session.slugOf(this.projectId()));
  protected readonly journalLink = computed(() => links.journal(this.slug(), this.store.roundNumber()));
  protected readonly newRemarkLink = computed(() => links.newRemark(this.slug(), this.store.roundNumber()));
  protected readonly importLink = computed(() => links.import(this.slug(), this.store.roundNumber()));
  protected readonly docsLink = computed(() => links.documents(this.slug()));
  protected readonly devLink = computed(() => links.dev(this.slug()));
  protected readonly teamLink = computed(() => links.team(this.slug()));

  protected onContextPick(id: string): void {
    if (id === 'projects:all' || id === 'projects:new') {
      void this.router.navigateByUrl('/projects');
      return;
    }
    if (id === 'round:new') {
      if (!this.blockingRounds().length) void this.newRound();
      return;
    }
    if (id === 'round:close' || id === 'round:reopen' || id === 'round:export' || id === 'round:journal') {
      void this.roundAction(id);
      return;
    }
    if (id === 'rounds:all') {
      void this.router.navigate(links.rounds(this.slug()));
      return;
    }
    if (id.startsWith('project:')) {
      const projectId = id.slice('project:'.length);
      const m = this.session.membership(projectId);
      if (!m || projectId === this.projectId()) return;
      this.session.selectProject(projectId);
      void this.router.navigateByUrl(homeUrlFor(m));
      return;
    }
    if (id.startsWith('round:')) {
      void this.router.navigate(links.journal(this.slug(), id.slice('round:'.length)));
    }
  }

  protected onUserPick(id: string): void {
    if (id === 'how') {
      const role = this.role();
      if (role === 'business' || role === 'pm') this.onboarding.open(role);
      return;
    }
    if (id === 'admin') {
      void this.router.navigateByUrl('/admin');
      return;
    }
    if (id === 'profile') {
      void this.router.navigateByUrl('/profile');
      return;
    }
    if (id === 'logout') this.account.logout();
  }

  /**
   * Закрыть / открыть снова / выгрузить текущий раунд. Закрытие обратимо (reopen), поэтому без отсчёта;
   * 409 с перечнем нерешённого покажет store.error. Выгрузка — blob с Bearer, скачивается ссылкой на object URL.
   */
  private async roundAction(id: 'round:close' | 'round:reopen' | 'round:export' | 'round:journal'): Promise<void> {
    const projectId = this.projectId();
    const round = this.store.round();
    if (!projectId || !round) return;
    if (id === 'round:close') {
      await this.store.closeRound(projectId, round.id);
      return;
    }
    if (id === 'round:reopen') {
      await this.store.reopenRound(projectId, round.id);
      return;
    }
    try {
      if (id === 'round:journal') saveBlob(await this.api.exportJournal(projectId), journalFileName(this.slug()));
      else saveBlob(await this.api.exportRound(projectId, round.id), journalFileName(this.slug(), round.number));
    } catch (err) {
      this.store.error.set(errorMessage(err));
    }
  }

  /** «Новый раунд»: следующий номер, журнал открывается пустым. */
  private async newRound(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const round = await this.store.createRound(projectId);
    if (round) void this.router.navigate(links.journal(this.slug(), round.number));
  }

  protected skipToMain(e: Event): void {
    e.preventDefault();
    const main = document.getElementById('main');
    if (!main) return;
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: false });
  }
}
