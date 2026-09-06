import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_NAME, NAV, ROLE_TITLE, ROUND } from '../core/copy';
import { homeUrlFor } from '../core/guards';
import { filterRemarks } from '../core/journal-filter';
import type { Role } from '../core/models';
import { OnboardingService } from '../core/onboarding.service';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { BrandMark } from './brand-mark';
import { Icon } from './icons';
import { Menu, MenuItem } from './menu';
import { SegmentItem, Segmented } from './segmented';
import { ThemeToggle } from './theme-toggle';

type Section = 'journal' | 'documents' | 'import' | 'dev';

const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };

/**
 * Верхняя панель 60px: бренд-знак + RemarkRound + одна контекст-пилюля «Проект · Раунд ▾» | сегменты разделов |
 * «Добавить замечание» (бизнес) · тумблер темы · аватар. Роль человека — в заголовке страницы и в меню аватара.
 * На узком экране разделы уезжают в нижний таб-бар.
 */
@Component({
  selector: 'rr-app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Menu, Segmented, ThemeToggle, BrandMark, Icon],
  template: `
    <a class="skip" href="#main" (click)="skipToMain($event)">{{ nav.skip }}</a>
    <header class="bar">
      <div class="bar__in" [class.bar__in--brand]="brandOnly() || !projectId()">
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
        @if (!brandOnly() && projectId()) {
          <nav class="bar__nav" [attr.aria-label]="nav.sections">
            <rr-segmented [items]="segments()" [selected]="section()" [label]="nav.sections" />
          </nav>
        }
        <div class="bar__right">
          @if (!brandOnly() && role() === 'business' && projectId()) {
            <a class="btn btn--primary btn--sm bar__add" [routerLink]="link('r', roundParam(), 'remarks', 'new')">
              <rr-icon name="plus" [size]="16" />
              {{ nav.addRemark }}
            </a>
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
    @if (tabs() && !brandOnly() && projectId() && role() !== 'developer') {
      <nav class="tabs" [attr.aria-label]="nav.sections">
        <a class="tabs__link" [class.tabs__link--on]="section() === 'journal'" [attr.aria-current]="section() === 'journal' ? 'page' : null" [routerLink]="link('r', roundParam())">{{ nav.journal }}</a>
        <a class="tabs__link" [class.tabs__link--on]="section() === 'documents'" [attr.aria-current]="section() === 'documents' ? 'page' : null" [routerLink]="link('documents')">{{ nav.documents }}</a>
        <a class="tabs__link" [class.tabs__link--on]="section() === 'import'" [attr.aria-current]="section() === 'import' ? 'page' : null" [routerLink]="link('r', roundParam(), 'import')">{{ nav.import }}</a>
      </nav>
    }
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: var(--z-bar);
    }
    .bar {
      height: var(--rr-bar-h);
      background: var(--rr-glass-bg);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
      border-bottom: 1px solid var(--rr-line);
    }
    .bar__in {
      width: min(var(--rr-container-wide), 100% - 48px);
      margin-inline: auto;
      height: 100%;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: var(--sp-4);
    }
    .bar__in--brand {
      grid-template-columns: 1fr auto;
    }
    .bar__left {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      min-width: 0;
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
      font-size: 20px;
      line-height: 24px;
      letter-spacing: -0.01em;
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
      .bar__in {
        width: calc(100% - 24px);
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
  private readonly store = inject(RemarksStore);
  private readonly router = inject(Router);
  private readonly onboarding = inject(OnboardingService);

  protected readonly appName = APP_NAME;
  protected readonly nav = NAV;

  protected readonly user = this.session.user;
  protected readonly projectId = computed(() => this.store.projectId() ?? this.session.currentProjectId());
  protected readonly role = computed<Role | null>(() => this.session.roleIn(this.projectId()));
  protected readonly tone = computed(() => (this.role() ? TONE_BY_ROLE[this.role()!] : 'accent'));
  protected readonly initial = computed(() => (this.user()?.name ?? '?').charAt(0).toUpperCase());
  protected readonly roundParam = computed(() => this.store.roundNumber() ?? 'latest');
  protected readonly projectName = computed(() => this.session.membership(this.projectId())?.projectName ?? '');
  protected readonly roundLabel = computed(() => (this.store.roundNumber() ? ROUND.label(this.store.roundNumber()!) : ''));

  /** «Клиентский кабинет · Раунд 2»; у разработчика — только проект. */
  protected readonly contextLabel = computed(() => {
    const parts = [this.projectName()];
    if (this.role() !== 'developer' && this.roundLabel()) parts.push(this.roundLabel());
    return parts.filter(Boolean).join(' · ');
  });

  /** Одно меню с двумя группами: проекты (если их больше одного) и раунды. Пусто → текст без шеврона. */
  protected readonly contextItems = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    const memberships = this.session.memberships();
    if (memberships.length > 1) {
      memberships.forEach((m, i) =>
        items.push({ id: `project:${m.projectId}`, label: m.projectName, hint: ROLE_TITLE[m.role], selected: m.projectId === this.projectId(), group: i === 0 ? NAV.project : undefined }),
      );
    }
    const rounds = this.store.rounds();
    if (this.role() !== 'developer' && this.store.roundNumber() && rounds.length > 1) {
      rounds.forEach((r, i) =>
        items.push({
          id: `round:${r.number}`,
          label: ROUND.item(r.number, r.status, r.remarks),
          selected: r.number === this.store.roundNumber(),
          group: i === 0 ? NAV.round : undefined,
          separatorBefore: i === 0 && items.length > 0,
        }),
      );
    }
    return items;
  });

  /** Разделы: у PM и бизнеса — Журнал (со счётчиком «Ждут меня») · Документы · Импорт; у разработчика — «В работу». */
  protected readonly segments = computed<SegmentItem[]>(() => {
    const role = this.role();
    if (role === 'developer') {
      const count = this.store.devQueue().filter((r) => r.status === 'defect').length;
      return [{ id: 'dev', label: NAV.dev, count, link: this.link('dev') }];
    }
    const count = filterRemarks(this.store.remarks(), 'Ждут меня', role).length;
    return [
      { id: 'journal', label: NAV.journal, count, link: this.link('r', this.roundParam()) },
      { id: 'documents', label: NAV.documents, link: this.link('documents') },
      { id: 'import', label: NAV.import, link: this.link('r', this.roundParam(), 'import') },
    ];
  });

  /** Меню аватара: «Как это работает» (бизнес и PM) и «Выйти» — тема живёт тумблером в шапке. */
  protected readonly userItems = computed<MenuItem[]>(() => {
    const role = this.role();
    const items: MenuItem[] = [];
    if (role === 'business' || role === 'pm') items.push({ id: 'how', label: NAV.howItWorks, separatorBefore: true });
    items.push({ id: 'logout', label: NAV.logout, separatorBefore: true });
    return items;
  });
  protected readonly userHead = computed(() => {
    const u = this.user();
    if (!u) return null;
    const role = this.role();
    return { title: u.name, meta: role ? `${u.email} · ${ROLE_TITLE[role]}` : u.email };
  });

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly section = computed<Section>(() => {
    const url = this.url();
    if (url.includes('/documents')) return 'documents';
    if (url.includes('/import')) return 'import';
    if (url.includes('/dev')) return 'dev';
    return 'journal';
  });

  protected link(...parts: (string | number)[]): unknown[] {
    return ['/p', this.projectId() ?? '', ...parts];
  }

  protected onContextPick(id: string): void {
    if (id.startsWith('project:')) {
      const projectId = id.slice('project:'.length);
      const m = this.session.membership(projectId);
      if (!m || projectId === this.projectId()) return;
      this.session.selectProject(projectId);
      void this.router.navigateByUrl(homeUrlFor(m));
      return;
    }
    if (id.startsWith('round:')) {
      void this.router.navigate(['/p', this.projectId(), 'r', id.slice('round:'.length)]);
    }
  }

  protected onUserPick(id: string): void {
    if (id === 'how') {
      const role = this.role();
      if (role === 'business' || role === 'pm') this.onboarding.open(role);
      return;
    }
    if (id === 'logout') {
      this.session.logout();
      void this.router.navigateByUrl('/login');
    }
  }

  protected skipToMain(e: Event): void {
    e.preventDefault();
    const main = document.getElementById('main');
    if (!main) return;
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: false });
  }
}
