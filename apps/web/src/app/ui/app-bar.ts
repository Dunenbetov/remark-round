import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_NAME, NAV, ROLE_TITLE, ROUND } from '../core/copy';
import { homeUrlFor } from '../core/guards';
import type { Role } from '../core/models';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { ThemeMode, ThemeService } from '../core/theme.service';
import { Menu, MenuItem } from './menu';

type Section = 'journal' | 'documents' | 'import' | 'dev';

const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };

/**
 * Верхняя панель: RemarkRound · проект · раунд | разделы | «Добавить замечание» · аватар.
 * Роль человека — в заголовке страницы (rr-page-header) и в меню аватара.
 * На узком экране разделы уезжают в нижний таб-бар.
 */
@Component({
  selector: 'rr-app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Menu],
  template: `
    <a class="skip" href="#main" (click)="skipToMain($event)">{{ nav.skip }}</a>
    <header class="bar">
      <div class="bar__in">
        <div class="bar__left">
          <a class="serif bar__brand" routerLink="/">{{ appName }}</a>
          @if (!brandOnly() && projectId()) {
            @if (projectItems().length > 1) {
              <rr-menu align="start" [items]="projectItems()" [label]="nav.project" triggerClass="switch" (pick)="switchProject($event)">
                <span class="switch__text">{{ projectName() }}</span>
                <svg class="switch__chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
              </rr-menu>
            } @else {
              <span class="bar__project">{{ projectName() }}</span>
            }
            @if (role() !== 'developer' && roundItems().length) {
              @if (roundItems().length > 1) {
                <rr-menu align="start" [items]="roundItems()" [label]="nav.round" triggerClass="switch switch--round" (pick)="switchRound($event)">
                  <span class="switch__text">{{ roundLabel() }}</span>
                  <svg class="switch__chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
                </rr-menu>
              } @else {
                <span class="bar__project bar__project--round">{{ roundLabel() }}</span>
              }
            }
          }
        </div>
        @if (!brandOnly() && projectId()) {
          <nav class="bar__nav" [attr.aria-label]="nav.sections">
            @if (role() === 'developer') {
              <a class="bar__pill bar__pill--on" [routerLink]="link('dev')" aria-current="page">{{ nav.dev }}</a>
            } @else {
              <a class="bar__pill" [class.bar__pill--on]="section() === 'documents'" [attr.aria-current]="section() === 'documents' ? 'page' : null" [routerLink]="link('documents')">{{ nav.documents }}</a>
              <a class="bar__pill" [class.bar__pill--on]="section() === 'journal'" [attr.aria-current]="section() === 'journal' ? 'page' : null" [routerLink]="link('r', roundParam())">{{ nav.journal }}</a>
              <a class="bar__pill" [class.bar__pill--on]="section() === 'import'" [attr.aria-current]="section() === 'import' ? 'page' : null" [routerLink]="link('r', roundParam(), 'import')">{{ nav.import }}</a>
            }
          </nav>
        }
        <div class="bar__right">
          @if (!brandOnly() && role() === 'business' && projectId()) {
            <a class="btn btn--primary bar__add" [routerLink]="link('r', roundParam(), 'remarks', 'new')">{{ nav.addRemark }}</a>
          }
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
        <a class="tabs__link" [class.tabs__link--on]="section() === 'documents'" [attr.aria-current]="section() === 'documents' ? 'page' : null" [routerLink]="link('documents')">{{ nav.documents }}</a>
        <a class="tabs__link" [class.tabs__link--on]="section() === 'journal'" [attr.aria-current]="section() === 'journal' ? 'page' : null" [routerLink]="link('r', roundParam())">{{ nav.journal }}</a>
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
      width: min(var(--rr-container), 100% - 32px);
      margin-inline: auto;
      height: 100%;
      display: flex;
      align-items: center;
      gap: var(--sp-4);
    }
    .bar__left {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      min-width: 0;
      flex: 1 1 auto;
    }
    .bar__brand {
      font-size: var(--fs-18);
      line-height: var(--lh-18);
      color: var(--rr-ink);
      text-decoration: none;
      white-space: nowrap;
      margin-right: var(--sp-1);
    }
    .bar__brand:hover {
      color: var(--rr-ink);
    }
    .bar__project {
      font-size: var(--fs-14);
      color: var(--rr-ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 6px;
      min-width: 0;
      max-width: 260px;
    }
    .bar__project::before,
    .bar__left ::ng-deep .switch::before {
      content: '·';
      margin-right: 10px;
      color: var(--rr-ink-3);
    }
    .bar__nav {
      display: flex;
      gap: 4px;
      flex: none;
      margin-inline: auto;
    }
    .bar__pill {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 14px;
      border-radius: var(--rr-r-pill);
      font-size: var(--fs-14);
      color: var(--rr-ink);
      text-decoration: none;
      white-space: nowrap;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .bar__pill:hover {
      background: color-mix(in srgb, var(--rr-ink) 5%, transparent);
      color: var(--rr-ink);
    }
    .bar__pill--on,
    .bar__pill--on:hover {
      background: color-mix(in srgb, var(--rr-ink) 8%, transparent);
      font-weight: var(--fw-semibold);
    }
    .bar__right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--sp-3);
      flex: 0 0 auto;
    }
    .bar__add {
      min-height: 36px;
      padding: 0 14px;
    }
    .tabs {
      display: none;
    }
    @media (max-width: 720px) {
      .bar__in {
        width: calc(100% - 24px);
        gap: var(--sp-3);
      }
      .bar__nav,
      .bar__add,
      .bar__project,
      .bar__left ::ng-deep .switch:not(.switch--round) {
        display: none;
      }
      .bar__left ::ng-deep .switch--round::before {
        content: none;
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
  private readonly theme = inject(ThemeService);

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

  protected readonly projectItems = computed<MenuItem[]>(() =>
    this.session.memberships().map((m) => ({ id: m.projectId, label: m.projectName, hint: ROLE_TITLE[m.role], selected: m.projectId === this.projectId() })),
  );
  protected readonly roundItems = computed<MenuItem[]>(() =>
    this.store.roundNumber()
      ? this.store.rounds().map((r) => ({ id: String(r.number), label: ROUND.label(r.number), hint: r.status === 'closed' ? ROUND.closed : undefined, selected: r.number === this.store.roundNumber() }))
      : [],
  );
  protected readonly userItems = computed<MenuItem[]>(() => {
    const mode = this.theme.mode();
    return [
      { id: 'theme:auto', label: NAV.themeAuto, hint: NAV.theme, selected: mode === 'auto', separatorBefore: true },
      { id: 'theme:light', label: NAV.themeLight, selected: mode === 'light' },
      { id: 'theme:dark', label: NAV.themeDark, selected: mode === 'dark' },
      { id: 'logout', label: NAV.logout, separatorBefore: true },
    ];
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

  protected switchProject(projectId: string): void {
    const m = this.session.membership(projectId);
    if (!m || projectId === this.projectId()) return;
    this.session.selectProject(projectId);
    void this.router.navigateByUrl(homeUrlFor(m));
  }

  protected switchRound(round: string): void {
    void this.router.navigate(['/p', this.projectId(), 'r', round]);
  }

  protected onUserPick(id: string): void {
    if (id.startsWith('theme:')) {
      this.theme.set(id.slice('theme:'.length) as ThemeMode);
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
